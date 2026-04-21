// W7 — Strategy promotion-stage dashboard slice.
//
// Summarizes the promotion ladder (blocked → shadow_ready → live_candidate)
// across all strategy tick reports so the dashboard can display
// "which stage is each strategy in" without reading raw JSONL.
//
// Pure function. No I/O.

export const STAGES = Object.freeze([
  "blocked",
  "shadow_ready",
  "live_candidate",
]);

export function buildStrategyStageSlice(reports = []) {
  const total = reports.length;
  const blocked = reports.filter((r) => r?.mode === "blocked");
  const shadowReady = reports.filter((r) => r?.mode === "shadow_ready");
  const liveCandidate = reports.filter((r) => r?.mode === "live_candidate");
  const byStrategy = Object.fromEntries(
    reports.map((r) => [
      r.strategyId || "unknown",
      {
        mode: r?.mode || "blocked",
        shadowReady: Boolean(r?.shadowReady),
        liveReady: Boolean(r?.liveReady),
        blockerCount:
          Number.isFinite(r?.blockerCount)
            ? r.blockerCount
            : r?.blockers?.length ?? 0,
        topBlocker: r?.topBlocker ?? r?.blockers?.[0] ?? null,
        projectedNetUsd: r?.projectedNetUsd ?? r?.economics?.projectedNetUsd ?? null,
      },
    ]),
  );
  return Object.freeze({
    total,
    blockedCount: blocked.length,
    shadowReadyCount: shadowReady.length,
    liveCandidateCount: liveCandidate.length,
    byStrategy: Object.freeze(byStrategy),
    generatedAt: new Date().toISOString(),
  });
}

export function summarizeStageDistribution(reports = []) {
  const out = {};
  for (const stage of STAGES) {
    const subset = reports.filter((r) => r?.mode === stage);
    out[stage] = Object.freeze({
      count: subset.length,
      strategyIds: subset.map((r) => r.strategyId).filter(Boolean),
    });
  }
  return Object.freeze(out);
}
