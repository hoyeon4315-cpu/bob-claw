// Across bridge signer-intent builder (write side).
//
// Mirrors gateway-btc-consolidation: quote → gas preflight → signer
// intent payload. Does NOT sign — signing is the daemon's job after
// Policy approval.
//
// Destination settlement proof: caller passes a waiter that polls the
// destination SpokePool / ERC20 balance for outputAmount. That proof is
// required before the refill-job runner marks the job "delivered";
// without it only source-chain success is recorded and the job stays
// in a "settlement_pending" state, matching the gateway pattern.

import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import {
  ACROSS_DEFAULT_POLICY,
  acrossSpokePool,
  acrossSupportsPair,
  acrossTokenAddress,
} from "../../config/across.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { AcrossClient } from "../../bridge/across/client.mjs";
import { buildAcrossQuoteRequest, normalizeAcrossQuote } from "../../bridge/across/quote.mjs";
import { SPOKE_POOL_DEPOSIT_ABI, ZERO_ADDRESS } from "../../bridge/across/spoke-pool-abi.mjs";
import { classifyGasEstimateError, estimateGas, readContractCode } from "../../gas/rpc-gas.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../../market/prices.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { classifySettlementTimeout } from "./gas-zip-rate-limit.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const ACROSS_BRIDGE_STRATEGY_ID = "across-bridge";
export const DEFAULT_ACROSS_GAS_BUFFER_BPS = 12_000;
export const DEFAULT_ACROSS_DEPOSIT_GAS_UNITS = 450_000;

const SPOKE_INTERFACE = new Interface(SPOKE_POOL_DEPOSIT_ABI);
const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

function applyGasBuffer(gasUnits, bufferBps = DEFAULT_ACROSS_GAS_BUFFER_BPS) {
  const units = BigInt(gasUnits || 0);
  const bps = BigInt(Math.max(10_000, Number(bufferBps) || 10_000));
  return (units * bps) / 10_000n;
}

function serializeAcrossError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, details: error.details || null };
}

async function assertContractCode({
  chain,
  address,
  role,
  chainConfig,
  readCodeImpl = readContractCode,
}) {
  const code = await readCodeImpl(chain, address, chainConfig);
  if (code?.hasCode === true || (typeof code?.code === "string" && code.code !== "0x")) {
    return code;
  }
  const error = new Error(`Across ${role} has no contract code on ${chain}: ${address}`);
  error.name = "ContractCodeMissing";
  error.reason = role === "spokepool" ? "across_spokepool_code_missing" : "across_token_code_missing";
  error.details = {
    chain,
    address,
    role,
    code: code?.code || null,
    rpcUrl: code?.rpcUrl || null,
  };
  throw error;
}

function assertSourceBalanceCoversPlan({ plan, sourceBalanceBefore, destinationBalanceBefore = null }) {
  const available = BigInt(sourceBalanceBefore?.balance ?? 0);
  const required = BigInt(plan?.quote?.inputAmount || plan?.request?.amount || 0);
  if (available >= required) return;

  const error = new Error(`Insufficient source balance: required ${required.toString()}, available ${available.toString()}`);
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
    sourceBalanceAfter: null,
    destinationBalanceBefore: destinationBalanceBefore
      ? {
          ...destinationBalanceBefore,
          ticker: plan.dstAsset?.ticker || null,
          token: plan.dstToken || null,
          chain: plan.dstChain,
        }
      : null,
    destinationBalanceAfter: null,
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

function amountUsdFromAmount(amountRaw, asset, prices) {
  const unit = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(unit)) return null;
  const decimalAmount = Number(BigInt(amountRaw)) / 10 ** asset.decimals;
  return Number((decimalAmount * unit).toFixed(6));
}

function encodeDepositCalldata(quote, depositor) {
  return SPOKE_INTERFACE.encodeFunctionData("depositV3", [
    depositor,
    quote.recipient || depositor,
    quote.inputToken,
    quote.outputToken,
    BigInt(quote.inputAmount),
    BigInt(quote.outputAmount),
    BigInt(quote.destinationChainId),
    quote.exclusiveRelayer || ZERO_ADDRESS,
    quote.quoteTimestamp,
    quote.fillDeadline,
    quote.exclusivityDeadline || 0,
    "0x",
  ]);
}

export async function buildAcrossBridgePlan({
  srcChain,
  dstChain,
  ticker,
  amount,
  senderAddress,
  recipient = null,
  policy = ACROSS_DEFAULT_POLICY,
  clientFactory = null,
  priceReader = getCoinGeckoPricesUsd,
  estimateGasImpl = estimateGas,
  readCodeImpl = readContractCode,
  gasBufferBps = DEFAULT_ACROSS_GAS_BUFFER_BPS,
  skipPreflight = false,
  strategyId = ACROSS_BRIDGE_STRATEGY_ID,
  now = Math.floor(Date.now() / 1000),
} = {}) {
  if (!senderAddress) throw new Error("senderAddress required");
  if (!acrossSupportsPair({ srcChain, dstChain, ticker })) {
    throw new Error(`across plan: pair unsupported src=${srcChain} dst=${dstChain} ticker=${ticker}`);
  }
  const srcChainConfig = getEvmChainConfig(srcChain);
  if (!srcChainConfig) throw new Error(`no chain config for '${srcChain}'`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const spokePool = acrossSpokePool(srcChain);
  const srcTokenAddr = acrossTokenAddress(srcChain, ticker);
  const dstTokenAddr = acrossTokenAddress(dstChain, ticker);
  const srcAsset = tokenAsset(srcChain, srcTokenAddr);
  const dstAsset = tokenAsset(dstChain, dstTokenAddr);

  const request = buildAcrossQuoteRequest({ srcChain, dstChain, ticker, amount, recipient });
  const client = clientFactory
    ? clientFactory()
    : new AcrossClient({ baseUrl: policy.apiBase, timeoutMs: policy.quoteTimeoutMs });

  let quote = null;
  let quoteLatencyMs = null;
  let blockedReason = null;
  let acrossError = null;
  let amountUsd = null;
  try {
    const response = await client.suggestedFees({
      inputToken: request.inputToken,
      outputToken: request.outputToken,
      originChainId: request.originChainId,
      destinationChainId: request.destinationChainId,
      amount: request.amount,
      recipient: request.recipient,
      allowUnmatchedDecimals: request.allowUnmatchedDecimals,
    });
    quoteLatencyMs = response.latencyMs;
    quote = normalizeAcrossQuote({ request, responseBody: response.body, now, policy }).quote;
    const prices = await priceReader();
    amountUsd = amountUsdFromAmount(request.amount, srcAsset, prices);
  } catch (error) {
    blockedReason = error.name === "AcrossError" ? "across_quote_rejected" : "across_quote_invalid";
    acrossError = serializeAcrossError(error);
    try {
      amountUsd = amountUsdFromAmount(request.amount, srcAsset, await priceReader());
    } catch {
      amountUsd = null;
    }
  }

  if (Number.isFinite(amountUsd) && amountUsd > policy.perTxMaxUsd) {
    blockedReason = "across_per_tx_cap_exceeded";
  }

  let gasPreflight = null;
  let approvalGasPreflight = null;
  let preflightError = null;
  let intent = null;
  let steps = [];
  if (quote && !blockedReason && !skipPreflight) {
    try {
      const [spokePoolCode, srcTokenCode] = await Promise.all([
        assertContractCode({
          chain: srcChain,
          address: spokePool,
          role: "spokepool",
          chainConfig: srcChainConfig,
          readCodeImpl,
        }),
        assertContractCode({
          chain: srcChain,
          address: srcTokenAddr,
          role: "token",
          chainConfig: srcChainConfig,
          readCodeImpl,
        }),
      ]);
      const calldata = encodeDepositCalldata(quote, senderAddress);
      const approvalCalldata = ERC20_INTERFACE.encodeFunctionData("approve", [spokePool, quote.inputAmount]);
      const approvalGasEstimate = await estimateGasImpl(
        srcChain,
        { from: senderAddress, to: quote.inputToken, data: approvalCalldata, valueWei: "0" },
        srcChainConfig,
      );
      let gasEstimate = null;
      let depositGasFallbackReason = null;
      try {
        gasEstimate = await estimateGasImpl(
          srcChain,
          { from: senderAddress, to: spokePool, data: calldata, valueWei: "0" },
          srcChainConfig,
        );
      } catch (error) {
        const classified = classifyGasEstimateError(error);
        if (classified !== "execution_reverted" && classified !== "erc20_allowance_insufficient") throw error;
        depositGasFallbackReason = "deposit_estimate_reverted_before_approval";
        gasEstimate = {
          gasUnits: String(DEFAULT_ACROSS_DEPOSIT_GAS_UNITS),
          gasPriceWei: approvalGasEstimate.gasPriceWei ?? null,
          rpcUrl: approvalGasEstimate.rpcUrl ?? null,
          fallback: true,
        };
      }
      const approvalGasLimit = applyGasBuffer(approvalGasEstimate.gasUnits, gasBufferBps);
      const gasLimit = applyGasBuffer(gasEstimate.gasUnits, gasBufferBps);
      approvalGasPreflight = {
        ...approvalGasEstimate,
        gasBufferBps: Math.max(10_000, Number(gasBufferBps) || 10_000),
        gasLimit: String(approvalGasLimit),
        gasLimitHex: `0x${approvalGasLimit.toString(16)}`,
      };
      gasPreflight = {
        ...gasEstimate,
        contractCode: {
          spokePool: {
            hasCode: true,
            rpcUrl: spokePoolCode.rpcUrl || null,
          },
          srcToken: {
            hasCode: true,
            rpcUrl: srcTokenCode.rpcUrl || null,
          },
        },
        gasBufferBps: Math.max(10_000, Number(gasBufferBps) || 10_000),
        gasLimit: String(gasLimit),
        gasLimitHex: `0x${gasLimit.toString(16)}`,
        fallbackReason: depositGasFallbackReason,
      };
      const buildIntent = ({ intentType, tx, approval = null, metadata = {} }) => ({
        strategyId,
        chain: srcChain,
        family: "evm",
        intentType,
        method: "cross_chain_bridge_across",
        amountUsd,
        mode: "live",
        observedAt: new Date(now * 1000).toISOString(),
        executionReason: "strategy_execution",
        approval,
        quote: { ...quote, calldata, spokePool, quoteLatencyMs },
        tx,
        strategyConfig: { intentTtlMs: strategyCaps.intentTtlMs },
        metadata: {
          acrossInputToken: quote.inputToken,
          acrossOutputToken: quote.outputToken,
          acrossOutputAmount: quote.outputAmount,
          acrossRelayFeePct: quote.relayFeePct,
          acrossFillDeadline: quote.fillDeadline,
          acrossQuoteTimestamp: quote.quoteTimestamp,
          ...metadata,
        },
      });
      steps = [
        {
          id: "approve_across_spokepool",
          intent: buildIntent({
            intentType: "approve_exact",
            approval: {
              token: quote.inputToken,
              spender: spokePool,
              amount: quote.inputAmount,
              mode: "per_tx",
            },
            tx: {
              to: quote.inputToken,
              data: approvalCalldata,
              value: "0",
              gasLimit: String(approvalGasLimit),
            },
            metadata: {
              capCheckAmountUsd: 0,
              acrossStep: "approve_spokepool",
            },
          }),
        },
        {
          id: "across_deposit_v3",
          intent: buildIntent({
            intentType: "across_bridge_deposit",
            tx: {
              to: spokePool,
              data: calldata,
              value: "0",
              gasLimit: String(gasLimit),
            },
            metadata: {
              acrossStep: "deposit_v3",
            },
          }),
        },
      ];
      intent = {
        ...steps[1].intent,
      };
    } catch (error) {
      blockedReason = error.reason || classifyGasEstimateError(error) || "across_preflight_failed";
      preflightError = serializeAcrossError(error);
    }
  }

  const executionReady = Boolean(intent && gasPreflight);
  return {
    schemaVersion: 1,
    observedAt: new Date(now * 1000).toISOString(),
    planStatus: executionReady ? "ready" : "blocked",
    blockedReason,
    acrossError,
    preflightError,
    executionReady,
    skipPreflight,
    strategyId,
    senderAddress,
    recipient: recipient || senderAddress,
    srcChain,
    dstChain,
    srcToken: srcTokenAddr,
    dstToken: dstTokenAddr,
    srcAsset,
    dstAsset,
    request,
    quote,
    quoteLatencyMs,
    amountUsd,
    spokePool,
    approvalGasPreflight,
    gasPreflight,
    intent,
    steps,
    settlementRequirements: [
      "across_destination_output_amount_delta_proof_required",
      "across_deposit_id_recorded",
    ],
  };
}

export async function executeAcrossBridgePlan({
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
  destinationSettlementTimeoutMs = defaultSettlementTimeoutMs(null),
  destinationPollIntervalMs = 10_000,
  sleepImpl = sleep,
} = {}) {
  if (!plan?.intent || !plan?.gasPreflight) {
    throw new Error(`Across bridge plan is not executable: ${plan?.blockedReason || "missing_intent"}`);
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

  const executionSteps = Array.isArray(plan.steps) && plan.steps.length > 0
    ? plan.steps
    : [{ id: "across_deposit_v3", intent: plan.intent }];
  const stepResults = [];
  let signerResult = null;
  for (const step of executionSteps) {
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
    stepResults.push({ id: step.id, signerResult: result });
    signerResult = result;
    if (result?.status !== "ok" || !result?.broadcast?.txHash) {
      return {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        settlementStatus: result?.status === "rejected" ? "signer_rejected" : "signer_error",
        plan,
        signerResult: result,
        stepResults,
        sourceBalanceBefore: {
          ...sourceBalanceBefore,
          ticker: plan.srcAsset?.ticker || null,
          token: plan.srcToken || null,
          chain: plan.srcChain,
        },
        sourceBalanceAfter: null,
        destinationBalanceBefore: destinationBalanceBefore
          ? {
              ...destinationBalanceBefore,
              ticker: plan.dstAsset?.ticker || null,
              token: plan.dstToken || null,
              chain: plan.dstChain,
            }
          : null,
        destinationBalanceAfter: null,
        destinationProof: null,
      };
    }
  }

  const destinationProof = awaitDestinationSettlement
    ? classifySettlementTimeout(await waitForEvmAssetDelta({
        asset: plan.dstAsset,
        owner: plan.recipient,
        initialBalance: destinationBalanceBefore,
        requiredDelta: plan.quote?.outputAmount || "0",
        readErc20BalanceImpl,
        readNativeBalanceImpl,
        timeoutMs: destinationSettlementTimeoutMs,
        pollIntervalMs: destinationPollIntervalMs,
        sleepImpl,
      }))
    : null;
  const sourceBalanceAfter = await readEvmAssetBalance({
    asset: plan.srcAsset,
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const destinationBalanceAfter = destinationProof
    ? {
        proofSource: destinationProof.proofSource,
        rpcUrl: destinationProof.rpcUrl || null,
        balance: BigInt(destinationProof.settledBalance),
      }
    : awaitDestinationSettlement
      ? await readEvmAssetBalance({
          asset: plan.dstAsset,
          owner: plan.recipient,
          readErc20BalanceImpl,
          readNativeBalanceImpl,
        })
      : null;

  const execution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: destinationProof?.status || "source_confirmed_only",
    plan,
    signerResult,
    stepResults,
    sourceBalanceBefore: {
      ...sourceBalanceBefore,
      ticker: plan.srcAsset?.ticker || null,
      token: plan.srcToken || null,
      chain: plan.srcChain,
    },
    sourceBalanceAfter: {
      ...sourceBalanceAfter,
      ticker: plan.srcAsset?.ticker || null,
      token: plan.srcToken || null,
      chain: plan.srcChain,
    },
    destinationBalanceBefore: destinationBalanceBefore
      ? {
          ...destinationBalanceBefore,
          ticker: plan.dstAsset?.ticker || null,
          token: plan.dstToken || null,
          chain: plan.dstChain,
        }
      : null,
    destinationBalanceAfter: destinationBalanceAfter
      ? {
          ...destinationBalanceAfter,
          ticker: plan.dstAsset?.ticker || null,
          token: plan.dstToken || null,
          chain: plan.dstChain,
        }
      : null,
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

export { applyGasBuffer, encodeDepositCalldata };
