function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function variantKey(routeKey, amount) {
  return `${routeKey}|${String(amount ?? "")}`;
}

function dedupeReasons(reasons) {
  return [...new Set(reasons.filter(Boolean))];
}

function canaryVariantKey(route) {
  if (!route?.routeKey) return null;
  return variantKey(route.routeKey, route.amount);
}

function buildRouteCanaryContext(key, canaryProgress) {
  const currentVariantKey = canaryVariantKey(canaryProgress?.currentRoute);
  const lastAdvanceVariantKey = canaryVariantKey(canaryProgress?.lastAdvance);
  const isCurrentTopRoute = key === currentVariantKey;
  const isLastAdvanceRoute = key === lastAdvanceVariantKey;
  if (!isCurrentTopRoute && !isLastAdvanceRoute) return null;

  return {
    isCurrentTopRoute,
    isLastAdvanceRoute,
    currentRoute: isCurrentTopRoute
      ? {
          tradeReadiness: canaryProgress.currentRoute?.tradeReadiness || null,
          routeBlockers: canaryProgress.currentRoute?.routeBlockers || [],
          scoreDataGaps: canaryProgress.currentRoute?.scoreDataGaps || [],
          blockingInputs: canaryProgress.currentRoute?.blockingInputs || [],
          inputStates: canaryProgress.currentRoute?.inputStates || null,
        }
      : null,
    lastAdvance: isLastAdvanceRoute && canaryProgress?.lastAdvance
      ? {
          observedAt: canaryProgress.lastAdvance.observedAt || null,
          ageMinutes: canaryProgress.lastAdvance.ageMinutes ?? null,
          routeLabel: canaryProgress.lastAdvance.routeLabel || null,
          initialDecision: canaryProgress.lastAdvance.initialDecision || null,
          afterWalletCheckDecision: canaryProgress.lastAdvance.afterWalletCheckDecision || null,
          finalDecision: canaryProgress.lastAdvance.finalDecision || null,
          finalReasons: canaryProgress.lastAdvance.finalReasons || [],
          actionCount: canaryProgress.lastAdvance.actionCount ?? 0,
          actions: canaryProgress.lastAdvance.actions || [],
        }
      : null,
  };
}

export function buildDefaultRoutePerformancePolicy() {
  return {
    schemaVersion: 1,
    minRealizedSamples: 3,
    minWinRate: 0.5,
    maxQuoteFailureRate: 0.1,
    maxRouteP95LossUsd: 1,
    requireCurrentNonRejectedReadiness: true,
  };
}

function classifyRoute({
  policy,
  realizedSampleCount,
  realizedMedianPnlUsd,
  realizedTotalPnlUsd,
  realizedWinRate,
  routeP95LossUsd,
  quoteFailureRate,
  currentTradeReadiness,
}) {
  const reasons = [];

  if (realizedSampleCount === 0) reasons.push("no_realized_data");
  if (realizedSampleCount > 0 && realizedSampleCount < policy.minRealizedSamples) reasons.push("insufficient_realized_samples");
  if (realizedSampleCount >= policy.minRealizedSamples && !(realizedMedianPnlUsd > 0)) reasons.push("negative_realized_median");
  if (realizedSampleCount >= policy.minRealizedSamples && !(realizedTotalPnlUsd > 0)) reasons.push("non_positive_realized_total");
  if (realizedSampleCount >= policy.minRealizedSamples && !(realizedWinRate >= policy.minWinRate)) reasons.push("low_realized_win_rate");
  if (realizedSampleCount >= policy.minRealizedSamples && routeP95LossUsd > policy.maxRouteP95LossUsd) reasons.push("loss_tail_too_large");
  if (Number.isFinite(quoteFailureRate) && quoteFailureRate > policy.maxQuoteFailureRate) reasons.push("quote_failure_rate_too_high");
  if (
    policy.requireCurrentNonRejectedReadiness &&
    currentTradeReadiness &&
    (currentTradeReadiness === "insufficient_data" || currentTradeReadiness.startsWith("reject_"))
  ) {
    reasons.push("current_route_not_tradeable");
  }

  if (reasons.length === 0) return { enabledState: "enabled_review_only", rejectionReasons: [] };
  if (reasons.includes("no_realized_data")) return { enabledState: "disabled_no_realized_data", rejectionReasons: dedupeReasons(reasons) };
  if (reasons.includes("insufficient_realized_samples")) {
    return { enabledState: "disabled_insufficient_realized_samples", rejectionReasons: dedupeReasons(reasons) };
  }
  return { enabledState: "disabled_negative_realized_expectancy", rejectionReasons: dedupeReasons(reasons) };
}

function latestScoreByVariant(scores = []) {
  const map = new Map();
  for (const item of scores) {
    const key = variantKey(item.routeKey, item.amount);
    const existing = map.get(key);
    if (!existing || new Date(item.observedAt) > new Date(existing.observedAt)) {
      map.set(key, item);
    }
  }
  return map;
}

function groupCounts(items = [], keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function buildRoutePerformanceRanking({
  receiptRecords = [],
  scores = [],
  quotes = [],
  quoteFailures = [],
  canaryProgress = null,
  policy = buildDefaultRoutePerformancePolicy(),
  now = new Date().toISOString(),
}) {
  const scoredVariants = latestScoreByVariant(scores);
  const routeReceipts = receiptRecords.filter((item) => item.routeContext?.routeKey);
  const receiptGroups = groupCounts(routeReceipts, (item) => variantKey(item.routeContext.routeKey, item.routeContext.amount));
  const quoteGroups = groupCounts(quotes, (item) => variantKey(item.routeKey, item.amount));
  const failureGroups = groupCounts(quoteFailures, (item) => variantKey(item.routeKey, item.amount));

  const variantKeys = new Set([
    ...receiptGroups.keys(),
    ...quoteGroups.keys(),
    ...failureGroups.keys(),
    ...scoredVariants.keys(),
    ...[canaryVariantKey(canaryProgress?.currentRoute), canaryVariantKey(canaryProgress?.lastAdvance)].filter(Boolean),
  ]);

  const routes = [...variantKeys].map((key) => {
    const receiptsForKey = receiptGroups.get(key) || [];
    const quotesForKey = quoteGroups.get(key) || [];
    const failuresForKey = failureGroups.get(key) || [];
    const score = scoredVariants.get(key) || null;
    const reconciled = receiptsForKey.filter((item) => item.reconciliationStatus === "reconciled");
    const failed = receiptsForKey.filter((item) => item.reconciliationStatus === "failed");
    const pendingOutput = receiptsForKey.filter((item) => item.reconciliationStatus === "pending_output");
    const realizedPnls = reconciled.map((item) => item.realized?.realizedNetPnlUsd).filter(Number.isFinite);
    const realizedLosses = reconciled
      .map((item) => item.realized?.realizedNetPnlUsd)
      .filter((value) => Number.isFinite(value) && value < 0)
      .map((value) => Math.abs(value));
    const fillDrifts = reconciled.map((item) => item.realized?.realizedFillVsEstimateBps).filter(Number.isFinite);
    const latencyValues = quotesForKey.map((item) => item.latencyMs).filter(Number.isFinite);
    const knownCostValues = [score?.knownCostUsd].filter(Number.isFinite);
    const quoteFailureRate = quotesForKey.length + failuresForKey.length > 0 ? failuresForKey.length / (quotesForKey.length + failuresForKey.length) : null;
    const realizedSampleCount = reconciled.length + failed.length;
    const realizedWinRate =
      realizedPnls.length > 0 ? realizedPnls.filter((value) => value > 0).length / realizedPnls.length : 0;
    const realizedMedianPnlUsd = median(realizedPnls);
    const realizedTotalPnlUsd = realizedPnls.reduce((sum, value) => sum + value, 0) + failed
      .map((item) => item.realized?.realizedNetPnlUsd)
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    const routeP95LossUsd = percentile(realizedLosses, 95) || 0;
    const routeCanaryContext = buildRouteCanaryContext(key, canaryProgress);
    const canaryRouteInfo = routeCanaryContext?.isCurrentTopRoute
      ? canaryProgress?.currentRoute
      : routeCanaryContext?.isLastAdvanceRoute
        ? canaryProgress?.lastAdvance
        : null;
    const routeInfo = score || receiptsForKey[0]?.routeContext || canaryRouteInfo || null;
    const classification = classifyRoute({
      policy,
      realizedSampleCount,
      realizedMedianPnlUsd,
      realizedTotalPnlUsd,
      realizedWinRate,
      routeP95LossUsd,
      quoteFailureRate,
      currentTradeReadiness: score?.tradeReadiness || null,
    });

    return {
      routeVariantKey: key,
      routeKey: routeInfo?.routeKey || null,
      amount: routeInfo?.amount || null,
      srcChain: routeInfo?.srcChain || null,
      dstChain: routeInfo?.dstChain || null,
      currentTradeReadiness: score?.tradeReadiness || null,
      currentEstimatedNetEdgeUsd: score?.netEdgeUsd ?? null,
      currentExecutableNetEdgeUsd: score?.executableNetEdgeUsd ?? null,
      currentKnownCostUsd: median(knownCostValues),
      quoteSampleCount: quotesForKey.length,
      quoteFailureCount: failuresForKey.length,
      quoteSuccessRate: Number.isFinite(quoteFailureRate) ? 1 - quoteFailureRate : null,
      quoteFailureRate,
      quoteLatencyP50Ms: percentile(latencyValues, 50),
      quoteLatencyP95Ms: percentile(latencyValues, 95),
      realizedSampleCount,
      reconciledCount: reconciled.length,
      failedCount: failed.length,
      pendingOutputCount: pendingOutput.length,
      realizedWinRate,
      realizedTotalPnlUsd,
      realizedMedianPnlUsd,
      routeP95LossUsd,
      medianFillDriftBps: median(fillDrifts),
      enabledState: classification.enabledState,
      rejectionReasons: classification.rejectionReasons,
      canaryContext: routeCanaryContext,
    };
  });

  routes.sort((left, right) => {
    const enabledRank = left.enabledState === right.enabledState ? 0 : left.enabledState === "enabled_review_only" ? -1 : 1;
    if (enabledRank !== 0) return enabledRank;
    const leftMedian = Number.isFinite(left.realizedMedianPnlUsd) ? left.realizedMedianPnlUsd : Number.NEGATIVE_INFINITY;
    const rightMedian = Number.isFinite(right.realizedMedianPnlUsd) ? right.realizedMedianPnlUsd : Number.NEGATIVE_INFINITY;
    if (leftMedian !== rightMedian) return rightMedian - leftMedian;
    const leftWin = Number.isFinite(left.realizedWinRate) ? left.realizedWinRate : Number.NEGATIVE_INFINITY;
    const rightWin = Number.isFinite(right.realizedWinRate) ? right.realizedWinRate : Number.NEGATIVE_INFINITY;
    if (leftWin !== rightWin) return rightWin - leftWin;
    return String(left.routeVariantKey).localeCompare(String(right.routeVariantKey));
  });

  return {
    schemaVersion: 1,
    observedAt: now,
    summary: {
      routeVariantCount: routes.length,
      enabledCount: routes.filter((item) => item.enabledState === "enabled_review_only").length,
      disabledCount: routes.filter((item) => item.enabledState !== "enabled_review_only").length,
      realizedRouteCount: routes.filter((item) => item.realizedSampleCount > 0).length,
      canaryProgress,
    },
    routes,
  };
}
