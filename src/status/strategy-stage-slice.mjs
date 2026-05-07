// W7/W10 — Strategy readiness-stage dashboard slice.
//
// Summarizes advisory readiness (blocked → shadow_ready → live_candidate → live_ready)
// across all strategy tick reports so the dashboard can display
// "which display state is each strategy in" without reading raw JSONL.
//
// Demotion evidence (W10-C) can override live_ready back to live_candidate
// when adverse runtime signals are detected. Rollback is still a committed-cap
// operation; this slice only reflects the runtime verdict.
//
// Pure function. No I/O.

export const STAGES = Object.freeze([
  "blocked",
  "shadow_ready",
  "live_candidate",
  "live_ready",
]);

function resolveReadinessVerdict(mode, readiness, demotion) {
  let verdict = mode;
  if (mode === "live_candidate" && readiness?.eligible === true) {
    verdict = "live_ready";
  }
  if (verdict === "live_ready" && demotion?.demoted === true) {
    verdict = "live_candidate";
  }
  return verdict;
}

export function buildStrategyStageSlice(reports = [], readinessEvidence = {}, demotionEvidence = {}) {
  const total = reports.length;
  const blocked = reports.filter((r) => r?.mode === "blocked");
  const shadowReady = reports.filter((r) => r?.mode === "shadow_ready");
  const liveCandidate = reports.filter((r) => r?.mode === "live_candidate");

  // readinessEvidence is a map: strategyId -> { eligible: boolean }
  // demotionEvidence is a map: strategyId -> { demoted: boolean, triggers: string[] }
  const liveReady = reports.filter((r) => {
    const sid = r?.strategyId;
    const readiness = sid ? readinessEvidence[sid] : null;
    const demotion = sid ? demotionEvidence[sid] : null;
    return r?.mode === "live_candidate" && readiness?.eligible === true && demotion?.demoted !== true;
  });

  const byStrategy = Object.fromEntries(
    reports.map((r) => {
      const sid = r.strategyId || "unknown";
      const readiness = readinessEvidence[sid] || null;
      const demotion = demotionEvidence[sid] || null;
      const mode = r?.mode || "blocked";
      const readinessVerdict = resolveReadinessVerdict(mode, readiness, demotion);
      return [
        sid,
        {
          mode,
          readinessVerdict,
          shadowReady: Boolean(r?.shadowReady),
          liveReady: Boolean(r?.liveReady),
          blockerCount:
            Number.isFinite(r?.blockerCount)
              ? r.blockerCount
              : r?.blockers?.length ?? 0,
          topBlocker: r?.topBlocker ?? r?.blockers?.[0] ?? null,
          projectedNetUsd: r?.projectedNetUsd ?? r?.economics?.projectedNetUsd ?? null,
          policyReady: readiness?.eligible ?? null,
          demotionTriggers: demotion?.triggers ?? [],
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

export function summarizeStageDistribution(reports = [], readinessEvidence = {}, demotionEvidence = {}) {
  const out = {};
  for (const stage of STAGES) {
    const subset = reports.filter((r) => {
      const sid = r?.strategyId;
      const readiness = sid ? readinessEvidence[sid] : null;
      const demotion = sid ? demotionEvidence[sid] : null;
      const mode = r?.mode || "blocked";
      const readinessVerdict = resolveReadinessVerdict(mode, readiness, demotion);
      return readinessVerdict === stage;
    });
    out[stage] = Object.freeze({
      count: subset.length,
      strategyIds: subset.map((r) => r.strategyId).filter(Boolean),
    });
  }
  return Object.freeze(out);
}
