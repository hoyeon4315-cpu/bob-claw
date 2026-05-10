import { Interface } from "ethers";
import { WRAPPED_NATIVE_TOKENS, WBTC_OFT_TOKEN, ZERO_TOKEN, tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { STABLE_QUOTE_TOKENS } from "../../dex/odos.mjs";
import { classifyDexError, dexProvidersForChain, quoteForLive, OdosProvider } from "../../dex/providers.mjs";
import { classifyGasEstimateError, estimateGas, getGasSnapshot } from "../../gas/rpc-gas.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { classifySettlementTimeout } from "./gas-zip-rate-limit.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const NATIVE_DEX_EXPERIMENT_STRATEGY_ID = "native-dex-experiment";

const WRAPPED_NATIVE_INTERFACE = new Interface([
  "function deposit() payable",
  "function approve(address spender,uint256 amount)",
]);
const DEFAULT_DIRECT_SWAP_GAS_UNITS = 450_000;

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

function classifyExperimentError(error) {
  if (error?.name === "GasEstimateError") {
    return classifyGasEstimateError(error);
  }
  const classified = classifyDexError(error, error?.provider || null);
  if (classified !== "dex_quote_failed") return classified;
  const detail = String(error?.details?.body?.detail || "");
  if (detail.includes("Routing unavailable")) return "routing_unavailable";
  return "dex_quote_failed";
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

function canUseDirectSwapGasFallback({ error, providerName, executableQuote } = {}) {
  return providerName === "pancake_swap"
    && executableQuote?.executionTrust === "on_chain_verified"
    && classifyGasEstimateError(error) === "execution_reverted";
}

function assertSourceBalanceCoversPlan({ plan, sourceBalanceBefore, destinationBalanceBefore = null }) {
  const available = BigInt(sourceBalanceBefore?.balance ?? 0);
  const required = BigInt(plan?.amount ?? 0);
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
      ticker: (plan.inputAsset || tokenAsset(plan.chain, ZERO_TOKEN))?.ticker || null,
      token: plan.inputToken || ZERO_TOKEN,
      chain: plan.chain,
    },
    sourceBalanceAfter: null,
    destinationBalanceBefore: destinationBalanceBefore
      ? {
          ...destinationBalanceBefore,
          ticker: plan.outputAsset?.ticker || null,
          token: plan.outputToken || null,
          chain: plan.chain,
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

export async function buildNativeDexExperimentPlan({
  providers = null,
  client = null,
  estimateGasImpl = estimateGas,
  gasSnapshotImpl = getGasSnapshot,
  strategyId = NATIVE_DEX_EXPERIMENT_STRATEGY_ID,
  chain,
  amount,
  senderAddress,
  outputToken = null,
  slippageBps = config.slippageBps,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  systemEconomics = null,
  executionReason = "strategy_execution",
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("EVM sender address is required");
  if (!getEvmChainConfig(chain)) throw new Error(`Unsupported EVM chain: ${chain}`);

  // Backward compat: if client is passed, wrap as OdosProvider
  const resolvedProviders = providers || (client ? [new OdosProvider({ client })] : dexProvidersForChain(chain));

  const wrappedNative = WRAPPED_NATIVE_TOKENS[chain];
  if (!wrappedNative) throw new Error(`Wrapped native token is not configured for ${chain}`);
  const inputAsset = tokenAsset(chain, ZERO_TOKEN);
  const wrappedInputAsset = tokenAsset(chain, wrappedNative);

  const strategyCaps = assertStrategyCaps(strategyId);
  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const normalizedOutputToken = normalizeOutputToken(chain, outputToken);
  const outputAsset = tokenAsset(chain, normalizedOutputToken);

  let quote = null;
  let executableQuote = null;
  let providerName = null;
  let blockedReason = null;
  let preflightError = null;
  let gasSnapshot = null;
  let gasSnapshotError = null;
  let steps = [];

  try {
    const result = await quoteForLive(resolvedProviders, {
      chain,
      inputToken: wrappedNative,
      outputToken: normalizedOutputToken,
      amount: normalizedAmount,
      senderAddress,
      slippageBps: Number(slippageBps),
    });
    quote = result.quote;
    executableQuote = result.executableQuote;
    providerName = result.provider;
    const amountUsd = Number(executableQuote.inputValueUsd ?? 0);
    try {
      gasSnapshot = await gasSnapshotImpl(chain, getEvmChainConfig(chain));
    } catch (error) {
      gasSnapshotError = serializePreflightError(error);
    }

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
    let swapGasLimit = resolveQuotedGasLimit(executableQuote, gasBuffer);
    if (!swapGasLimit) {
      try {
        swapGasLimit = String(
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
      } catch (error) {
        if (!canUseDirectSwapGasFallback({ error, providerName, executableQuote })) throw error;
        // Direct Pancake swaps can revert in preflight before wrap + approval steps land.
        swapGasLimit = String(applyGasBuffer(DEFAULT_DIRECT_SWAP_GAS_UNITS, gasBuffer));
      }
    }
    const buildIntent = ({ intentType, tx, approval = null, metadata = {} }) => ({
      strategyId,
      chain,
      family: "evm",
      intentType,
      amountUsd,
      systemEconomics,
      mode: "live",
      observedAt: now,
      executionReason,
      approval,
      tx,
      strategyConfig: {
        intentTtlMs: strategyCaps.intentTtlMs,
      },
      metadata: {
        skipAutoIngest: true,
        expectedTxTo: tx?.to || null,
        executionReason,
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
            provider: providerName || "odos",
            sourceWhitelist: executableQuote.sourceWhitelist,
            capCheckAmountUsd: 0,
          },
        }),
      },
      {
        id: "swap_wrapped_native",
        intent: buildIntent({
          intentType: "dex_swap",
          tx: {
            to: executableQuote.txTo,
            data: executableQuote.txData,
            value: executableQuote.txValueWei,
            gasLimit: swapGasLimit,
          },
          metadata: {
            provider: providerName || "odos",
            pathId: executableQuote.pathId,
            sourceWhitelist: executableQuote.sourceWhitelist,
            executionTrust: executableQuote.executionTrust,
          },
        }),
      },
    ];
  } catch (error) {
    blockedReason = blockedReason || classifyExperimentError(error);
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
    inputAsset,
    wrappedInputToken: wrappedNative,
    wrappedInputAsset,
    outputToken: normalizedOutputToken,
    outputAsset,
    amount: normalizedAmount,
    amountUsd: Number(executableQuote?.inputValueUsd ?? 0) || null,
    quoteTtlMs: strategyCaps.intentTtlMs,
    slippageBps: Number(slippageBps),
    gasBufferBps: Math.max(10_000, toPositiveInteger(gasBufferBps, "gasBufferBps")),
    quote: executableQuote,
    gasSnapshot,
    gasSnapshotError,
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
  const sourceBalanceBefore = await readEvmAssetBalance({
    asset: plan.inputAsset || tokenAsset(plan.chain, ZERO_TOKEN),
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const destinationBalanceBefore = awaitDestinationSettlement
    ? await readEvmAssetBalance({
        asset: plan.outputAsset,
        owner: plan.senderAddress,
        readErc20BalanceImpl,
        readNativeBalanceImpl,
      })
    : null;
  assertSourceBalanceCoversPlan({ plan, sourceBalanceBefore, destinationBalanceBefore });
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
      const error = new Error(result?.error?.message || `Signer did not complete ${step.id}`);
      error.name = result?.error?.name || "SignerExecutionFailed";
      error.partialExecution = {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        settlementStatus: "failed",
        plan,
        stepResults: [
          ...stepResults,
          {
            id: step.id,
            signerResult: result,
          },
        ],
        sourceBalanceBefore: {
          ...sourceBalanceBefore,
          ticker: (plan.inputAsset || tokenAsset(plan.chain, ZERO_TOKEN))?.ticker || null,
          token: plan.inputToken || ZERO_TOKEN,
          chain: plan.chain,
        },
        sourceBalanceAfter: null,
        destinationBalanceBefore: destinationBalanceBefore
          ? {
              ...destinationBalanceBefore,
              ticker: plan.outputAsset?.ticker || null,
              token: plan.outputToken || null,
              chain: plan.chain,
            }
          : null,
        destinationBalanceAfter: null,
        destinationProof: null,
        error: {
          name: error.name,
          message: error.message,
          stepId: step.id,
        },
      };
      throw error;
    }
    stepResults.push({
      id: step.id,
      signerResult: result,
    });
  }
  const destinationProof = awaitDestinationSettlement
    ? classifySettlementTimeout(await waitForEvmAssetDelta({
        asset: plan.outputAsset,
        owner: plan.senderAddress,
        initialBalance: destinationBalanceBefore,
        requiredDelta: plan.minimumOutputAmount,
        readErc20BalanceImpl,
        readNativeBalanceImpl,
        timeoutMs: destinationSettlementTimeoutMs,
        pollIntervalMs: destinationPollIntervalMs,
        sleepImpl,
      }))
    : null;
  const sourceBalanceAfter = await readEvmAssetBalance({
    asset: plan.inputAsset || tokenAsset(plan.chain, ZERO_TOKEN),
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
          asset: plan.outputAsset,
          owner: plan.senderAddress,
          readErc20BalanceImpl,
          readNativeBalanceImpl,
        })
      : null;
  const execution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: destinationProof?.status || "source_confirmed_only",
    plan,
    stepResults,
    sourceBalanceBefore: {
      ...sourceBalanceBefore,
      ticker: (plan.inputAsset || tokenAsset(plan.chain, ZERO_TOKEN))?.ticker || null,
      token: plan.inputToken || ZERO_TOKEN,
      chain: plan.chain,
    },
    sourceBalanceAfter: {
      ...sourceBalanceAfter,
      ticker: (plan.inputAsset || tokenAsset(plan.chain, ZERO_TOKEN))?.ticker || null,
      token: plan.inputToken || ZERO_TOKEN,
      chain: plan.chain,
    },
    destinationBalanceBefore: destinationBalanceBefore
      ? {
          ...destinationBalanceBefore,
          ticker: plan.outputAsset?.ticker || null,
          token: plan.outputToken || null,
          chain: plan.chain,
        }
      : null,
    destinationBalanceAfter: destinationBalanceAfter
      ? {
          ...destinationBalanceAfter,
          ticker: plan.outputAsset?.ticker || null,
          token: plan.outputToken || null,
          chain: plan.chain,
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
