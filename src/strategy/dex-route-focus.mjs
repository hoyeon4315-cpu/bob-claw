import { buildDexRouteUniverseSummary } from "./dex-route-universe.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
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

function bestNet(scores = [], key) {
  const values = scores.map((item) => finite(item?.[key])).filter(Number.isFinite);
  if (values.length === 0) return null;
  return Math.max(...values);
}

function classification(summary) {
  if (summary.gatewayQuoteCount === 0) return "missing_gateway_quote";
  if (summary.entryQuoteCount === 0 || summary.exitQuoteCount === 0) return "partial_loop_measurement";
  return "loop_observable";
}

const CLASSIFICATION_RANK = {
  loop_observable: 0,
  partial_loop_measurement: 1,
  missing_gateway_quote: 2,
};

export function buildDexRouteFocusSummary({ routes = [], quotes = [], scoreSnapshot = null, dexQuotes = [] } = {}) {
  const universe = buildDexRouteUniverseSummary({ routes });
  const focusRoutes = universe.fullyMeasurableRoutes || [];
  const quotesByRoute = groupBy(quotes, (item) => item.routeKey);
  const scoresByRoute = groupBy(scoreSnapshot?.scores || [], (item) => item.routeKey);
  const dexByRoute = groupBy(dexQuotes, (item) => item.gatewayRouteKey);

  const routesWithState = focusRoutes.map((route) => {
    const gatewayQuotes = quotesByRoute.get(route.routeKey) || [];
    const scoreRows = scoresByRoute.get(route.routeKey) || [];
    const dexRows = dexByRoute.get(route.routeKey) || [];
    const entryQuotes = dexRows.filter((item) => item.source === "gateway_src_entry_leg");
    const exitQuotes = dexRows.filter((item) => item.source === "gateway_dst_leg");
    const amountLevels = [...new Set(scoreRows.map((item) => String(item.amount)))].sort();
    const summary = {
      routeKey: route.routeKey,
      srcChain: route.srcChain,
      dstChain: route.dstChain,
      asset: route.asset,
      gatewayQuoteCount: gatewayQuotes.length,
      scoreVariantCount: scoreRows.length,
      amountLevelCount: amountLevels.length,
      amountLevels,
      entryQuoteCount: entryQuotes.length,
      exitQuoteCount: exitQuotes.length,
      bestNetEdgeUsd: bestNet(scoreRows, "netEdgeUsd"),
      bestExecutableNetEdgeUsd: bestNet(scoreRows, "executableNetEdgeUsd"),
      bestTradeReadiness:
        [...scoreRows]
          .sort(
            (left, right) =>
              (finite(right.executableNetEdgeUsd) ?? finite(right.netEdgeUsd) ?? Number.NEGATIVE_INFINITY) -
                (finite(left.executableNetEdgeUsd) ?? finite(left.netEdgeUsd) ?? Number.NEGATIVE_INFINITY) ||
              String(left.amount).localeCompare(String(right.amount)),
          )[0]?.tradeReadiness || null,
    };
    return {
      ...summary,
      classification: classification(summary),
    };
  });

  routesWithState.sort(
    (left, right) =>
      (CLASSIFICATION_RANK[left.classification] ?? 99) - (CLASSIFICATION_RANK[right.classification] ?? 99) ||
      ((right.bestExecutableNetEdgeUsd ?? Number.NEGATIVE_INFINITY) - (left.bestExecutableNetEdgeUsd ?? Number.NEGATIVE_INFINITY)) ||
      ((right.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY) - (left.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY)) ||
      (right.amountLevelCount - left.amountLevelCount) ||
      String(left.routeKey).localeCompare(String(right.routeKey)),
  );

  return {
    schemaVersion: 1,
    fullyMeasurableRouteCount: focusRoutes.length,
    loopObservableCount: routesWithState.filter((item) => item.classification === "loop_observable").length,
    partialLoopMeasurementCount: routesWithState.filter((item) => item.classification === "partial_loop_measurement").length,
    missingGatewayQuoteCount: routesWithState.filter((item) => item.classification === "missing_gateway_quote").length,
    bestRoute: routesWithState[0] || null,
    routes: routesWithState.slice(0, 10),
  };
}
