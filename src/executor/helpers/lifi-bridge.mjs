import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { classifyGasEstimateError, estimateGas } from "../../gas/rpc-gas.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../../market/prices.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { classifySettlementTimeout } from "./gas-zip-rate-limit.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const LIFI_BRIDGE_STRATEGY_ID = "lifi-bridge";
export const LIFI_API_BASE = "https://li.quest/v1";

const ERC20_INTERFACE = new Interface(["function approve(address spender,uint256 amount)"]);

function positiveIntegerString(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text) || text === "0") {
    throw new Error(`${label} must be a positive integer`);
  }
  return text;
}

function toHexQuantity(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && value.startsWith("0x")) return value;
  return `0x${BigInt(value).toString(16)}`;
}

function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, details: error.details || null };
}

function normalizeTxValue(value) {
  if (value == null || value === "") return "0";
  if (typeof value === "string" && value.startsWith("0x")) return BigInt(value).toString();
  return BigInt(value).toString();
}

function sumWei(values = []) {
  return values.reduce((sum, value) => {
    try {
      return sum + BigInt(value ?? 0);
    } catch {
      return sum;
    }
  }, 0n);
}

function lifiGasCostWei(quote = null) {
  const topLevel = sumWei((quote?.estimate?.gasCosts || []).map((item) => item?.amount));
  const includedSteps = sumWei(
    (quote?.includedSteps || []).flatMap((step) => (step?.estimate?.gasCosts || []).map((item) => item?.amount)),
  );
  const best = topLevel > includedSteps ? topLevel : includedSteps;
  return best > 0n ? best : null;
}

function nativeSourceRequirementWei({ srcAsset, amount, txValueWei, quote }) {
  if (!srcAsset?.isNative) return null;
  const spendAmount = [amount, txValueWei].reduce((max, value) => {
    try {
      const parsed = BigInt(value ?? 0);
      return parsed > max ? parsed : max;
    } catch {
      return max;
    }
  }, 0n);
  const gasCost = lifiGasCostWei(quote);
  if (spendAmount <= 0n || gasCost === null) return null;
  return (spendAmount + gasCost).toString();
}

function assertNativeSourceCoversPlan({ plan, sourceBalanceBefore, destinationBalanceBefore = null }) {
  if (!plan?.srcAsset?.isNative || !plan.nativeSourceRequirementWei) return;
  const available = BigInt(sourceBalanceBefore?.balance ?? 0);
  const required = BigInt(plan.nativeSourceRequirementWei);
  if (available >= required) return;
  const error = new Error(
    `Insufficient native balance for LI.FI gas: required ${required.toString()}, available ${available.toString()}`,
  );
  error.name = "InsufficientNativeBalanceForLifiGas";
  error.partialExecution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: "blocked",
    blockedReason: "insufficient_native_balance_for_lifi_gas",
    plan,
    stepResults: [],
    sourceBalanceBefore: {
      ...sourceBalanceBefore,
      ticker: plan.srcAsset?.ticker || null,
      token: plan.srcToken || null,
      chain: plan.srcChain,
    },
    destinationBalanceBefore,
    destinationProof: null,
    error: {
      name: error.name,
      message: error.message,
      requiredAmount: required.toString(),
      availableBalance: available.toString(),
    },
  };
  throw error;
}

async function lifiQuote({ apiBase = LIFI_API_BASE, fetchImpl = fetch, params }) {
  const url = `${apiBase.replace(/\/+$/, "")}/quote?${new URLSearchParams(params).toString()}`;
  const startedAt = Date.now();
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const latencyMs = Date.now() - startedAt;
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    error.details = { url, status: response.status, bodySnippet: text.slice(0, 500), latencyMs };
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`LI.FI quote failed: HTTP ${response.status}`);
    error.name = "LifiQuoteError";
    error.details = { url, status: response.status, body, latencyMs };
    throw error;
  }
  return { body, latencyMs, url };
}

function amountUsdFromRaw(rawAmount, asset, prices, fallbackPriceUsd = null) {
  const priceUsd = Number.isFinite(Number(fallbackPriceUsd))
    ? Number(fallbackPriceUsd)
    : priceForAssetUsd(asset, prices);
  if (!Number.isFinite(priceUsd)) return null;
  if (!Number.isInteger(asset.decimals) || asset.decimals < 0) {
    const error = new Error(`Missing token decimals for LI.FI source asset: ${asset.chain}:${asset.token}`);
    error.name = "TokenDecimalsMissing";
    error.blockedReason = "missing_src_token_decimals";
    throw error;
  }
  const decimalAmount = Number(BigInt(rawAmount)) / 10 ** asset.decimals;
  return Number((decimalAmount * priceUsd).toFixed(6));
}

function approvalCapCheckAmountUsd(amountUsd) {
  const value = Number(amountUsd);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number((value * 1.05).toFixed(6));
}

function assertSourceBalanceCoversPlan({ plan, sourceBalanceBefore, destinationBalanceBefore = null }) {
  const available = BigInt(sourceBalanceBefore?.balance ?? 0);
  const required = BigInt(plan?.amount ?? 0);
  if (available >= required) return;
  const error = new Error(
    `Insufficient source balance: required ${required.toString()}, available ${available.toString()}`,
  );
  error.name = "InsufficientSourceBalance";
  error.partialExecution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: "blocked",
    blockedReason: "insufficient_source_balance",
    plan,
    stepResults: [],
    sourceBalanceBefore: {
      ...sourceBalanceBefore,
      ticker: plan.srcAsset?.ticker || null,
      token: plan.srcToken || null,
      chain: plan.srcChain,
    },
    destinationBalanceBefore,
    destinationProof: null,
    error: {
      name: error.name,
      message: error.message,
      requiredAmount: required.toString(),
      availableBalance: available.toString(),
    },
  };
  throw error;
}

export async function buildLifiBridgePlan({
  apiBase = LIFI_API_BASE,
  fetchImpl = fetch,
  estimateGasImpl = estimateGas,
  priceReader = getCoinGeckoPricesUsd,
  strategyId = LIFI_BRIDGE_STRATEGY_ID,
  srcChain,
  dstChain,
  srcToken,
  dstToken,
  amount,
  senderAddress,
  recipient = senderAddress,
  slippageBps = 50,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  executionReason = "strategy_execution",
  systemEconomics = null,
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("LI.FI sender address is required");
  if (!recipient) throw new Error("LI.FI recipient address is required");
  const srcConfig = getEvmChainConfig(srcChain);
  const dstConfig = getEvmChainConfig(dstChain);
  if (!srcConfig) throw new Error(`Unsupported LI.FI source chain: ${srcChain}`);
  if (!dstConfig) throw new Error(`Unsupported LI.FI destination chain: ${dstChain}`);
  const strategyCaps = assertStrategyCaps(strategyId);
  const normalizedAmount = positiveIntegerString(amount, "amount");
  const srcAsset = tokenAsset(srcChain, srcToken);
  const dstAsset = tokenAsset(dstChain, dstToken);
  const quoteParams = {
    fromChain: String(srcConfig.chainId),
    toChain: String(dstConfig.chainId),
    fromToken: srcToken,
    toToken: dstToken,
    fromAmount: normalizedAmount,
    fromAddress: senderAddress,
    toAddress: recipient,
    slippage: String((Number(slippageBps) || 0) / 10_000),
  };

  let quote = null;
  let blockedReason = null;
  let lifiError = null;
  let gasPreflight = null;
  let approvalGasPreflight = null;
  let preflightError = null;
  let steps = [];
  let amountUsd = null;

  try {
    const quoteResult = await lifiQuote({ apiBase, fetchImpl, params: quoteParams });
    quote = {
      ...quoteResult.body,
      latencyMs: quoteResult.latencyMs,
      url: quoteResult.url,
    };
    const prices = await priceReader();
    amountUsd = amountUsdFromRaw(normalizedAmount, srcAsset, prices, quote.action?.fromToken?.priceUSD);
    const approvalAddress = quote.estimate?.approvalAddress;
    const tx = quote.transactionRequest;
    if (!srcAsset.isNative && !approvalAddress) throw new Error("LI.FI quote missing approvalAddress");
    if (!tx?.to || !tx?.data) throw new Error("LI.FI quote missing transactionRequest");
    const gasBuffer = Math.max(10_000, Number(gasBufferBps) || 10_000);
    const txValueWei = normalizeTxValue(tx.value);
    if (!srcAsset.isNative) {
      approvalGasPreflight = await estimateGasImpl(
        srcChain,
        {
          from: senderAddress,
          to: srcToken,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [approvalAddress, normalizedAmount]),
          valueWei: "0",
        },
        srcConfig,
      );
    }
    const quotedGasLimit = tx.gasLimit ? Number(BigInt(tx.gasLimit)) : null;
    const bridgeGasLimit =
      Number.isFinite(quotedGasLimit) && quotedGasLimit > 0
        ? applyGasBuffer(quotedGasLimit, gasBuffer)
        : applyGasBuffer(
            (
              await estimateGasImpl(
                srcChain,
                {
                  from: senderAddress,
                  to: tx.to,
                  data: tx.data,
                  valueWei: txValueWei,
                },
                srcConfig,
              )
            ).gasUnits,
            gasBuffer,
          );
    gasPreflight = {
      gasLimit: bridgeGasLimit,
      gasLimitHex: toHexQuantity(bridgeGasLimit),
    };
    const buildIntent = ({ intentType, tx: intentTx, approval = null, metadata = {} }) => ({
      strategyId,
      chain: srcChain,
      family: "evm",
      intentType,
      amountUsd,
      systemEconomics,
      mode: "live",
      observedAt: now,
      executionReason,
      approval,
      tx: intentTx,
      strategyConfig: { intentTtlMs: strategyCaps.intentTtlMs },
      metadata: {
        skipAutoIngest: true,
        expectedTxTo: intentTx?.to || null,
        executionReason,
        provider: "lifi",
        lifiTool: quote.tool || null,
        lifiQuoteId: quote.id || null,
        ...metadata,
      },
    });
    steps = [
      ...(srcAsset.isNative
        ? []
        : [
            {
              id: "approve_lifi_spender",
              intent: buildIntent({
                intentType: "approve_exact",
                approval: {
                  token: srcToken,
                  spender: approvalAddress,
                  amount: normalizedAmount,
                  mode: "per_tx",
                },
                tx: {
                  to: srcToken,
                  data: ERC20_INTERFACE.encodeFunctionData("approve", [approvalAddress, normalizedAmount]),
                  value: "0",
                  gasLimit: String(applyGasBuffer(approvalGasPreflight.gasUnits, gasBuffer)),
                },
                metadata: {
                  capCheckAmountUsd: approvalCapCheckAmountUsd(amountUsd),
                  srcToken,
                  dstToken,
                },
              }),
            },
          ]),
      {
        id: "lifi_bridge",
        intent: buildIntent({
          intentType: "lifi_bridge",
          tx: {
            to: tx.to,
            data: tx.data,
            value: txValueWei,
            gasLimit: String(bridgeGasLimit),
          },
          metadata: {
            srcToken,
            dstToken,
            minimumOutputAmount: quote.estimate?.toAmountMin || null,
            expectedOutputAmount: quote.estimate?.toAmount || null,
          },
        }),
      },
    ];
  } catch (error) {
    blockedReason =
      error.blockedReason ||
      (error.name === "LifiQuoteError" ? "lifi_quote_rejected" : classifyGasEstimateError(error));
    lifiError = serializeError(error);
    preflightError = error.name === "LifiQuoteError" ? null : serializeError(error);
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    planStatus: steps.length ? "ready" : "blocked",
    blockedReason,
    lifiError,
    preflightError,
    strategyId,
    srcChain,
    dstChain,
    srcToken,
    dstToken,
    srcAsset,
    dstAsset,
    senderAddress,
    recipient,
    amount: normalizedAmount,
    amountUsd,
    minimumOutputAmount: quote?.estimate?.toAmountMin || null,
    expectedOutputAmount: quote?.estimate?.toAmount || null,
    nativeSourceRequirementWei: nativeSourceRequirementWei({
      srcAsset,
      amount: normalizedAmount,
      txValueWei: quote?.transactionRequest ? normalizeTxValue(quote.transactionRequest.value) : null,
      quote,
    }),
    quote,
    approvalGasPreflight,
    gasPreflight,
    steps,
  };
}

export async function executeLifiBridgePlan({
  plan,
  sendCommand = sendSignerCommand,
  receiptIngest = appendExecutionReceiptReconciliation,
  readErc20BalanceImpl,
  readNativeBalanceImpl,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  awaitDestinationSettlement = true,
  destinationSettlementTimeoutMs = defaultSettlementTimeoutMs(0, { minimumMs: 300_000, extraSeconds: 0 }),
  destinationPollIntervalMs = 10_000,
  sleepImpl = sleep,
} = {}) {
  if (!Array.isArray(plan?.steps) || plan.steps.length === 0) {
    throw new Error(`LI.FI bridge plan is not executable: ${plan?.blockedReason || "missing_steps"}`);
  }
  const sourceBalanceBefore = await readEvmAssetBalance({
    asset: plan.srcAsset,
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const destinationBalanceBefore = awaitDestinationSettlement
    ? await readEvmAssetBalance({
        asset: plan.dstAsset,
        owner: plan.recipient,
        readErc20BalanceImpl,
        readNativeBalanceImpl,
      })
    : null;
  assertSourceBalanceCoversPlan({ plan, sourceBalanceBefore, destinationBalanceBefore });
  assertNativeSourceCoversPlan({ plan, sourceBalanceBefore, destinationBalanceBefore });
  const stepResults = [];
  for (const step of plan.steps) {
    const result = await sendCommand({
      socketPath,
      timeoutMs,
      message: {
        command: "sign_and_broadcast",
        intent: step.intent,
        awaitConfirmation,
        confirmations,
        timeoutMs: confirmationTimeoutMs,
      },
    });
    if (result?.status !== "ok" || !result?.broadcast?.txHash) {
      return {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        settlementStatus: result?.status === "rejected" ? "signer_rejected" : "failed",
        plan,
        signerResult: result,
        stepResults: [...stepResults, { id: step.id, signerResult: result }],
        sourceBalanceBefore,
        destinationBalanceBefore,
        error:
          result?.status === "rejected"
            ? {
                name: "SignerRejected",
                message: (result?.policy?.blockers || []).join(",") || "Signer rejected funding intent",
                policy: result?.policy || null,
                notification: result?.notification || null,
                requiresUnwind: result?.requiresUnwind || false,
                emergencyUnwindPath: result?.emergencyUnwindPath || null,
              }
            : result?.error || null,
      };
    }
    stepResults.push({ id: step.id, signerResult: result });
  }
  const destinationProof = awaitDestinationSettlement
    ? classifySettlementTimeout(
        await waitForEvmAssetDelta({
          asset: plan.dstAsset,
          owner: plan.recipient,
          initialBalance: destinationBalanceBefore,
          requiredDelta: plan.minimumOutputAmount,
          readErc20BalanceImpl,
          readNativeBalanceImpl,
          timeoutMs: destinationSettlementTimeoutMs,
          pollIntervalMs: destinationPollIntervalMs,
          sleepImpl,
        }),
      )
    : null;
  const execution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: destinationProof?.status || "source_confirmed_only",
    plan,
    stepResults,
    sourceBalanceBefore,
    destinationBalanceBefore,
    destinationProof,
  };
  if (typeof receiptIngest !== "function") return execution;
  try {
    return {
      ...execution,
      receiptIngest: await receiptIngest({ execution }),
    };
  } catch (error) {
    return {
      ...execution,
      receiptIngest: {
        appended: false,
        reason: "ingest_failed",
        error: error.message,
      },
    };
  }
}
