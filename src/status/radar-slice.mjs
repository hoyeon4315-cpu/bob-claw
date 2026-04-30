import { RADAR_POLICY } from "../config/radar-policy.mjs";

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function normalizeSats(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  return "0";
}

function normalizeUsd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function topBlockerFromCounts(blockerCounts = {}) {
  return Object.entries(blockerCounts)
    .filter(([, count]) => finiteCount(count) > 0)
    .map(([code, count]) => ({ code, count: finiteCount(count) }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))[0] || null;
}

function capReviewSummary(capReview = null) {
  const candidates = Array.isArray(capReview?.candidates) ? capReview.candidates : [];
  const eligible = candidates.filter((candidate) => candidate?.eligible === true);
  const topSuggested = eligible
    .map((candidate) => Number(candidate.suggestedNextTinyLivePerTxUsd))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] ?? null;
  return Object.freeze({
    candidateCount: candidates.length,
    eligibleCount: eligible.length,
    lossLockOn: Boolean(capReview?.lossLock?.tripped),
    topSuggestedNextTinyLivePerTxUsd: topSuggested,
    requiresCommittedDiff: eligible.length > 0,
    autoRaise: false,
  });
}

function radarStatus(stageCounts) {
  if (stageCounts.executableReview > 0) {
    return {
      status: "executable_review",
      headline: "Policy review candidate waiting",
      nextAction: "review_existing_policy_path",
    };
  }
  if (stageCounts.portable > 0) {
    return {
      status: "portable_review",
      headline: "Replay-backed candidate needs review",
      nextAction: "calibrate_operator_policy",
    };
  }
  if (stageCounts.hypothesis > 0) {
    return {
      status: "strategy_hypothesis",
      headline: "Behavior grouped into strategy patterns",
      nextAction: "collect_replay_evidence",
    };
  }
  if (stageCounts.observed > 0) {
    return {
      status: "observed",
      headline: "Observations collected",
      nextAction: "build_strategy_episode",
    };
  }
  return {
    status: "waiting_for_observations",
    headline: "Waiting for observations",
    nextAction: "collect_observations",
  };
}

export function buildRadarDashboardSlice({ board = null, capReview = null, generatedAt = null } = {}) {
  const summary = board?.summary || {};
  const stageCounts = {
    observed: finiteCount(summary.observedCount),
    hypothesis: finiteCount(summary.strategyEpisodeCount),
    portable: finiteCount(summary.portablePacketCount),
    executableReview: finiteCount(summary.executableCount),
    selfRealized: finiteCount(summary.strategyRealizedCount),
    positiveRealizedPnl: finiteCount(summary.positiveRealizedPnlCount),
    paybackDelivered: finiteCount(summary.paybackDeliveredCount),
  };
  const status = radarStatus(stageCounts);
  const thresholdsResolved = RADAR_POLICY.calibrationStatus !== "unresolved_operator_policy";

  return Object.freeze({
    available: Boolean(board),
    generatedAt: board?.generatedAt || generatedAt || null,
    status: status.status,
    headline: status.headline,
    nextAction: status.nextAction,
    stageCounts: Object.freeze(stageCounts),
    pnl: Object.freeze({
      totalNetRealizedPnlUsd: normalizeUsd(summary.totalNetRealizedPnlUsd),
      totalNetRealizedPnlSats: normalizeSats(summary.totalNetRealizedPnlSats),
    }),
    capReview: capReviewSummary(capReview),
    topBlocker: topBlockerFromCounts(board?.blockerCounts || {}),
    guardrails: Object.freeze({
      readOnly: true,
      noExecution: true,
      noCapMutation: true,
      noPaybackPolicyMutation: true,
      externalWalletPnlUnverified: true,
      thresholdsResolved,
    }),
  });
}
