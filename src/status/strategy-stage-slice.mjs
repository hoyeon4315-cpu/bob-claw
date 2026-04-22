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
  "live_ready",
]);

export function buildStrategyStageSlice(reports = [], promotionEvidence = {}) {
  const total = reports.length;
  const blocked = reports.filter((r) => r?.mode === "blocked");
  const shadowReady = reports.filter((r) => r?.mode === "shadow_ready");
  const liveCandidate = reports.filter((r) => r?.mode === "live_candidate");

  // promotionEvidence is a map: strategyId -> { eligible: boolean }
  const liveReady = reports.filter((r) => {
    const sid = r?.strategyId;
    const promo = sid ? promotionEvidence[sid] : null;
    return r?.mode === "live_candidate" && promo?.eligible === true;
  });

  const byStrategy = Object.fromEntries(
    reports.map((r) => {
      const sid = r.strategyId || "unknown";
      const promo = promotionEvidence[sid] || null;
      const mode = r?.mode || "blocked";
      const promotionVerdict =
        mode === "live_candidate" && promo?.eligible === true
          ? "live_ready"
          : mode;
      return [
        sid,
        {
          mode,
          promotionVerdict,
          shadowReady: Boolean(r?.shadowReady),
          liveReady: Boolean(r?.liveReady),
          blockerCount:
            Number.isFinite(r?.blockerCount)
              ? r.blockerCount
              : r?.blockers?.length ?? 0,
          topBlocker: r?.topBlocker ?? r?.blockers?.[0] ?? null,
          projectedNetUsd: r?.projectedNetUsd ?? r?.economics?.projectedNetUsd ?? null,
          promotionEligible: promo?.eligible ?? null,
        },
      ];
    }),
  );
  return Object.freeze({
    total,
    blockedCount: blocked.length,
    shadowReadyCount: shadowReady.length,
    liveCandidateCount: liveCandidate.length - liveReady.length,
    liveReadyCount: liveReady.length,
    byStrategy: Object.freeze(byStrategy),
    generatedAt: new Date().toISOString(),
  });
}

export function summarizeStageDistribution(reports = [], promotionEvidence = {}) {
  const out = {};
  for (const stage of STAGES) {
    const subset = reports.filter((r) => {
      const sid = r?.strategyId;
      const promo = sid ? promotionEvidence[sid] : null;
      const mode = r?.mode || "blocked";
      const promotionVerdict =
        mode === "live_candidate" && promo?.eligible === true
          ? "live_ready"
          : mode;
      return promotionVerdict === stage;
    });
    out[stage] = Object.freeze({
      count: subset.length,
      strategyIds: subset.map((r) => r.strategyId).filter(Boolean),
    });
  }
  return Object.freeze(out);
}
