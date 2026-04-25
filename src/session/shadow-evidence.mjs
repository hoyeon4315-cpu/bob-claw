function observedAtMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function percentile(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function latest(items = []) {
  return [...items]
    .filter((item) => observedAtMs(item?.observedAt) !== null)
    .sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt))[0] || null;
}

function matchRouteAmount(item, routeKey, amount) {
  return item?.routeKey === routeKey && String(item?.amount) === String(amount);
}

function summarizeLatestScoreReasons(latestScore) {
  const counts = new Map();
  if (latestScore?.tradeReadiness && latestScore.tradeReadiness !== "shadow_candidate_review_only") {
    counts.set(latestScore.tradeReadiness, (counts.get(latestScore.tradeReadiness) || 0) + 1);
  }
  for (const gap of latestScore?.dataGaps || []) {
    counts.set(gap, (counts.get(gap) || 0) + 1);
  }
  return counts;
}

function mapToSortedReasonCounts(counts) {
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || String(left.reason).localeCompare(String(right.reason)))
    .slice(0, 5);
}

function summarizeReasons(shadowObservations, latestScore) {
  const latestObservation =
    [...(shadowObservations || [])]
      .filter((item) => observedAtMs(item?.observedAt) !== null)
      .sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt))[0] || null;
  const latestObservationMs = observedAtMs(latestObservation?.observedAt);
  const latestScoreMs = observedAtMs(latestScore?.observedAt);
  const latestObservationReasons = new Set((latestObservation?.rejectionReasons || []).filter(Boolean));
  const latestScoreReasons = summarizeLatestScoreReasons(latestScore);

  if (
    latestScore &&
    latestScoreReasons.size > 0 &&
    (latestObservationMs === null || (
      latestScoreMs !== null &&
      latestScoreMs > latestObservationMs &&
      latestScore?.tradeReadiness !== latestObservation?.tradeReadiness
    ))
  ) {
    return mapToSortedReasonCounts(latestScoreReasons);
  }

  if (latestObservationReasons.size > 0) {
    const counts = new Map();
    for (const observation of shadowObservations || []) {
      for (const reason of observation?.rejectionReasons || []) {
        if (latestObservationReasons.has(reason)) {
          counts.set(reason, (counts.get(reason) || 0) + 1);
        }
      }
    }
    if (counts.size > 0) return mapToSortedReasonCounts(counts);
  }

  const counts = new Map();
  for (const observation of shadowObservations) {
    for (const reason of observation?.rejectionReasons || []) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  if (counts.size === 0 && latestScore) {
    for (const [reason, count] of latestScoreReasons.entries()) {
      counts.set(reason, count);
    }
  }
  return mapToSortedReasonCounts(counts);
}

export function summarizeShadowCandidateEvidence({
  candidate = null,
  quotes = [],
  quoteFailures = [],
  shadowObservations = [],
  scores = [],
} = {}) {
  if (!candidate?.routeKey || !candidate?.amount) return null;
  const routeKey = candidate.routeKey;
  const amount = candidate.amount;
  const matchingQuotes = quotes.filter((item) => matchRouteAmount(item, routeKey, amount));
  const matchingFailures = quoteFailures.filter((item) => matchRouteAmount(item, routeKey, amount));
  const matchingObservations = shadowObservations.filter((item) => matchRouteAmount(item, routeKey, amount));
  const matchingScores = scores.filter((item) => matchRouteAmount(item, routeKey, amount));
  const latestQuote = latest(matchingQuotes);
  const latestFailure = latest(matchingFailures);
  const latestObservation = latest(matchingObservations);
  const latestScore = latest(matchingScores);
  const latencyValues = matchingQuotes.map((item) => item?.latencyMs).filter(Number.isFinite);
  const quoteAttemptCount = matchingQuotes.length + matchingFailures.length;

  return {
    quoteSampleCount: matchingQuotes.length,
    quoteFailureCount: matchingFailures.length,
    quoteAttemptCount,
    quoteSuccessRate: quoteAttemptCount > 0 ? matchingQuotes.length / quoteAttemptCount : null,
    quoteLatencyP50Ms: finite(percentile(latencyValues, 50)),
    quoteLatencyP95Ms: finite(percentile(latencyValues, 95)),
    shadowObservationCount: matchingObservations.length,
    latestQuoteObservedAt: latestQuote?.observedAt || null,
    latestFailureObservedAt: latestFailure?.observedAt || null,
    latestObservationObservedAt: latestObservation?.observedAt || null,
    latestObservedEdgeUsd: finite(latestObservation?.observedEdgeUsd ?? latestScore?.treasuryAdjustedExecutableNetEdgeUsd ?? latestScore?.executableNetEdgeUsd ?? latestScore?.netEdgeUsd),
    latestKnownCostUsd: finite(latestObservation?.knownCostUsd ?? latestScore?.knownCostUsd),
    latestExecutionGasUsd: finite(latestObservation?.executionGasUsd ?? latestScore?.executionGasUsd),
    latestRouteFailureRate: finite(latestObservation?.routeFailureRate ?? latestScore?.routeStats?.failureRate),
    latestTradeReadiness: latestObservation?.tradeReadiness || latestScore?.tradeReadiness || null,
    rejectionReasons: summarizeReasons(matchingObservations, latestScore),
  };
}
