import { summarizeQuoteDecay } from "../shadow/quote-decay.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function routeIdentity(score) {
  if (score?.routeKey) return score.routeKey;
  const srcChain = score?.srcChain || "unknown";
  const dstChain = score?.dstChain || "unknown";
  const srcAsset = score?.srcAsset?.ticker || score?.srcToken || "unknown";
  const dstAsset = score?.dstAsset?.ticker || score?.dstToken || "unknown";
  return `${srcChain}:${srcAsset}->${dstChain}:${dstAsset}`;
}

function preferredNetUsd(score) {
  return finite(score?.executableNetEdgeUsd) ?? finite(score?.netEdgeUsd);
}

function preferredNetPct(score) {
  return finite(score?.executableNetEdgePct) ?? finite(score?.netEdgePct);
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function sortScores(items) {
  return [...items].sort((left, right) => Number(left.amount) - Number(right.amount));
}

function routeDecaySummary(routeKey, observations, requiredWindows) {
  const relevant = (observations || []).filter((item) => item?.routeKey === routeKey);
  const decay = summarizeQuoteDecay(relevant, requiredWindows);
  const windows = decay.windows || [];
  const required = windows.filter((item) => requiredWindows.includes(item.windowSeconds));
  const allCovered = required.length > 0 && required.every((item) => item.coveredGroups > 0);
  const allSurvived = required.length > 0 && required.every((item) => item.profitableStartGroups > 0 && item.survivedGroups > 0);
  return {
    coveredGroups: decay.coveredGroups || 0,
    windows: required,
    allCovered,
    allSurvived,
  };
}

function classify(summary, policy) {
  if (summary.hasImplausibleOutlier) return "reject_outlier";
  if (summary.profitableLevels === 0) return "no_edge";
  if (summary.maxFailureRate > policy.maxFailureRate) return "failure_rate_too_high";
  if (summary.profitableLevels < policy.minMultiLevelCount) return "single_level_only";
  if (!summary.decay.allCovered) return "missing_decay_coverage";
  if (!summary.decay.allSurvived) return "missing_decay_survival";
  if (summary.profitableLevels < policy.minDefiniteLevelCount) return "multi_level_candidate";
  return "definite_edge_candidate";
}

function routeSummary(routeKey, scores, observations, policy) {
  const ordered = sortScores(scores);
  const profitable = ordered.filter((score) => {
    const netUsd = preferredNetUsd(score);
    const netPct = preferredNetPct(score);
    return (
      (score.dataGaps || []).length === 0 &&
      Number.isFinite(netUsd) &&
      netUsd >= policy.minNetProfitUsd &&
      Number.isFinite(netPct) &&
      netPct >= policy.minNetProfitPct &&
      (score.routeStats?.failureRate ?? 0) <= policy.maxFailureRate
    );
  });
  const decay = routeDecaySummary(routeKey, observations, policy.requiredDecayWindows);
  const bestNetEdgeUsd = ordered.reduce((max, score) => Math.max(max, preferredNetUsd(score) ?? Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY);
  const bestNetEdgePct = ordered.reduce((max, score) => Math.max(max, preferredNetPct(score) ?? Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY);
  const summary = {
    routeKey,
    amountLevels: ordered.length,
    profitableLevels: profitable.length,
    bestNetEdgeUsd: Number.isFinite(bestNetEdgeUsd) ? bestNetEdgeUsd : null,
    bestNetEdgePct: Number.isFinite(bestNetEdgePct) ? bestNetEdgePct : null,
    maxFailureRate: ordered.reduce((max, score) => Math.max(max, score.routeStats?.failureRate ?? 0), 0),
    hasImplausibleOutlier: ordered.some((score) => (score.dataGaps || []).includes("implausible_quote_value_ratio")),
    profitableAmounts: profitable.map((score) => score.amount),
    decay,
  };
  return {
    ...summary,
    classification: classify(summary, policy),
  };
}

export function buildEdgeResearchSummary({ scoreSnapshot = null, shadowObservations = [] } = {}, options = {}) {
  const policy = {
    minNetProfitUsd: 0.3,
    minNetProfitPct: 0.005,
    maxFailureRate: 0.05,
    minMultiLevelCount: 2,
    minDefiniteLevelCount: 4,
    requiredDecayWindows: [5, 15, 30],
    ...options,
  };
  const groups = groupBy(scoreSnapshot?.scores || [], routeIdentity);
  const routes = [...groups.entries()].map(([routeKey, scores]) => routeSummary(routeKey, scores, shadowObservations, policy));
  const classificationPriority = {
    definite_edge_candidate: 0,
    multi_level_candidate: 1,
    missing_decay_survival: 2,
    missing_decay_coverage: 3,
    single_level_only: 4,
    failure_rate_too_high: 5,
    no_edge: 6,
    reject_outlier: 7,
  };
  routes.sort(
    (left, right) =>
      ((classificationPriority[left.classification] ?? 99) - (classificationPriority[right.classification] ?? 99)) ||
      (right.profitableLevels - left.profitableLevels) ||
      ((right.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY) - (left.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY)) ||
      String(left.routeKey).localeCompare(String(right.routeKey)),
  );
  return {
    schemaVersion: 1,
    generatedAt: scoreSnapshot?.generatedAt || null,
    policy,
    routeCount: routes.length,
    definiteEdgeCandidateCount: routes.filter((item) => item.classification === "definite_edge_candidate").length,
    multiLevelCandidateCount: routes.filter((item) => item.classification === "multi_level_candidate").length,
    missingDecaySurvivalCount: routes.filter((item) => item.classification === "missing_decay_survival").length,
    missingDecayCoverageCount: routes.filter((item) => item.classification === "missing_decay_coverage").length,
    singleLevelOnlyCount: routes.filter((item) => item.classification === "single_level_only").length,
    highFailureRouteCount: routes.filter((item) => item.classification === "failure_rate_too_high").length,
    noEdgeCount: routes.filter((item) => item.classification === "no_edge").length,
    outlierCount: routes.filter((item) => item.classification === "reject_outlier").length,
    bestCandidate: routes.find((item) => item.classification !== "reject_outlier") || null,
    routes: routes.slice(0, 10),
  };
}
