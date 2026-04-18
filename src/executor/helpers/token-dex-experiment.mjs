import { Interface } from "ethers";
import { WBTC_OFT_TOKEN, WRAPPED_NATIVE_TOKENS, ZERO_TOKEN, tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { attachOdosAssembly, normalizeOdosQuote, OdosClient, odosRoutingConfig, STABLE_QUOTE_TOKENS } from "../../dex/odos.mjs";
import { classifyGasEstimateError, estimateGas, getGasSnapshot } from "../../gas/rpc-gas.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const TOKEN_DEX_EXPERIMENT_STRATEGY_ID = "token-dex-experiment";

const BASE_CBBTC_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);
const WRAPPED_NATIVE_INTERFACE = new Interface([
  "function withdraw(uint256 wad)",
]);
const DEFAULT_UNWRAP_NATIVE_GAS_UNITS = 50_000;

const TOKEN_ALIASES = Object.freeze({
  usdc: (chain) => STABLE_QUOTE_TOKENS[chain]?.token || null,
  cbbtc: (chain) => (chain === "base" ? BASE_CBBTC_TOKEN : null),
  "wbtc.oft": () => WBTC_OFT_TOKEN,
  wbtc_oft: () => WBTC_OFT_TOKEN,
  weth: (chain) => WRAPPED_NATIVE_TOKENS[chain] || null,
  wrapped_native: (chain) => WRAPPED_NATIVE_TOKENS[chain] || null,
  native: () => ZERO_TOKEN,
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

function normalizeErc20Token(chain, token, label) {
  if (!token) throw new Error(`${label} is required`);
  const normalized = String(token).trim();
  const alias = TOKEN_ALIASES[normalized.toLowerCase()];
  if (alias) {
    const resolved = alias(chain);
    if (!resolved) throw new Error(`Unsupported ${label} alias for ${chain}: ${token}`);
    return resolved;
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) return normalized;
  throw new Error(`Unsupported ${label}: ${token}`);
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

export async function buildTokenDexExperimentPlan({
  client = new OdosClient(),
  estimateGasImpl = estimateGas,
  gasSnapshotImpl = getGasSnapshot,
  strategyId = TOKEN_DEX_EXPERIMENT_STRATEGY_ID,
  chain,
  amount,
  senderAddress,
  inputToken,
  outputToken,
  slippageBps = config.slippageBps,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
} = {}) {
  if (!senderAddress) throw new Error("EVM sender address is required");
  if (!getEvmChainConfig(chain)) throw new Error(`Unsupported EVM chain: ${chain}`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const normalizedInputToken = normalizeErc20Token(chain, inputToken, "inputToken");
  const requestedOutputToken = String(outputToken || "").trim().toLowerCase();
  const unwrapToNative = requestedOutputToken === "native";
  const normalizedOutputToken = unwrapToNative
    ? WRAPPED_NATIVE_TOKENS[chain]
    : normalizeErc20Token(chain, outputToken, "outputToken");
  if (normalizedInputToken.toLowerCase() === normalizedOutputToken.toLowerCase()) {
    throw new Error("Input and output tokens must differ");
  }
  const inputAsset = tokenAsset(chain, normalizedInputToken);
  const outputAsset = unwrapToNative ? tokenAsset(chain, ZERO_TOKEN) : tokenAsset(chain, normalizedOutputToken);
  const routing = odosRoutingConfig(chain);

  let quote = null;
  let executableQuote = null;
  let blockedReason = null;
  let preflightError = null;
  let gasSnapshot = null;
  let gasSnapshotError = null;
  let steps = [];

  try {
    const quoted = await client.quote({
      chain,
      inputToken: normalizedInputToken,
      outputToken: normalizedOutputToken,
      amount: normalizedAmount,
      userAddr: senderAddress,
      slippageLimitPercent: Number(slippageBps) / 100,
      sourceWhitelist: routing.sourceWhitelist,
      sourceBlacklist: routing.sourceBlacklist,
    });
    quote = normalizeOdosQuote({
      chain,
      source: "token_dex_experiment",
      amount: normalizedAmount,
      inputToken: normalizedInputToken,
      outputToken: normalizedOutputToken,
      inputTicker: inputAsset.ticker,
      inputDecimals: inputAsset.decimals,
      outputTicker: outputAsset.ticker,
      outputDecimals: outputAsset.decimals,
      quoteType: "token_to_token",
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
    try {
      gasSnapshot = await gasSnapshotImpl(chain, getEvmChainConfig(chain));
    } catch (error) {
      gasSnapshotError = serializePreflightError(error);
    }

    const approveGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: normalizedInputToken,
        data: ERC20_INTERFACE.encodeFunctionData("approve", [executableQuote.txTo, normalizedAmount]),
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
    let unwrapGasLimit = null;
    if (unwrapToNative) {
      const unwrapAmount = minimumOutputAmount(quote.outputAmount, slippageBps).toString();
      try {
        const unwrapGas = await estimateGasImpl(
          chain,
          {
            from: senderAddress,
            to: normalizedOutputToken,
            data: WRAPPED_NATIVE_INTERFACE.encodeFunctionData("withdraw", [unwrapAmount]),
            valueWei: "0",
          },
          getEvmChainConfig(chain),
        );
        unwrapGasLimit = String(applyGasBuffer(unwrapGas.gasUnits, gasBuffer));
      } catch {
        // Unwrap estimation can revert before the swap executes because the wallet
        // does not yet hold the wrapped-native output. Use a conservative fallback.
        unwrapGasLimit = String(applyGasBuffer(DEFAULT_UNWRAP_NATIVE_GAS_UNITS, gasBuffer));
      }
    }

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
        id: "approve_input_token",
        intent: buildIntent({
          intentType: "approve_exact",
          approval: {
            token: normalizedInputToken,
            spender: executableQuote.txTo,
            amount: normalizedAmount,
            mode: "per_tx",
          },
          tx: {
            to: normalizedInputToken,
            data: ERC20_INTERFACE.encodeFunctionData("approve", [executableQuote.txTo, normalizedAmount]),
            value: "0",
            gasLimit: String(applyGasBuffer(approveGas.gasUnits, gasBuffer)),
          },
          metadata: {
            provider: "odos",
            inputToken: normalizedInputToken,
            outputToken: normalizedOutputToken,
            sourceWhitelist: executableQuote.sourceWhitelist,
            capCheckAmountUsd: 0,
          },
        }),
      },
      {
        id: "swap_input_to_output",
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
            inputToken: normalizedInputToken,
            outputToken: unwrapToNative ? ZERO_TOKEN : normalizedOutputToken,
            wrappedOutputToken: unwrapToNative ? normalizedOutputToken : null,
            sourceWhitelist: executableQuote.sourceWhitelist,
            executionTrust: executableQuote.executionTrust,
          },
        }),
      },
    ];
    if (unwrapToNative) {
      steps.push({
        id: "unwrap_wrapped_native",
        intent: buildIntent({
          intentType: "unwrap_native",
          tx: {
            to: normalizedOutputToken,
            data: WRAPPED_NATIVE_INTERFACE.encodeFunctionData("withdraw", [minimumOutputAmount(quote.outputAmount, slippageBps).toString()]),
            value: "0",
            gasLimit: unwrapGasLimit,
          },
          metadata: {
            provider: "wrapped_native",
            outputToken: ZERO_TOKEN,
            wrappedOutputToken: normalizedOutputToken,
            minimumOutputAmount: minimumOutputAmount(quote.outputAmount, slippageBps).toString(),
          },
        }),
      });
    }
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
    inputToken: normalizedInputToken,
    inputAsset,
    outputToken: unwrapToNative ? ZERO_TOKEN : normalizedOutputToken,
    wrappedOutputToken: unwrapToNative ? normalizedOutputToken : null,
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

export async function executeTokenDexExperimentPlan({
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
    throw new Error(`Token DEX experiment plan is not executable: ${plan?.blockedReason || "missing_steps"}`);
  }
  const sourceBalanceBefore = await readEvmAssetBalance({
    asset: plan.inputAsset,
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
          ticker: plan.inputAsset?.ticker || null,
          token: plan.inputToken || null,
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
  const sourceBalanceAfter = await readEvmAssetBalance({
    asset: plan.inputAsset,
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
      ticker: plan.inputAsset?.ticker || null,
      token: plan.inputToken || null,
      chain: plan.chain,
    },
    sourceBalanceAfter: {
      ...sourceBalanceAfter,
      ticker: plan.inputAsset?.ticker || null,
      token: plan.inputToken || null,
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
