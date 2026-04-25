function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

export function buildWrappedBtcLoopOosEvidence({ records = [], now = null } = {}) {
  const distinctScenarioCount = unique(records.map((item) => item.scenarioId)).length;
  const distinctExecutionModes = unique(records.map((item) => item.executionMode));
  const signerBackedRuns = records.filter((item) => item.executionMode && item.executionMode !== "simulated_dry_run");
  const simulatedPassedRuns = records.filter((item) => item.executionMode === "simulated_dry_run" && item.result === "passed");
  const simulatedWindowReady = simulatedPassedRuns.length >= 4 && distinctScenarioCount >= 3;
  const signerWindowReady = signerBackedRuns.filter((item) => item.result === "passed").length >= 2;
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      runCount: records.length,
      distinctScenarioCount,
      distinctExecutionModeCount: distinctExecutionModes.length,
      simulatedPassedCount: simulatedPassedRuns.length,
      signerBackedRunCount: signerBackedRuns.length,
      simulatedWindowReady,
      signerWindowReady,
      status: signerWindowReady ? "signer_backed_window_ready" : simulatedWindowReady ? "simulated_window_ready" : "collecting",
      nextAction: signerWindowReady ? null : { code: "collect_signer_backed_oos_receipts", command: "npm run ingest:wrapped-btc-loop-receipt -- --write" },
    },
    scenarios: unique(records.map((item) => item.scenarioId)).sort(),
    executionModes: distinctExecutionModes,
  };
}

export function summarizeWrappedBtcLoopOosEvidence(report = null) {
  if (!report) return null;
  return {
    runCount: report.summary?.runCount ?? 0,
    distinctScenarioCount: report.summary?.distinctScenarioCount ?? 0,
    simulatedPassedCount: report.summary?.simulatedPassedCount ?? 0,
    signerBackedRunCount: report.summary?.signerBackedRunCount ?? 0,
    status: report.summary?.status || null,
    nextAction: report.summary?.nextAction || null,
  };
}
