import { buildEmergencyUnwindExecutionPlan, evaluateLeverageWatcher } from "./leverage-watchers.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function severityForStatus(status) {
  if (status === "auto_unwind") return "critical";
  if (status === "pause_new_entries") return "warning";
  return "info";
}

function nextActionForStatus(status) {
  if (status === "auto_unwind") {
    return {
      code: "submit_emergency_unwind_intent",
      command: null,
    };
  }
  if (status === "pause_new_entries") {
    return {
      code: "pause_new_entries_and_review",
      command: null,
    };
  }
  return {
    code: "continue_monitoring",
    command: null,
  };
}

export function buildObservedPositionState({ scaffold = null, observedPosition = {} } = {}) {
  return {
    currentHealthFactor:
      finite(observedPosition.currentHealthFactor) ??
      finite(scaffold?.positionState?.currentHealthFactor) ??
      finite(scaffold?.entryPlan?.projectedHealthFactor),
    currentLiquidationBufferPct:
      finite(observedPosition.currentLiquidationBufferPct) ??
      finite(scaffold?.positionState?.currentLiquidationBufferPct) ??
      finite(scaffold?.entryPlan?.projectedLiquidationBufferPct),
  };
}

export function buildObservedMarketState({ scaffold = null, observedMarket = {} } = {}) {
  const marketAssumptions = scaffold?.marketAssumptions || {};
  return {
    oracleDriftPct:
      finite(observedMarket.oracleDriftPct) ??
      finite(scaffold?.oracleSanity?.protocolDriftPct) ??
      0,
    oracleDriftTriggerPct:
      finite(observedMarket.oracleDriftTriggerPct) ??
      finite(marketAssumptions.oracleDriftTriggerPct),
    unwindGasUsd: finite(observedMarket.unwindGasUsd) ?? 0,
    maxUnwindGasUsd:
      finite(observedMarket.maxUnwindGasUsd) ??
      finite(marketAssumptions.maxUnwindGasUsd),
  };
}

export function buildLeverageRiskEvent({ runtimeReport = null } = {}) {
  if (!runtimeReport) return null;
  return {
    schemaVersion: 1,
    eventType: "leverage_auto_unwind_runtime",
    observedAt: runtimeReport.generatedAt,
    strategyId: runtimeReport.strategy?.id || null,
    strategyLabel: runtimeReport.strategy?.label || null,
    chain: runtimeReport.strategy?.chain || null,
    protocol: runtimeReport.strategy?.protocol || null,
    status: runtimeReport.runtime?.status || "unknown",
    severity: runtimeReport.runtime?.severity || "info",
    triggers: runtimeReport.watcherDecision?.triggers || [],
    shouldAutoUnwind: runtimeReport.watcherDecision?.shouldAutoUnwind === true,
    shouldPauseNewEntries: runtimeReport.watcherDecision?.shouldPauseNewEntries === true,
    emergencyUnwindStatus: runtimeReport.emergencyUnwindExecution?.status || null,
    unwindActionCount: runtimeReport.emergencyUnwindExecution?.actions?.length ?? 0,
    positionState: runtimeReport.positionState || {},
    marketState: runtimeReport.marketState || {},
    nextAction: runtimeReport.nextAction || null,
  };
}

export function summarizeLeverageAutoUnwindRuntimeReport(report = null) {
  if (!report) return null;
  return {
    strategyId: report.strategy?.id || null,
    strategyLabel: report.strategy?.label || null,
    chain: report.strategy?.chain || null,
    protocol: report.strategy?.protocol || null,
    status: report.runtime?.status || null,
    severity: report.runtime?.severity || null,
    triggerCount: report.runtime?.triggerCount ?? report.watcherDecision?.triggers?.length ?? 0,
    triggers: report.watcherDecision?.triggers || [],
    emergencyUnwindStatus: report.emergencyUnwindExecution?.status || null,
    unwindActionCount: report.emergencyUnwindExecution?.actions?.length ?? 0,
    nextAction: report.nextAction || null,
  };
}

export function summarizeLeverageAutoUnwindRuntimeReports(reports = []) {
  const items = (reports || []).map((item) => summarizeLeverageAutoUnwindRuntimeReport(item)).filter(Boolean);
  const statusCounts = items.reduce((acc, item) => {
    const key = item.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topPriority =
    items.find((item) => item.status === "auto_unwind") ||
    items.find((item) => item.status === "pause_new_entries") ||
    items[0] ||
    null;
  return {
    runtimeCount: items.length,
    statusCounts,
    topPriority,
    items,
  };
}

export function buildLeverageAutoUnwindRuntime({
  scaffold = null,
  observedPosition = {},
  observedMarket = {},
  now = null,
  executionMode = "monitor",
} = {}) {
  if (!scaffold?.strategy?.id) {
    throw new Error("scaffold.strategy.id is required");
  }
  const generatedAt = now || new Date().toISOString();
  const positionState = buildObservedPositionState({ scaffold, observedPosition });
  const marketState = buildObservedMarketState({ scaffold, observedMarket });
  const watcherDecision = evaluateLeverageWatcher({
    strategyConfig: scaffold.strategy,
    positionState,
    marketState,
  });
  const emergencyUnwindExecution = buildEmergencyUnwindExecutionPlan({
    strategyConfig: scaffold.strategy,
    protocolAdapter: scaffold.protocolAdapter,
    unwindActions: scaffold?.unwindPlan?.actions || scaffold?.emergencyUnwindExecution?.actions || [],
    watcherDecision,
    positionState,
    now: generatedAt,
  });
  const runtime = {
    status: watcherDecision.status,
    severity: severityForStatus(watcherDecision.status),
    executionMode,
    runtimeWired: true,
    triggerCount: watcherDecision.triggers.length,
  };
  const report = {
    schemaVersion: 1,
    generatedAt,
    strategy: {
      id: scaffold.strategy?.id || null,
      label: scaffold.strategy?.label || null,
      chain: scaffold.strategy?.chain || null,
      protocol: scaffold.strategy?.protocol || null,
      isLeverage: scaffold.strategy?.isLeverage === true,
    },
    runtime,
    positionState: {
      currentHealthFactor: round(positionState.currentHealthFactor),
      currentLiquidationBufferPct: round(positionState.currentLiquidationBufferPct),
    },
    marketState: {
      oracleDriftPct: round(marketState.oracleDriftPct),
      oracleDriftTriggerPct: round(marketState.oracleDriftTriggerPct),
      unwindGasUsd: round(marketState.unwindGasUsd),
      maxUnwindGasUsd: round(marketState.maxUnwindGasUsd),
    },
    watcherDecision,
    emergencyUnwindExecution,
    evidence: {
      scaffoldGeneratedAt: scaffold.generatedAt || null,
      dryRunReceiptRecorded: scaffold?.dryRunSummary?.dryRunReceiptRecorded === true,
      signerBackedRunCount: scaffold?.dryRunSummary?.signerBackedRunCount ?? 0,
      unwindActionCount: emergencyUnwindExecution?.actions?.length ?? 0,
      protocolAdapterId:
        scaffold?.protocolAdapter?.id ||
        scaffold?.emergencyUnwindExecution?.protocolAdapterId ||
        null,
      notes: unique([
        "Auto-unwind runtime is deterministic and signer-facing only.",
        runtime.status === "healthy" ? "No active breach trigger is present." : null,
        runtime.status === "pause_new_entries" ? "Expansion should pause until the breach source clears." : null,
        runtime.status === "auto_unwind" ? "Emergency unwind is ready to submit on the signer path." : null,
      ]),
    },
    nextAction: nextActionForStatus(runtime.status),
  };
  return {
    ...report,
    riskEvent: buildLeverageRiskEvent({ runtimeReport: report }),
  };
}
