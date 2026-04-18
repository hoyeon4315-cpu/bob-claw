import { Interface } from "ethers";
import { WRAPPED_NATIVE_TOKENS, WBTC_OFT_TOKEN, ZERO_TOKEN, tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { attachOdosAssembly, normalizeOdosQuote, OdosClient, odosRoutingConfig, STABLE_QUOTE_TOKENS } from "../../dex/odos.mjs";
import { classifyGasEstimateError, estimateGas } from "../../gas/rpc-gas.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const NATIVE_DEX_EXPERIMENT_STRATEGY_ID = "native-dex-experiment";

const WRAPPED_NATIVE_INTERFACE = new Interface([
  "function deposit() payable",
  "function approve(address spender,uint256 amount)",
]);

const TOKEN_ALIASES = Object.freeze({
  usdc: (chain) => STABLE_QUOTE_TOKENS[chain]?.token || null,
  "wbtc.oft": () => WBTC_OFT_TOKEN,
  wbtc_oft: () => WBTC_OFT_TOKEN,
});

function toPositiveIntegerString(value, label) {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new Error(`${label} must be a positive integer`);
    return value.toString();
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^[0-9]+$/.test(normalized) || normalized === "0") {
      throw new Error(`${label} must be a positive integer`);
    }
    return normalized;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return String(value);
}

function toPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeOutputToken(chain, token) {
  if (!token) {
    const stable = STABLE_QUOTE_TOKENS[chain];
    if (!stable?.token) {
      throw new Error(`No default output token configured for ${chain}`);
    }
    return stable.token;
  }
  const normalized = String(token).trim();
  const alias = TOKEN_ALIASES[normalized.toLowerCase()];
  if (alias) {
    const resolved = alias(chain);
    if (!resolved) {
      throw new Error(`Unsupported output token alias for ${chain}: ${token}`);
    }
    return resolved;
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) return normalized;
  throw new Error(`Unsupported DEX output token: ${token}`);
}

function classifyOdosError(error) {
  if (error?.name === "GasEstimateError") {
    return classifyGasEstimateError(error);
  }
  const message = String(error?.message || "");
  const detail = String(error?.details?.body?.detail || "");
  if (message.includes("Odos chain unsupported")) {
    return "odos_chain_not_supported";
  }
  if (detail.includes("Routing unavailable")) {
    return "routing_unavailable";
  }
  return "odos_quote_failed";
}

function serializePreflightError(error) {
  return {
    name: error.name,
    message: error.message,
    details: error.details || null,
  };
}

function minimumOutputAmount(outputAmount, slippageBps) {
  const quoted = BigInt(outputAmount || 0);
  const bps = BigInt(Math.max(0, Number(slippageBps) || 0));
  return (quoted * (10_000n - bps)) / 10_000n;
}

function resolveQuotedGasLimit(quote, gasBufferBps) {
  const quotedGasLimit = Number(quote?.txGasLimit);
  if (!Number.isFinite(quotedGasLimit) || quotedGasLimit <= 0) {
    return null;
  }
  return String(applyGasBuffer(Math.ceil(quotedGasLimit), gasBufferBps));
}

export async function buildNativeDexExperimentPlan({
  client = new OdosClient(),
  estimateGasImpl = estimateGas,
  strategyId = NATIVE_DEX_EXPERIMENT_STRATEGY_ID,
  chain,
  amount,
  senderAddress,
  outputToken = null,
  slippageBps = config.slippageBps,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("EVM sender address is required");
  if (!getEvmChainConfig(chain)) throw new Error(`Unsupported EVM chain: ${chain}`);

  const wrappedNative = WRAPPED_NATIVE_TOKENS[chain];
  if (!wrappedNative) throw new Error(`Wrapped native token is not configured for ${chain}`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const normalizedOutputToken = normalizeOutputToken(chain, outputToken);
  const outputAsset = tokenAsset(chain, normalizedOutputToken);
  const routing = odosRoutingConfig(chain);

  let quote = null;
  let executableQuote = null;
  let blockedReason = null;
  let preflightError = null;
  let steps = [];

  try {
    const quoted = await client.quote({
      chain,
      inputToken: wrappedNative,
      outputToken: normalizedOutputToken,
      amount: normalizedAmount,
      userAddr: senderAddress,
      slippageLimitPercent: Number(slippageBps) / 100,
      sourceWhitelist: routing.sourceWhitelist,
      sourceBlacklist: routing.sourceBlacklist,
    });
    quote = normalizeOdosQuote({
      chain,
      source: "native_dex_experiment",
      amount: normalizedAmount,
      inputToken: wrappedNative,
      outputToken: normalizedOutputToken,
      inputTicker: tokenAsset(chain, wrappedNative).ticker,
      inputDecimals: tokenAsset(chain, wrappedNative).decimals,
      outputTicker: outputAsset.ticker,
      outputDecimals: outputAsset.decimals,
      quoteType: "wrapped_native_to_token",
      result: quoted,
      sourceWhitelist: routing.sourceWhitelist,
      sourceBlacklist: routing.sourceBlacklist,
    });
    const assembled = await client.assemble({
      pathId: quote.pathId,
      userAddr: senderAddress,
    });
    executableQuote = attachOdosAssembly(quote, assembled);
    const amountUsd = Number(executableQuote.inputValueUsd ?? 0);

    const wrapGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: wrappedNative,
        data: WRAPPED_NATIVE_INTERFACE.encodeFunctionData("deposit"),
        valueWei: normalizedAmount,
      },
      getEvmChainConfig(chain),
    );
    const approveGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: wrappedNative,
        data: WRAPPED_NATIVE_INTERFACE.encodeFunctionData("approve", [executableQuote.txTo, normalizedAmount]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
    const gasBuffer = Math.max(10_000, toPositiveInteger(gasBufferBps, "gasBufferBps"));
    const swapGasLimit = resolveQuotedGasLimit(executableQuote, gasBuffer)
      || String(
        applyGasBuffer(
          (
            await estimateGasImpl(
              chain,
              {
                from: senderAddress,
                to: executableQuote.txTo,
                data: executableQuote.txData,
                valueWei: executableQuote.txValueWei,
              },
              getEvmChainConfig(chain),
            )
          ).gasUnits,
          gasBuffer,
        ),
      );
    const buildIntent = ({ intentType, tx, approval = null, metadata = {} }) => ({
      strategyId,
      chain,
      family: "evm",
      intentType,
      amountUsd,
      mode: "live",
      observedAt: now,
      executionReason: "strategy_execution",
      approval,
      tx,
      strategyConfig: {
        intentTtlMs: strategyCaps.intentTtlMs,
      },
      metadata: {
        skipAutoIngest: true,
        ...metadata,
      },
    });

    steps = [
      {
        id: "wrap_native",
        intent: buildIntent({
          intentType: "wrap_native",
          tx: {
            to: wrappedNative,
            data: WRAPPED_NATIVE_INTERFACE.encodeFunctionData("deposit"),
            value: normalizedAmount,
            gasLimit: String(applyGasBuffer(wrapGas.gasUnits, gasBuffer)),
          },
          metadata: {
            wrappedNativeToken: wrappedNative,
            capCheckAmountUsd: 0,
          },
        }),
      },
      {
        id: "approve_wrapped_native",
        intent: buildIntent({
          intentType: "approve_exact",
          approval: {
            token: wrappedNative,
            spender: executableQuote.txTo,
            amount: normalizedAmount,
            mode: "per_tx",
          },
          tx: {
            to: wrappedNative,
            data: WRAPPED_NATIVE_INTERFACE.encodeFunctionData("approve", [executableQuote.txTo, normalizedAmount]),
            value: "0",
            gasLimit: String(applyGasBuffer(approveGas.gasUnits, gasBuffer)),
          },
          metadata: {
            provider: "odos",
            sourceWhitelist: executableQuote.sourceWhitelist,
            capCheckAmountUsd: 0,
          },
        }),
      },
      {
        id: "swap_wrapped_native",
        intent: buildIntent({
          intentType: "odos_swap",
          tx: {
            to: executableQuote.txTo,
            data: executableQuote.txData,
            value: executableQuote.txValueWei,
            gasLimit: swapGasLimit,
          },
          metadata: {
            provider: "odos",
            pathId: executableQuote.pathId,
            sourceWhitelist: executableQuote.sourceWhitelist,
            executionTrust: executableQuote.executionTrust,
          },
        }),
      },
    ];
  } catch (error) {
    blockedReason = blockedReason || classifyOdosError(error);
    preflightError = serializePreflightError(error);
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    planStatus: steps.length ? "ready" : "blocked",
    blockedReason,
    preflightError,
    strategyId,
    chain,
    senderAddress,
    inputToken: ZERO_TOKEN,
    wrappedInputToken: wrappedNative,
    outputToken: normalizedOutputToken,
    outputAsset,
    amount: normalizedAmount,
    amountUsd: Number(executableQuote?.inputValueUsd ?? 0) || null,
    quote: executableQuote,
    minimumOutputAmount: quote?.outputAmount ? minimumOutputAmount(quote.outputAmount, slippageBps).toString() : null,
    steps,
  };
}

export async function executeNativeDexExperimentPlan({
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
  destinationSettlementTimeoutMs = defaultSettlementTimeoutMs(0, { minimumMs: 60_000, extraSeconds: 0 }),
  destinationPollIntervalMs = 5_000,
  sleepImpl = sleep,
} = {}) {
  if (!Array.isArray(plan?.steps) || plan.steps.length === 0) {
    throw new Error(`Native DEX experiment plan is not executable: ${plan?.blockedReason || "missing_steps"}`);
  }
  const destinationBalanceBefore = awaitDestinationSettlement
    ? await readEvmAssetBalance({
        asset: plan.outputAsset,
        owner: plan.senderAddress,
        readErc20BalanceImpl,
        readNativeBalanceImpl,
      })
    : null;
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
      throw new Error(result?.error?.message || `Signer did not complete ${step.id}`);
    }
    stepResults.push({
      id: step.id,
      signerResult: result,
    });
  }
  const destinationProof = awaitDestinationSettlement
    ? await waitForEvmAssetDelta({
        asset: plan.outputAsset,
        owner: plan.senderAddress,
        initialBalance: destinationBalanceBefore,
        requiredDelta: plan.minimumOutputAmount,
        readErc20BalanceImpl,
        readNativeBalanceImpl,
        timeoutMs: destinationSettlementTimeoutMs,
        pollIntervalMs: destinationPollIntervalMs,
        sleepImpl,
      })
    : null;
  const execution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: destinationProof?.status || "source_confirmed_only",
    plan,
    stepResults,
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
