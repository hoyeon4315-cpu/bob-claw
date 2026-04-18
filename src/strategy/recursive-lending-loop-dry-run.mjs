import { evaluateLeverageWatcher } from "../defi/leverage-watchers.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scenario(id, label, decision, checkId = null) {
  return {
    id,
    label,
    checkId,
    watcherStatus: decision.status,
    triggers: decision.triggers,
    shouldPauseNewEntries: decision.shouldPauseNewEntries,
    shouldAutoUnwind: decision.shouldAutoUnwind,
  };
}

function requireNonEmptyArray(label, values) {
  if ((values || []).length > 0) return values;
  throw new Error(`Missing required recursive lending loop receipt field: ${label}`);
}

function requireFiniteNumber(label, value) {
  if (Number.isFinite(value)) return value;
  throw new Error(`Missing required recursive lending loop receipt field: ${label}`);
}

function driftScenarioMetadata(scaffold = null) {
  const arrivalFamily = scaffold?.strategy?.arrivalFamily || "wrapped_btc";
  if (arrivalFamily === "stablecoin") {
    return {
      id: "peg_drift_pause",
      label: "Peg drift pauses new entries before health breach",
      checkId: "peg_drift",
      triggerPct: scaffold?.strategy?.pegDriftTriggerPct ?? scaffold?.marketAssumptions?.oracleDriftTriggerPct ?? null,
    };
  }
  return {
    id: "oracle_drift_pause",
    label: "Oracle drift pauses new entries before health breach",
    checkId: "oracle_drift",
    triggerPct: scaffold?.marketAssumptions?.oracleDriftTriggerPct ?? null,
  };
}

export function recursiveLendingLoopDryRunSessionName(strategyId = "recursive_wrapped_btc_lending_loop") {
  if (strategyId === "recursive_wrapped_btc_lending_loop") return "wrapped-btc-loop-dry-runs";
  if (strategyId === "recursive_stablecoin_lending_loop") return "stablecoin-lending-loop-dry-runs";
  return `${strategyId}-dry-runs`;
}

export function filterRecursiveLendingLoopDryRunRecords(records = [], strategyId = null) {
  if (!strategyId) return [...(records || [])];
  return (records || []).filter((item) => item?.strategyId === strategyId);
}

export function buildRecursiveLendingLoopDryRunPacket({ scaffold = null, now = null } = {}) {
  if (!scaffold) return null;
  const strategy = scaffold.strategy || {};
  const market = scaffold.marketAssumptions || {};
  const projectedHealthFactor = scaffold.entryPlan?.projectedHealthFactor ?? null;
  const projectedLiquidationBufferPct = scaffold.entryPlan?.projectedLiquidationBufferPct ?? null;
  const driftMetadata = driftScenarioMetadata(scaffold);
  const driftTriggerPct = driftMetadata.triggerPct;

  const scenarios = [
    scenario(
      "healthy_baseline",
      "Healthy projected baseline",
      evaluateLeverageWatcher({
        strategyConfig: strategy,
        positionState: {
          currentHealthFactor: projectedHealthFactor,
          currentLiquidationBufferPct: projectedLiquidationBufferPct,
        },
        marketState: {
          oracleDriftPct: 0,
          oracleDriftTriggerPct: driftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
      "health_factor_floor",
    ),
    scenario(
      "health_factor_breach",
      "Health factor falls through unwind trigger",
      evaluateLeverageWatcher({
        strategyConfig: strategy,
        positionState: {
          currentHealthFactor: strategy.unwindTriggerHealthFactor - 0.01,
          currentLiquidationBufferPct: projectedLiquidationBufferPct,
        },
        marketState: {
          oracleDriftPct: 0,
          oracleDriftTriggerPct: driftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
      "unwind_trigger_health_factor",
    ),
    scenario(
      "buffer_breach",
      "Liquidation buffer compresses below minimum",
      evaluateLeverageWatcher({
        strategyConfig: strategy,
        positionState: {
          currentHealthFactor: projectedHealthFactor,
          currentLiquidationBufferPct: strategy.liquidationBufferPct - 1,
        },
        marketState: {
          oracleDriftPct: 0,
          oracleDriftTriggerPct: driftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
      "liquidation_buffer_floor",
    ),
    scenario(
      driftMetadata.id,
      driftMetadata.label,
      evaluateLeverageWatcher({
        strategyConfig: strategy,
        positionState: {
          currentHealthFactor: projectedHealthFactor,
          currentLiquidationBufferPct: projectedLiquidationBufferPct,
        },
        marketState: {
          oracleDriftPct: driftTriggerPct,
          oracleDriftTriggerPct: driftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
      driftMetadata.checkId,
    ),
  ];

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    strategy: {
      id: strategy.id || null,
      protocol: strategy.protocol || null,
      chain: strategy.chain || null,
      arrivalFamily: strategy.arrivalFamily || null,
    },
    readiness: {
      technicalStatus: scaffold.readiness?.readyForDryRun ? "dry_run_ready" : "adapter_missing",
      evidenceStatus: scaffold.blockers?.includes("dry_run_unwind_not_recorded") ? "awaiting_dry_run_receipt" : "receipt_recorded",
      blockerCount: scaffold.blockers?.length ?? 0,
    },
    executionPreview: {
      adapterId: scaffold.protocolAdapter?.id || null,
      executionSupportStatus: scaffold.executionSupport?.status || null,
      entryActionCount: scaffold.executionPlan?.actionCount ?? 0,
      unwindActionCount: scaffold.unwindPlan?.actions?.length ?? 0,
      firstEntryActions: scaffold.executionPlan?.actions?.slice(0, 4) || [],
      firstUnwindActions: scaffold.unwindPlan?.actions?.slice(0, 4) || [],
    },
    watcherScenarios: scenarios,
    receiptTemplate: {
      dryRunId: `${strategy.id || "recursive-lending-loop"}:dry-run`,
      status: "pending_execution",
      requiredFields: [
        "entryTxHashes",
        "unwindTxHashes",
        "observedHealthFactorPath",
        "observedLiquidationBufferPath",
        "actualLoopFeesUsd",
        "actualUnwindCostUsd",
        "realizedNetCarryUsd",
        "result",
      ],
      notes: [
        "Populate observed receipts only from fork or signer-owned executor output.",
        "Do not mark the strategy live-eligible until a real dry-run receipt is recorded here or in an equivalent signer-owned ledger.",
      ],
    },
    nextActions: unique([
      ...(scaffold.nextActions || []),
      "record actual fee, health-factor, and unwind receipt fields",
    ]),
  };
}

export function buildRecursiveLendingLoopDryRunReceipt({
  scaffold = null,
  packet = null,
  scenarioId = "health_factor_breach",
  now = null,
} = {}) {
  if (!scaffold || !packet) return null;
  const scenarioRecord = (packet.watcherScenarios || []).find((item) => item.id === scenarioId) || packet.watcherScenarios?.[0] || null;
  const strategyId = scaffold.strategy?.id || "recursive-lending-loop";
  const observedHealthFactorPath =
    scenarioId === "health_factor_breach"
      ? [scaffold.entryPlan?.projectedHealthFactor ?? null, scaffold.strategy?.unwindTriggerHealthFactor ?? null]
      : scenarioId === "buffer_breach"
        ? [scaffold.entryPlan?.projectedHealthFactor ?? null, scaffold.strategy?.healthFactorMin ?? null]
        : [scaffold.entryPlan?.projectedHealthFactor ?? null];
  const observedLiquidationBufferPath =
    scenarioId === "buffer_breach"
      ? [scaffold.entryPlan?.projectedLiquidationBufferPct ?? null, scaffold.strategy?.liquidationBufferPct ?? null]
      : [scaffold.entryPlan?.projectedLiquidationBufferPct ?? null];
  const autoUnwindExpected = ["health_factor_breach", "buffer_breach"].includes(scenarioId);
  const passed =
    scenarioRecord &&
    scenarioRecord.shouldAutoUnwind === autoUnwindExpected &&
    (scenarioRecord.shouldAutoUnwind ? (scaffold.unwindPlan?.actions?.length || 0) > 0 : true);

  return {
    schemaVersion: 1,
    observedAt: now || new Date().toISOString(),
    runId: `${strategyId}:${scenarioId}:${Date.now()}`,
    strategyId,
    scenarioId,
    scenarioLabel: scenarioRecord?.label || null,
    executionMode: "simulated_dry_run",
    result: passed ? "passed" : "failed",
    watcherStatus: scenarioRecord?.watcherStatus || null,
    triggers: scenarioRecord?.triggers || [],
    entryTxHashes: (scaffold.executionPlan?.actions || []).slice(0, 3).map((action) => `dryrun:${strategyId}:entry:${action.step}`),
    unwindTxHashes: (scaffold.unwindPlan?.actions || []).slice(0, 3).map((action) => `dryrun:${strategyId}:unwind:${action.step}`),
    observedHealthFactorPath: observedHealthFactorPath.filter(Number.isFinite).map((value) => round(value, 4)),
    observedLiquidationBufferPath: observedLiquidationBufferPath.filter(Number.isFinite).map((value) => round(value, 4)),
    actualLoopFeesUsd: round(scaffold.pnl?.paper?.entryLoopFeesUsd ?? null, 4),
    actualUnwindCostUsd: round((scaffold.pnl?.paper?.unwindSlippageUsd ?? 0) + (scaffold.pnl?.paper?.unwindFixedCostUsd ?? 0), 4),
    realizedNetCarryUsd: round(scaffold.pnl?.paper?.annualNetCarryUsd ?? null, 4),
    notes: [
      "This receipt is generated from the deterministic dry-run harness, not from a live signer path.",
      "Use it to prove watcher/unwind wiring before a fork-backed receipt exists.",
    ],
  };
}

export function buildRecursiveLendingLoopObservedReceipt({
  scaffold = null,
  scenarioId = "healthy_baseline",
  executionMode = "signer_backed_receipt",
  result = "passed",
  entryTxHashes = [],
  unwindTxHashes = [],
  observedHealthFactorPath = [],
  observedLiquidationBufferPath = [],
  actualLoopFeesUsd = null,
  actualUnwindCostUsd = null,
  realizedNetCarryUsd = null,
  notes = [],
  now = null,
} = {}) {
  if (!scaffold) return null;
  const packet = buildRecursiveLendingLoopDryRunPacket({ scaffold, now });
  const scenarioRecord = (packet?.watcherScenarios || []).find((item) => item.id === scenarioId) || null;
  if (!scenarioRecord) {
    throw new Error(`Unknown recursive lending loop receipt scenario: ${scenarioId}`);
  }
  if (!executionMode || executionMode === "simulated_dry_run") {
    throw new Error(`Observed recursive lending loop receipts require a non-simulated execution mode, received: ${executionMode || "unknown"}`);
  }
  if (!["passed", "failed"].includes(result)) {
    throw new Error(`Invalid recursive lending loop receipt result: ${result}`);
  }
  const normalizedEntryTxHashes = unique((entryTxHashes || []).filter(Boolean));
  const normalizedUnwindTxHashes = unique((unwindTxHashes || []).filter(Boolean));
  const normalizedObservedHealthFactorPath = (observedHealthFactorPath || []).filter(Number.isFinite).map((value) => round(value, 4));
  const normalizedObservedLiquidationBufferPath = (observedLiquidationBufferPath || []).filter(Number.isFinite).map((value) => round(value, 4));
  const normalizedActualLoopFeesUsd = round(actualLoopFeesUsd, 4);
  const normalizedActualUnwindCostUsd = round(actualUnwindCostUsd, 4);
  const normalizedRealizedNetCarryUsd = round(realizedNetCarryUsd, 4);
  requireNonEmptyArray("entryTxHashes", normalizedEntryTxHashes);
  requireNonEmptyArray("unwindTxHashes", normalizedUnwindTxHashes);
  requireNonEmptyArray("observedHealthFactorPath", normalizedObservedHealthFactorPath);
  requireNonEmptyArray("observedLiquidationBufferPath", normalizedObservedLiquidationBufferPath);
  requireFiniteNumber("actualLoopFeesUsd", normalizedActualLoopFeesUsd);
  requireFiniteNumber("actualUnwindCostUsd", normalizedActualUnwindCostUsd);
  requireFiniteNumber("realizedNetCarryUsd", normalizedRealizedNetCarryUsd);
  const strategyId = scaffold.strategy?.id || "recursive-lending-loop";
  return {
    schemaVersion: 1,
    observedAt: now || new Date().toISOString(),
    runId: `${strategyId}:${scenarioId}:${executionMode}:${Date.now()}`,
    strategyId,
    scenarioId,
    scenarioLabel: scenarioRecord?.label || null,
    executionMode,
    result,
    watcherStatus: scenarioRecord?.watcherStatus || null,
    triggers: scenarioRecord?.triggers || [],
    entryTxHashes: normalizedEntryTxHashes,
    unwindTxHashes: normalizedUnwindTxHashes,
    observedHealthFactorPath: normalizedObservedHealthFactorPath,
    observedLiquidationBufferPath: normalizedObservedLiquidationBufferPath,
    actualLoopFeesUsd: normalizedActualLoopFeesUsd,
    actualUnwindCostUsd: normalizedActualUnwindCostUsd,
    realizedNetCarryUsd: normalizedRealizedNetCarryUsd,
    notes: unique([
      "Receipt ingested from an external signer/executor path; do not treat it as simulated dry-run evidence.",
      ...(notes || []),
    ]),
  };
}

export function buildRecursiveLendingLoopReceiptGuide({ scaffold = null, strategyId = null } = {}) {
  const effectiveStrategyId = strategyId || scaffold?.strategy?.id || "recursive_wrapped_btc_lending_loop";
  const packet = buildRecursiveLendingLoopDryRunPacket({ scaffold });
  const requiredFields = packet?.receiptTemplate?.requiredFields || [
    "entryTxHashes",
    "unwindTxHashes",
    "observedHealthFactorPath",
    "observedLiquidationBufferPath",
    "actualLoopFeesUsd",
    "actualUnwindCostUsd",
    "realizedNetCarryUsd",
    "result",
  ];
  const supportedScenarios =
    packet?.watcherScenarios?.map((item) => item.id) || [
      "healthy_baseline",
      "health_factor_breach",
      "buffer_breach",
      "oracle_drift_pause",
    ];
  const preferredScenario = supportedScenarios.includes("healthy_baseline")
    ? "healthy_baseline"
    : supportedScenarios[0] || "healthy_baseline";
  return {
    supportedScenarios,
    requiredFields,
    sampleCommand: [
      "npm run ingest:recursive-lending-loop-receipt -- --write",
      `--strategy=${effectiveStrategyId}`,
      `--scenario=${preferredScenario}`,
      "--execution-mode=signer_backed_receipt",
      "--result=passed",
      "--entry-tx-hashes=<entry-tx-hash-1>,<entry-tx-hash-2>",
      "--unwind-tx-hashes=<unwind-tx-hash-1>",
      "--health-factor-path=<hf-1>,<hf-2>",
      "--liquidation-buffer-path=<buffer-pct-1>,<buffer-pct-2>",
      "--actual-loop-fees-usd=<loop-fees-usd>",
      "--actual-unwind-cost-usd=<unwind-cost-usd>",
      "--realized-net-carry-usd=<realized-net-carry-usd>",
    ].join(" "),
  };
}

export function summarizeRecursiveLendingLoopDryRunRuns(records = []) {
  const latest = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const passedCount = records.filter((item) => item?.result === "passed").length;
  const autoUnwindPassCount = records.filter((item) => item?.result === "passed" && item?.watcherStatus === "auto_unwind").length;
  const signerBackedRunCount = records.filter((item) => item?.executionMode && item.executionMode !== "simulated_dry_run").length;
  return {
    runCount: records.length,
    passedCount,
    autoUnwindPassCount,
    signerBackedRunCount,
    latestObservedAt: latest?.observedAt || null,
    latestRun: latest
      ? {
          runId: latest.runId || null,
          scenarioId: latest.scenarioId || null,
          result: latest.result || null,
          executionMode: latest.executionMode || null,
          watcherStatus: latest.watcherStatus || null,
        }
      : null,
    dryRunReceiptRecorded: autoUnwindPassCount > 0,
  };
}
