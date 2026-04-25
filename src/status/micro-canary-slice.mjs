// W7 — Micro-canary dashboard slice.
//
// Summarizes the micro-canary stage of every strategy from a tick
// report so the dashboard can display
// "not_started / micro_canary_ready / minimal_live_proof_exists / micro_canary_repeatable"
// without reading raw JSONL.
//
// Pure function. No I/O.

export function buildMicroCanarySlice(reports = []) {
  const total = reports.length;
  const notStarted = reports.filter(
    (r) => r?.microCanaryStatus === "not_started",
  );
  const ready = reports.filter(
    (r) => r?.microCanaryStatus === "micro_canary_ready",
  );
  const minimalLiveProof = reports.filter(
    (r) => r?.microCanaryStatus === "minimal_live_proof_exists",
  );
  const repeatable = reports.filter(
    (r) => r?.microCanaryStatus === "micro_canary_repeatable",
  );
  const byStrategy = Object.fromEntries(
    reports.map((r) => [
      r.strategyId || "unknown",
      {
        microCanaryStatus: r?.microCanaryStatus || "not_started",
        signerBackedCount: r?.evidence?.signerBackedCount ?? 0,
        passedCount: r?.evidence?.passedCount ?? 0,
        mode: r?.mode || "blocked",
        lastFailureReason: r?.blockers?.[0] || null,
        realizedNetUsd: r?.evidence?.realizedNetUsd ?? null,
      },
    ]),
  );
  return Object.freeze({
    total,
    notStartedCount: notStarted.length,
    readyCount: ready.length,
    minimalLiveProofExistsCount: minimalLiveProof.length,
    repeatableCount: repeatable.length,
    byStrategy: Object.freeze(byStrategy),
    generatedAt: new Date().toISOString(),
  });
}

export function summarizeMicroCanaryForStage(stage = "not_started", reports = []) {
  const subset = reports.filter((r) => r?.microCanaryStatus === stage);
  return Object.freeze({
    stage,
    count: subset.length,
    strategyIds: subset.map((r) => r.strategyId).filter(Boolean),
  });
}
