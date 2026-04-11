import { isBtcFamilyRoute, routeAsset } from "../assets/tokens.mjs";
import { canQuoteWithOdos, ODOS_CHAIN_IDS, STABLE_QUOTE_TOKENS } from "../dex/odos.mjs";

function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

function entrySupport(route) {
  const stable = STABLE_QUOTE_TOKENS[route?.srcChain];
  if (!ODOS_CHAIN_IDS[route?.srcChain]) return { ok: false, reason: "src_provider_missing" };
  if (!stable) return { ok: false, reason: "src_stable_missing" };
  return canQuoteWithOdos(route.srcChain, stable.token, {
    token: route.srcToken,
    ticker: routeAsset(route).src.ticker,
    decimals: routeAsset(route).src.decimals,
  });
}

function exitSupport(route) {
  return canQuoteWithOdos(route?.dstChain, route?.dstToken);
}

function blockerSummary(route) {
  if (!isBtcFamilyRoute(route)) return { classification: "non_btc_family_route", blockers: ["non_btc_family_route"] };
  const entry = entrySupport(route);
  const exit = exitSupport(route);
  const blockers = [];
  if (!entry.ok) blockers.push(`src_${entry.reason || "provider_missing"}`);
  if (!exit.ok) blockers.push(`dst_${exit.reason || "provider_missing"}`);
  let classification = "fully_measurable_loop_candidate";
  if (blockers.length === 1) classification = "single_provider_gap";
  if (blockers.length >= 2) classification = "double_provider_gap";
  return { classification, blockers, entry, exit };
}

function groupCount(items, keyFn) {
  const counts = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || String(left.key).localeCompare(String(right.key)));
}

function chainGapItems(routes) {
  const items = [];
  for (const route of routes) {
    const summary = blockerSummary(route);
    for (const blocker of summary.blockers) {
      if (blocker.startsWith("src_")) items.push({ chain: route.srcChain, blocker });
      if (blocker.startsWith("dst_")) items.push({ chain: route.dstChain, blocker });
    }
  }
  return items;
}

export function buildDexRouteUniverseSummary({ routes = [], observedAt = null } = {}) {
  const btcRoutes = (routes || []).filter(isBtcFamilyRoute);
  const analyzed = btcRoutes.map((route) => {
    const summary = blockerSummary(route);
    return {
      routeKey: routeKey(route),
      srcChain: route.srcChain,
      dstChain: route.dstChain,
      asset: routeAsset(route).ticker,
      classification: summary.classification,
      blockers: summary.blockers,
    };
  });

  const gapChains = chainGapItems(btcRoutes);
  const fullyMeasurable = analyzed.filter((item) => item.classification === "fully_measurable_loop_candidate");
  const singleGap = analyzed.filter((item) => item.classification === "single_provider_gap");
  const doubleGap = analyzed.filter((item) => item.classification === "double_provider_gap");

  return {
    schemaVersion: 1,
    observedAt,
    totalRoutes: routes.length,
    btcFamilyRouteCount: btcRoutes.length,
    fullyMeasurableRouteCount: fullyMeasurable.length,
    singleProviderGapCount: singleGap.length,
    doubleProviderGapCount: doubleGap.length,
    blockerCounts: groupCount(analyzed.flatMap((item) => item.blockers), (item) => item),
    gapChains: groupCount(gapChains, (item) => `${item.chain}:${item.blocker}`),
    topGapChain:
      groupCount(gapChains, (item) => item.chain)[0]
        ? {
            chain: groupCount(gapChains, (item) => item.chain)[0].key,
            routeCount: groupCount(gapChains, (item) => item.chain)[0].count,
          }
        : null,
    fullyMeasurableRoutes: fullyMeasurable.slice(0, 10),
    gapRoutes: [...singleGap, ...doubleGap].slice(0, 10),
  };
}
