import { buildDexGatewayLoops } from "./dex-gateway-arbitrage.mjs";
import { buildEdgeViabilitySummary } from "./edge-viability.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function classifyRoute(summary) {
  if ((summary.policyReadyLevelCount || 0) > 0) return "policy_ready_route";
  if ((summary.positiveLevelCount || 0) > 0) return "positive_but_below_policy_route";
  if ((summary.minGapToPolicyUsd ?? Number.POSITIVE_INFINITY) <= 0.15) return "near_policy_route";
  if ((summary.measuredLevelCount || 0) >= 3 && (summary.minGapToPolicyUsd ?? Number.POSITIVE_INFINITY) > 0.5) {
    return "durable_no_edge_route";
  }
  if ((summary.measuredLevelCount || 0) >= 1) return "below_policy_route";
  return "insufficient_route_evidence";
}

export function buildNoEdgePersistenceSummary({ scoreSnapshot = null, dexQuotes = [] } = {}, options = {}) {
  const viability = buildEdgeViabilitySummary({ scoreSnapshot, dexQuotes }, options);
  const { loops } = buildDexGatewayLoops({ scoreSnapshot, dexQuotes }, options);
  const byRoute = new Map();

  for (const loop of loops) {
    if (!byRoute.has(loop.routeKey)) {
      byRoute.set(loop.routeKey, {
        routeKey: loop.routeKey,
        srcChain: loop.srcChain,
        dstChain: loop.dstChain,
        srcTicker: loop.srcTicker || null,
        dstTicker: loop.dstTicker || null,
        levels: [],
      });
    }
    byRoute.get(loop.routeKey).levels.push(loop);
  }

  const routes = [...byRoute.values()].map((route) => {
    const enrichedLevels = route.levels
      .map((loop) => {
        const viabilityLoop = viability.loops.find((item) => item.routeKey === loop.routeKey && String(item.amount) === String(loop.amount));
        return {
          amount: loop.amount,
          measuredLoopNetUsd: finite(loop.measuredLoopNetUsd),
          gapToPolicyUsd: finite(viabilityLoop?.gapToPolicyUsd),
          exactAmountMatch: Boolean(loop.exactAmountMatch),
        };
      })
      .filter((item) => Number.isFinite(item.measuredLoopNetUsd));
    const netValues = enrichedLevels.map((item) => item.measuredLoopNetUsd).filter(Number.isFinite);
    const gapValues = enrichedLevels.map((item) => item.gapToPolicyUsd).filter(Number.isFinite);
    const summary = {
      routeKey: route.routeKey,
      srcChain: route.srcChain,
      dstChain: route.dstChain,
      srcTicker: route.srcTicker,
      dstTicker: route.dstTicker,
      measuredLevelCount: enrichedLevels.length,
      positiveLevelCount: enrichedLevels.filter((item) => (item.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) > 0).length,
      policyReadyLevelCount: enrichedLevels.filter((item) => (item.gapToPolicyUsd ?? Number.POSITIVE_INFINITY) <= 0).length,
      exactLevelCount: enrichedLevels.filter((item) => item.exactAmountMatch).length,
      bestMeasuredLoopNetUsd: netValues.length ? Math.max(...netValues) : null,
      medianMeasuredLoopNetUsd: median(netValues),
      minGapToPolicyUsd: gapValues.length ? Math.min(...gapValues) : null,
      medianGapToPolicyUsd: median(gapValues),
    };
    return {
      ...summary,
      classification: classifyRoute(summary),
    };
  });

  const order = {
    policy_ready_route: 0,
    positive_but_below_policy_route: 1,
    near_policy_route: 2,
    below_policy_route: 3,
    durable_no_edge_route: 4,
    insufficient_route_evidence: 5,
  };

  routes.sort(
    (left, right) =>
      (order[left.classification] ?? 99) - (order[right.classification] ?? 99) ||
      ((left.minGapToPolicyUsd ?? Number.POSITIVE_INFINITY) - (right.minGapToPolicyUsd ?? Number.POSITIVE_INFINITY)) ||
      ((right.bestMeasuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) - (left.bestMeasuredLoopNetUsd ?? Number.NEGATIVE_INFINITY)) ||
      String(left.routeKey).localeCompare(String(right.routeKey)),
  );

  return {
    schemaVersion: 1,
    generatedAt: scoreSnapshot?.generatedAt || null,
    routeCount: routes.length,
    durableNoEdgeRouteCount: routes.filter((item) => item.classification === "durable_no_edge_route").length,
    belowPolicyRouteCount: routes.filter((item) => item.classification === "below_policy_route").length,
    nearPolicyRouteCount: routes.filter((item) => item.classification === "near_policy_route").length,
    positiveButBelowPolicyRouteCount: routes.filter((item) => item.classification === "positive_but_below_policy_route").length,
    policyReadyRouteCount: routes.filter((item) => item.classification === "policy_ready_route").length,
    insufficientRouteEvidenceCount: routes.filter((item) => item.classification === "insufficient_route_evidence").length,
    bestRoute: routes[0] || null,
    routes: routes.slice(0, 10),
  };
}
