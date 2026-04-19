import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "../../config/env.mjs";
import { config } from "../../config/env.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { getCoinGeckoPricesUsd } from "../../market/prices.mjs";
import { writeTextIfChanged } from "../../lib/file-write.mjs";
import { runReceiptAutoIngest } from "../ingestor/receipt-auto-ingest.mjs";
import { readSignerHealth, sendSignerCommand } from "../signer/client.mjs";
import { buildDefaultWrappedBtcLendingLoopConfig } from "../../strategy/wrapped-btc-lending-loop-slice.mjs";
import { inspectWrappedBtcLoopBindingsDocument, resolveWrappedBtcLoopBindingSupport } from "../../strategy/wrapped-btc-loop-bindings.mjs";
import {
  buildWrappedBtcLoopLiveProof,
  WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE,
} from "../../strategy/wrapped-btc-loop-live-proof.mjs";
import { buildAutoWrappedBtcLoopScenarioBinding } from "./wrapped-btc-loop-auto-build.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "../helpers/gateway-btc-consolidation.mjs";

export const WRAPPED_BTC_LOOP_STRATEGY_ID = "wrapped-btc-loop-base-moonwell";
export const DEFAULT_EXECUTOR_STRATEGY_BINDINGS_PATH = "./state/executor-strategy-bindings.json";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function bigIntValue(value) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "bigint" ? value : BigInt(value);
}

export function executorStrategyBindingsPath() {
  return getEnv("EXECUTOR_STRATEGY_BINDINGS_PATH", DEFAULT_EXECUTOR_STRATEGY_BINDINGS_PATH);
}

export async function loadExecutorStrategyBindings(path = executorStrategyBindingsPath()) {
  try {
    const document = JSON.parse(await readFile(path, "utf8"));
    const inspection = inspectWrappedBtcLoopBindingsDocument({
      bindingsDocument: document,
      strategyId: WRAPPED_BTC_LOOP_STRATEGY_ID,
    });
    if (!inspection.ok) {
      throw new Error(`Invalid wrapped BTC loop bindings file: ${inspection.errors.join("; ")}`);
    }
    return document;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing signer-owned strategy bindings file: ${path}`);
    }
    throw error;
  }
}

export function resolveWrappedBtcLoopScenarioBinding({
  bindingsDocument,
  strategyId = WRAPPED_BTC_LOOP_STRATEGY_ID,
  scenarioId = "healthy_baseline",
} = {}) {
  const inspection = inspectWrappedBtcLoopBindingsDocument({
    bindingsDocument,
    strategyId,
    scenarioId,
  });
  if (!inspection.ok) {
    throw new Error(`Invalid wrapped BTC loop bindings for ${strategyId}:${scenarioId}: ${inspection.errors.join("; ")}`);
  }
  const strategyBindings = bindingsDocument?.strategies?.[strategyId];
  if (!strategyBindings) {
    throw new Error(`Strategy bindings missing for ${strategyId}`);
  }
  const scenarioBinding = strategyBindings?.scenarios?.[scenarioId];
  if (!scenarioBinding) {
    throw new Error(`Scenario bindings missing for ${strategyId}:${scenarioId}`);
  }
  return scenarioBinding;
}

function normalizeLoopStep(step = {}, { phase, index, now, strategyId, defaultAmountUsd, strategyConfig } = {}) {
  if (!step?.tx?.to) throw new Error(`Wrapped loop ${phase} step is missing tx.to`);
  if (!step?.tx?.data) throw new Error(`Wrapped loop ${phase} step is missing tx.data`);
  const stepKey = step.id || step.label || `${phase}-${index + 1}`;
  const chain = step.chain || step.tx.chain || strategyConfig.chain || "base";
  if (!getEvmChainConfig(chain)) {
    throw new Error(`Wrapped loop ${phase} step uses unsupported chain: ${chain}`);
  }
  const amountUsd = Number(step.amountUsd ?? defaultAmountUsd);
  if (!Number.isFinite(amountUsd)) {
    throw new Error(`Wrapped loop ${phase} step requires a finite amountUsd`);
  }
  const quoteObservedAt = step.quote?.observedAt || step.quoteObservedAt || now;
  return {
    intentId: step.intentId || `${strategyId}:${phase}:${stepKey}`,
    strategyId,
    chain,
    intentType: step.intentType || (phase === "unwind" ? "risk_unwind" : "wrapped_btc_loop_entry"),
    amountUsd,
    mode: step.mode || "live",
    quote: {
      observedAt: quoteObservedAt,
      ...(step.quote || {}),
    },
    approval: step.approval || null,
    tx: {
      ...step.tx,
      chain,
    },
    strategyConfig,
    isLeverage: true,
    executionReason: step.executionReason || (phase === "unwind" ? "risk_unwind" : "strategy_execution"),
    metadata: {
      ...(step.metadata || {}),
      scenarioId: step.scenarioId || null,
      phase,
      skipAutoIngest: true,
    },
  };
}

export async function buildWrappedBtcLoopScenarioPlan({
  bindingsDocument,
  strategyId = WRAPPED_BTC_LOOP_STRATEGY_ID,
  scenarioId = "healthy_baseline",
  now = new Date().toISOString(),
  signerAddress = null,
  prices = null,
  odosClient = null,
  estimateGasImpl = null,
  marketAssumptionsOverride = null,
  perTradeCapUsdOverride = null,
} = {}) {
  const strategyCaps = assertStrategyCaps(strategyId);
  const resolvedPerTradeCapUsd = Number.isFinite(Number(perTradeCapUsdOverride)) && Number(perTradeCapUsdOverride) > 0
    ? Number(perTradeCapUsdOverride)
    : strategyCaps.caps.perTxUsd;
  const strategyConfig = {
    ...buildDefaultWrappedBtcLendingLoopConfig(),
    ...strategyCaps.leverage,
    id: strategyId,
    perTradeCapUsd: resolvedPerTradeCapUsd,
  };
  const strategyBindings = bindingsDocument?.strategies?.[strategyId];
  const scenarioBinding = resolveWrappedBtcLoopScenarioBinding({ bindingsDocument, strategyId, scenarioId });
  const defaultAmountUsd = resolvedPerTradeCapUsd;
  let entrySteps = scenarioBinding.entry || [];
  let unwindSteps = scenarioBinding.unwind || [];
  if (entrySteps.length === 0 && unwindSteps.length === 0) {
    const support = resolveWrappedBtcLoopBindingSupport({
      strategyId,
      strategyConfig,
    });
    if (support.executableFromRepo) {
      const autoBinding = await buildAutoWrappedBtcLoopScenarioBinding({
        strategyId,
        strategyConfig,
        scenarioId,
        signerAddress,
        prices,
        ...(marketAssumptionsOverride ? { marketAssumptions: marketAssumptionsOverride } : {}),
        ...(estimateGasImpl ? { estimateGasImpl } : {}),
        ...(odosClient ? { client: odosClient } : {}),
        now,
      });
      entrySteps = autoBinding.entry;
      unwindSteps = autoBinding.unwind;
    }
  }
  const missingFacts = unique(strategyBindings?.missingFacts || []);
  const missingFactsMessage = missingFacts.length ? ` Missing facts: ${missingFacts.join(" ")}` : "";
  if (entrySteps.length === 0) {
    throw new Error(`Wrapped loop scenario ${scenarioId} requires at least one entry step.${missingFactsMessage}`);
  }
  if (unwindSteps.length === 0) {
    throw new Error(`Wrapped loop scenario ${scenarioId} requires at least one unwind step.${missingFactsMessage}`);
  }
  return {
    strategyId,
    scenarioId,
    strategyCaps,
    scenarioBinding,
    entryIntents: entrySteps.map((step, index) =>
      normalizeLoopStep({
        ...step,
        scenarioId,
      }, {
        phase: "entry",
        index,
        now,
        strategyId,
        defaultAmountUsd,
        strategyConfig,
      })),
    unwindIntents: unwindSteps.map((step, index) =>
      normalizeLoopStep({
        ...step,
        scenarioId,
      }, {
        phase: "unwind",
        index,
        now,
        strategyId,
        defaultAmountUsd,
        strategyConfig,
      })),
    receiptContext: scenarioBinding.receiptContext || {},
  };
}

function feeUsdFromReceipt(receipt, chain, prices) {
  const chainConfig = getEvmChainConfig(chain);
  const nativeUsd = prices?.nativeByChain?.[chain];
  const fee = bigIntValue(receipt?.fee);
  if (!fee || !Number.isFinite(nativeUsd)) return null;
  if (chainConfig?.nativeSymbol === "ETH") {
    return round((Number(fee) / 1e18) * nativeUsd, 6);
  }
  return null;
}

function sumFinite(values = []) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? round(finite.reduce((sum, value) => sum + value, 0), 6) : null;
}

export function buildWrappedBtcLoopReceiptContext({
  plan,
  entryResults = [],
  unwindResults = [],
  prices = null,
} = {}) {
  const bindingContext = plan?.receiptContext || {};
  const entryTxHashes = unique(entryResults.map((item) => item.broadcast?.txHash).filter(Boolean));
  const unwindTxHashes = unique(unwindResults.map((item) => item.broadcast?.txHash).filter(Boolean));
  const computedEntryFeesUsd = sumFinite(
    entryResults.map((item) => feeUsdFromReceipt(item.receipt, item.intent.chain, prices)),
  );
  const computedUnwindFeesUsd = sumFinite(
    unwindResults.map((item) => feeUsdFromReceipt(item.receipt, item.intent.chain, prices)),
  );

  return {
    strategyId: plan.strategyId,
    scenario: plan.scenarioId,
    executionMode: bindingContext.executionMode || "signer_backed_receipt",
    result: bindingContext.result || "passed",
    entryTxHashes,
    unwindTxHashes,
    observedHealthFactorPath: bindingContext.observedHealthFactorPath || [],
    observedLiquidationBufferPath: bindingContext.observedLiquidationBufferPath || [],
    actualLoopFeesUsd: Number.isFinite(bindingContext.actualLoopFeesUsd)
      ? bindingContext.actualLoopFeesUsd
      : computedEntryFeesUsd,
    actualUnwindCostUsd: Number.isFinite(bindingContext.actualUnwindCostUsd)
      ? bindingContext.actualUnwindCostUsd
      : computedUnwindFeesUsd,
    realizedNetCarryUsd: Number.isFinite(bindingContext.realizedNetCarryUsd) ? bindingContext.realizedNetCarryUsd : 0,
    notes: bindingContext.notes || [],
    observedAt: bindingContext.observedAt || null,
  };
}

async function writeWrappedBtcLoopLiveProof({
  liveProof,
  dataDir = config.dataDir,
  writeTextIfChangedImpl = writeTextIfChanged,
} = {}) {
  if (!liveProof) return null;
  return writeTextIfChangedImpl(
    join(dataDir, WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE),
    `${JSON.stringify(liveProof, null, 2)}\n`,
  );
}

export async function finalizeWrappedBtcLoopLiveReceipt({
  strategyId,
  scenarioId,
  perTradeCapUsdOverride = null,
  marketAssumptionsOverride = null,
  entryResults = [],
  unwindResults = [],
  receiptContext = null,
  cwd = process.cwd(),
  now = new Date().toISOString(),
  dataDir = config.dataDir,
  runReceiptAutoIngestImpl = runReceiptAutoIngest,
  writeTextIfChangedImpl = writeTextIfChanged,
} = {}) {
  const initialReceiptAutoIngest = {
    ran: false,
    reason: "pending_auto_ingest",
  };
  const initialLiveProof = buildWrappedBtcLoopLiveProof({
    result: {
      strategyId,
      scenarioId,
      perTradeCapUsdOverride,
      marketAssumptionsOverride,
      entryResults,
      unwindResults,
      receiptAutoIngest: initialReceiptAutoIngest,
      ok: true,
    },
    receiptContext,
    now,
  });
  await writeWrappedBtcLoopLiveProof({
    liveProof: initialLiveProof,
    dataDir,
    writeTextIfChangedImpl,
  });

  const receiptAutoIngest = await runReceiptAutoIngestImpl({
    context: {
      ...(receiptContext || {}),
      ...(initialLiveProof || {}),
    },
    cwd,
  });

  const liveProof = buildWrappedBtcLoopLiveProof({
    result: {
      strategyId,
      scenarioId,
      perTradeCapUsdOverride,
      marketAssumptionsOverride,
      entryResults,
      unwindResults,
      receiptAutoIngest,
      ok: true,
    },
    receiptContext,
    now,
  });
  await writeWrappedBtcLoopLiveProof({
    liveProof,
    dataDir,
    writeTextIfChangedImpl,
  });

  return {
    receiptAutoIngest,
    liveProof,
  };
}

export async function prepareLiveLoopIntent(intent, {
  signerAddress = null,
  estimateGasImpl = estimateGas,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
} = {}) {
  const refreshedObservedAt = new Date().toISOString();
  const refreshNonQuotedStep = intent?.intentType !== "odos_swap";
  const baseIntent = {
    ...intent,
    observedAt: refreshedObservedAt,
    ...(refreshNonQuotedStep
      ? {
          quote: {
            ...(intent.quote || {}),
            observedAt: refreshedObservedAt,
          },
        }
      : {}),
  };
  if (!signerAddress || !intent?.tx?.to || !intent?.tx?.data || !getEvmChainConfig(intent.chain)) {
    return baseIntent;
  }
  try {
    const gasEstimate = await estimateGasImpl(
      intent.chain,
      {
        from: signerAddress,
        to: intent.tx.to,
        data: intent.tx.data,
        valueWei: intent.tx.value ?? intent.tx.valueWei ?? "0",
      },
      getEvmChainConfig(intent.chain),
    );
    return {
      ...baseIntent,
      tx: {
        ...intent.tx,
        gasLimit: String(applyGasBuffer(gasEstimate.gasUnits, gasBufferBps)),
      },
    };
  } catch {
    return baseIntent;
  }
}

async function executeIntent(intent, options = {}) {
  const preparedIntent = await prepareLiveLoopIntent(intent, {
    signerAddress: options.signerAddress,
    estimateGasImpl: options.estimateGasImpl,
    gasBufferBps: options.gasBufferBps,
  });
  const result = await sendSignerCommand({
    socketPath: options.socketPath,
    timeoutMs: options.timeoutMs,
    message: {
      command: options.command || "sign_and_broadcast",
      intent: preparedIntent,
      awaitConfirmation: options.awaitConfirmation !== false,
      confirmations: options.confirmations ?? 1,
      timeoutMs: options.confirmationTimeoutMs ?? 120_000,
    },
  });
  return {
    intent: preparedIntent,
    ...classifyIntentResult(result),
  };
}

export function classifyIntentResult(result = {}) {
  if (result?.status !== "ok") return result;
  if (result?.receipt?.status === 0) {
    return {
      ...result,
      status: "error",
      error: {
        name: "EvmReceiptReverted",
        message: "Transaction reverted after broadcast",
      },
    };
  }
  return result;
}

async function executeIntentBatch(intents = [], options = {}) {
  const results = [];
  for (const intent of intents) {
    const result = await executeIntent(intent, options);
    results.push(result);
    if (result.status !== "ok") {
      break;
    }
  }
  return results;
}

export async function runWrappedBtcLoopLiveScenario({
  bindingsPath = executorStrategyBindingsPath(),
  scenarioId = "healthy_baseline",
  strategyId = WRAPPED_BTC_LOOP_STRATEGY_ID,
  perTradeCapUsdOverride = null,
  marketAssumptionsOverride = null,
  socketPath,
  command = "sign_and_broadcast",
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  timeoutMs = 30_000,
  estimateGasImpl = estimateGas,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  cwd = process.cwd(),
  now = new Date().toISOString(),
} = {}) {
  const bindingsDocument = await loadExecutorStrategyBindings(bindingsPath);
  const [prices, signerHealth] = await Promise.all([
    getCoinGeckoPricesUsd().catch(() => null),
    readSignerHealth({ socketPath, timeoutMs }),
  ]);
  const plan = await buildWrappedBtcLoopScenarioPlan({
    bindingsDocument,
    strategyId,
    scenarioId,
    now,
    signerAddress: signerHealth?.addresses?.base || null,
    prices,
    perTradeCapUsdOverride,
    marketAssumptionsOverride,
  });
  const entryResults = await executeIntentBatch(plan.entryIntents, {
    socketPath,
    command,
    awaitConfirmation,
    confirmations,
    confirmationTimeoutMs,
    timeoutMs,
    signerAddress: signerHealth?.addresses?.base || null,
    estimateGasImpl,
    gasBufferBps,
  });
  const entryFailed = entryResults.some((item) => item.status !== "ok");
  const unwindResults = entryFailed
    ? []
    : await executeIntentBatch(plan.unwindIntents, {
        socketPath,
        command,
        awaitConfirmation,
        confirmations,
        confirmationTimeoutMs,
        timeoutMs,
        signerAddress: signerHealth?.addresses?.base || null,
        estimateGasImpl,
        gasBufferBps,
      });
  const unwindFailed = unwindResults.some((item) => item.status !== "ok");
  let receiptContext = null;
  let receiptAutoIngest = {
    ran: false,
    reason: command === "sign_only" ? "broadcast_required_for_receipt_ingest" : "execution_incomplete",
  };

  if (!entryFailed && !unwindFailed && command !== "sign_only") {
    receiptContext = buildWrappedBtcLoopReceiptContext({
      plan,
      entryResults,
      unwindResults,
      prices,
    });
    ({ receiptAutoIngest } = await finalizeWrappedBtcLoopLiveReceipt({
      strategyId,
      scenarioId,
      perTradeCapUsdOverride,
      marketAssumptionsOverride,
      entryResults,
      unwindResults,
      receiptContext,
      cwd,
      now,
    }));
  }

  return {
    strategyId,
    scenarioId,
    perTradeCapUsdOverride,
    marketAssumptionsOverride,
    bindingsPath,
    command,
    entryResults,
    unwindResults,
    receiptContext,
    receiptAutoIngest,
    ok: !entryFailed && !unwindFailed,
  };
}
