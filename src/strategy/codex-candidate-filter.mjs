// codex-candidate-filter — pure function. Score/reject candidates from the
// autonomous discovery board before they reach the Codex coder.
//
// Rules (AGENTS.md):
//   - tinyLivePerTxUsd not declared      → reject
//   - route cost measurement missing     → reject
//   - executor binding missing           → flag needs_adapter
//   - same family+protocol seen ≥3 times in last 30d → score *= 0.5
//   - regime tag (mayerMultiple regime)  → bull_peak penalises momentum/leverage

const SECONDS_30D = 30 * 86400;

function dayBucket(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function applyRegimeWeight(baseScore, regime, family) {
  if (!regime) return baseScore;
  if (regime === "bull_peak" && (family === "lending_loop" || family === "basis")) {
    return baseScore * 0.5;
  }
  if (regime === "bear" && family === "campaign_only") {
    return baseScore * 0.7;
  }
  return baseScore;
}

export function countRecentFamilyHits(history, family, protocolId, now = new Date()) {
  if (!Array.isArray(history)) return 0;
  const cutoff = new Date(now).getTime() / 1000 - SECONDS_30D;
  return history.filter((h) => {
    if (!h || h.family !== family || h.protocolId !== protocolId) return false;
    const ts = h.ts ? new Date(h.ts).getTime() / 1000 : 0;
    return ts >= cutoff;
  }).length;
}

export function evaluateCandidate({
  candidate,
  history = [],
  bindingExists = false,
  regime = null,
  now = new Date(),
} = {}) {
  if (!candidate || typeof candidate !== "object") {
    return { decision: "reject", reasons: ["missing_candidate"], score: 0 };
  }
  const reasons = [];
  if (!Number.isFinite(candidate.tinyLivePerTxUsd)) {
    reasons.push("tinyLivePerTxUsd_missing");
  }
  if (!candidate.routeCost || !Number.isFinite(candidate.routeCost.estimatedUsd)) {
    reasons.push("route_cost_missing");
  }
  if (reasons.length > 0) {
    return { decision: "reject", reasons, score: 0 };
  }
  let score = Number(candidate.baseScore) || 1;
  const recent = countRecentFamilyHits(history, candidate.family, candidate.protocolId, now);
  if (recent >= 3) {
    score *= 0.5;
    reasons.push(`family_protocol_recent_hits:${recent}`);
  }
  score = applyRegimeWeight(score, regime, candidate.family);
  const flags = [];
  if (!bindingExists) flags.push("needs_adapter");
  return {
    decision: bindingExists ? "accept" : "needs_adapter",
    reasons,
    flags,
    score,
  };
}

export function filterCandidates({ candidates = [], history = [], bindings = new Set(), regime = null, now = new Date() } = {}) {
  return candidates.map((c) => ({
    candidateId: c.candidateId || null,
    ...evaluateCandidate({
      candidate: c,
      history,
      bindingExists: bindings.has?.(c.bindingKey) || (Array.isArray(bindings) && bindings.includes(c.bindingKey)),
      regime,
      now,
    }),
  }));
}
