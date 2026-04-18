import { evaluateLeverageWatcher } from "../defi/leverage-watchers.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function scenario(id, label, decision) {
  return {
    id,
    label,
    watcherStatus: decision.status,
    triggers: decision.triggers,
    shouldPauseNewEntries: decision.shouldPauseNewEntries,
    shouldAutoUnwind: decision.shouldAutoUnwind,
  };
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function requireNonEmptyArray(label, values) {
  if ((values || []).length > 0) return values;
  throw new Error(`Missing required wrapped BTC loop receipt field: ${label}`);
}

function requireFiniteNumber(label, value) {
  if (Number.isFinite(value)) return value;
  throw new Error(`Missing required wrapped BTC loop receipt field: ${label}`);
}

export function buildWrappedBtcLendingLoopDryRunPacket({ scaffold = null, now = null } = {}) {
  if (!scaffold) return null;
  const strategy = scaffold.strategy || {};
  const market = scaffold.marketAssumptions || {};
  const projectedHealthFactor = scaffold.entryPlan?.projectedHealthFactor ?? null;
  const projectedLiquidationBufferPct = scaffold.entryPlan?.projectedLiquidationBufferPct ?? null;

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
          oracleDriftTriggerPct: market.oracleDriftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
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
          oracleDriftTriggerPct: market.oracleDriftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
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
          oracleDriftTriggerPct: market.oracleDriftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
    ),
    scenario(
      "oracle_drift_pause",
      "Oracle drift pauses new entries before health breach",
      evaluateLeverageWatcher({
        strategyConfig: strategy,
        positionState: {
          currentHealthFactor: projectedHealthFactor,
          currentLiquidationBufferPct: projectedLiquidationBufferPct,
        },
        marketState: {
          oracleDriftPct: market.oracleDriftTriggerPct,
          oracleDriftTriggerPct: market.oracleDriftTriggerPct,
          unwindGasUsd: 0,
          maxUnwindGasUsd: market.maxUnwindGasUsd,
        },
      }),
    ),
  ];

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    strategy: {
      id: strategy.id || null,
      protocol: strategy.protocol || null,
      chain: strategy.chain || null,
    },
    readiness: {
      technicalStatus: scaffold.protocolAdapter?.id && scaffold.executionPlan?.actionCount > 0 ? "dry_run_ready" : "adapter_missing",
      evidenceStatus: scaffold.blockers?.includes("dry_run_unwind_not_recorded") ? "awaiting_dry_run_receipt" : "receipt_recorded",
      blockerCount: scaffold.blockers?.length ?? 0,
    },
    executionPreview: {
      adapterId: scaffold.protocolAdapter?.id || null,
      entryActionCount: scaffold.executionPlan?.actionCount ?? 0,
      unwindActionCount: scaffold.unwindPlan?.actions?.length ?? 0,
      firstEntryActions: scaffold.executionPlan?.actions?.slice(0, 4) || [],
      firstUnwindActions: scaffold.unwindPlan?.actions?.slice(0, 4) || [],
    },
    watcherScenarios: scenarios,
    receiptTemplate: {
      dryRunId: `${strategy.id || "wrapped-btc-loop"}:dry-run`,
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
        "Populate only from fork or dry-run executor output.",
        "Do not mark the loop live-eligible until a real dry-run receipt is recorded here or in an equivalent signer-owned ledger.",
      ],
    },
    nextActions: unique([
      "bind allowlisted contract addresses in signer-owned config",
      "run fork/dry-run entry and forced unwind path",
      "record actual fee, health-factor, and unwind receipt fields",
    ]),
  };
}

export function buildWrappedBtcLendingLoopDryRunReceipt({
  scaffold = null,
  packet = null,
  scenarioId = "health_factor_breach",
  now = null,
} = {}) {
  if (!scaffold || !packet) return null;
  const scenarioRecord = (packet.watcherScenarios || []).find((item) => item.id === scenarioId) || packet.watcherScenarios?.[0] || null;
  const strategyId = scaffold.strategy?.id || "wrapped-btc-loop";
  const executionMode = "simulated_dry_run";
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
    executionMode,
    result: passed ? "passed" : "failed",
    watcherStatus: scenarioRecord?.watcherStatus || null,
    triggers: scenarioRecord?.triggers || [],
    entryTxHashes: (scaffold.executionPlan?.actions || []).slice(0, 3).map((action) => `dryrun:${strategyId}:entry:${action.step}`),
    unwindTxHashes: (scaffold.unwindPlan?.actions || []).slice(0, 3).map((action) => `dryrun:${strategyId}:unwind:${action.step}`),
    observedHealthFactorPath,
    observedLiquidationBufferPath,
    actualLoopFeesUsd: round(scaffold.pnl?.paper?.entryLoopFeesUsd ?? null, 4),
    actualUnwindCostUsd: round(
      (scaffold.pnl?.paper?.unwindSlippageUsd ?? 0) + (scaffold.pnl?.paper?.unwindFixedCostUsd ?? 0),
      4,
    ),
    realizedNetCarryUsd: round(scaffold.pnl?.paper?.annualNetCarryUsd ?? null, 4),
    notes: [
      "This receipt is generated from the deterministic dry-run harness, not from a live signer path.",
      "Use it to prove watcher/unwind wiring before a fork-backed receipt exists.",
    ],
  };
}

export function buildWrappedBtcLoopObservedReceipt({
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
  const packet = buildWrappedBtcLendingLoopDryRunPacket({ scaffold, now });
  const scenarioRecord = (packet?.watcherScenarios || []).find((item) => item.id === scenarioId) || null;
  if (!scenarioRecord) {
    throw new Error(`Unknown wrapped BTC loop receipt scenario: ${scenarioId}`);
  }
  if (!executionMode || executionMode === "simulated_dry_run") {
    throw new Error(`Observed wrapped BTC loop receipts require a non-simulated execution mode, received: ${executionMode || "unknown"}`);
  }
  if (!["passed", "failed"].includes(result)) {
    throw new Error(`Invalid wrapped BTC loop receipt result: ${result}`);
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
  const strategyId = scaffold.strategy?.id || "wrapped-btc-loop";
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

export function buildWrappedBtcLoopReceiptGuide({ scaffold = null, liveProof = null } = {}) {
  const packet = buildWrappedBtcLendingLoopDryRunPacket({ scaffold });
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
  const preferredScenario = supportedScenarios.includes("healthy_baseline") ? "healthy_baseline" : supportedScenarios[0] || "healthy_baseline";
  const missingFields = new Set(liveProof?.missingExtendedReceiptFields || []);
  const commandParts = [
    "npm run ingest:wrapped-btc-loop-receipt -- --write",
    `--scenario=${liveProof?.scenarioId || preferredScenario}`,
    `--execution-mode=${liveProof?.executionMode || "signer_backed_receipt"}`,
    `--result=${liveProof?.result || "passed"}`,
  ];
  if (!liveProof?.entryTxHashes?.length) {
    commandParts.push("--entry-tx-hashes=<entry-tx-hash-1>,<entry-tx-hash-2>");
  }
  if (!liveProof?.unwindTxHashes?.length) {
    commandParts.push("--unwind-tx-hashes=<unwind-tx-hash-1>");
  }
  if (!Number.isFinite(liveProof?.actualLoopFeesUsd)) {
    commandParts.push("--actual-loop-fees-usd=<loop-fees-usd>");
  }
  if (!Number.isFinite(liveProof?.actualUnwindCostUsd)) {
    commandParts.push("--actual-unwind-cost-usd=<unwind-cost-usd>");
  }
  if (missingFields.size === 0 || missingFields.has("observedHealthFactorPath")) {
    commandParts.push("--health-factor-path=<hf-1>,<hf-2>");
  }
  if (missingFields.size === 0 || missingFields.has("observedLiquidationBufferPath")) {
    commandParts.push("--liquidation-buffer-path=<buffer-pct-1>,<buffer-pct-2>");
  }
  if (missingFields.size === 0 || missingFields.has("realizedNetCarryUsd")) {
    commandParts.push("--realized-net-carry-usd=<realized-net-carry-usd>");
  }
  return {
    supportedScenarios,
    requiredFields,
    minPassedSignerBackedRuns: 2,
    sampleCommand: commandParts.join(" "),
  };
}

export function summarizeWrappedBtcLendingLoopDryRunRuns(records = []) {
  const latest = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const passedCount = records.filter((item) => item.result === "passed").length;
  const autoUnwindPassCount = records.filter((item) => item.result === "passed" && item.watcherStatus === "auto_unwind").length;
  return {
    runCount: records.length,
    passedCount,
    autoUnwindPassCount,
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
