function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function bestStablecoinRoute(scoreSnapshot = null) {
  const scores = scoreSnapshot?.scores || [];
  return [...scores]
    .filter((score) => score?.srcAsset?.family === "stablecoin" || score?.dstAsset?.family === "stablecoin")
    .sort(
      (left, right) =>
        (right.executableNetEdgeUsd ?? right.netEdgeUsd ?? Number.NEGATIVE_INFINITY) -
          (left.executableNetEdgeUsd ?? left.netEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    )[0] || null;
}

export function buildProfitabilitySummary({
  scoreSnapshot = null,
  dexRouteFocus = null,
  dexGatewayArbitrage = null,
  edgeViability = null,
  noEdgePersistence = null,
  canaryInputs = null,
} = {}) {
  const bestStable = bestStablecoinRoute(scoreSnapshot);
  const bestMeasured = edgeViability?.bestMeasuredLoop || null;
  const closestPolicy = edgeViability?.closestLoop || null;
  const verdict = edgeViability?.verdict || null;

  return {
    schemaVersion: 1,
    measuredClosedLoopCount: dexGatewayArbitrage?.measuredNetLoopCount || 0,
    profitableClosedLoopCount: dexGatewayArbitrage?.profitableExactCount || 0,
    loopObservableRouteCount: dexRouteFocus?.loopObservableCount || 0,
    missingGatewayQuoteCount: dexRouteFocus?.missingGatewayQuoteCount || 0,
    verdictCode: verdict?.code || null,
    verdictLabel: verdict?.label || null,
    verdictDetail: verdict?.detail || null,
    canaryTradeReadiness: canaryInputs?.scoreTradeReadiness || null,
    canaryNetEdgeUsd: finite(scoreSnapshot?.scores?.find(
      (item) => item.routeKey === canaryInputs?.routeKey && String(item.amount) === String(canaryInputs?.amount),
    )?.executableNetEdgeUsd ?? scoreSnapshot?.scores?.find(
      (item) => item.routeKey === canaryInputs?.routeKey && String(item.amount) === String(canaryInputs?.amount),
    )?.netEdgeUsd),
    bestMeasuredRoute: bestMeasured
      ? {
          routeKey: bestMeasured.routeKey,
          amount: bestMeasured.amount,
          netUsd: finite(bestMeasured.measuredLoopNetUsd),
          gapToPolicyUsd: finite(bestMeasured.gapToPolicyUsd),
        }
      : null,
    closestPolicyRoute: closestPolicy
      ? {
          routeKey: closestPolicy.routeKey,
          amount: closestPolicy.amount,
          netUsd: finite(closestPolicy.measuredLoopNetUsd),
          gapToPolicyUsd: finite(closestPolicy.gapToPolicyUsd),
          targetUsd: finite(closestPolicy.requiredNetProfitUsd),
        }
      : null,
    bestStablecoinRoute: bestStable
      ? {
          routeKey: bestStable.routeKey,
          amount: bestStable.amount,
          tradeReadiness: bestStable.tradeReadiness || null,
          netUsd: finite(bestStable.executableNetEdgeUsd ?? bestStable.netEdgeUsd),
        }
      : null,
    durableNoEdgeRouteCount: noEdgePersistence?.durableNoEdgeRouteCount || 0,
  };
}
