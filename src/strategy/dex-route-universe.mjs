import { isBtcFamilyRoute, isEthFamilyRoute, routeAsset } from "../assets/tokens.mjs";
import { canQuoteWithDex, STABLE_QUOTE_TOKENS } from "../dex/odos.mjs";

function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

export function routeMatchesDexFamily(route, family = "btc") {
  const tokenText = `${route?.srcToken || ""} ${route?.dstToken || ""}`.toLowerCase();
  if (family === "eth") return isEthFamilyRoute(route) || /\beth\b|weth|steth|reth/.test(tokenText);
  if (family === "btc") return isBtcFamilyRoute(route) || /btc|lbtc|solvbtc/.test(tokenText);
  if (family === "stable") return /usd|usdc|usdt|dai|eurc|usde|usds|pyusd/.test(tokenText);
  return true;
}

function entrySupport(route) {
  const stable = STABLE_QUOTE_TOKENS[route?.srcChain];
  const providerSupport = canQuoteWithDex(route.srcChain, route.srcToken, {
    token: route.srcToken,
    ticker: routeAsset(route).src.ticker,
    decimals: routeAsset(route).src.decimals,
  });
  if (!providerSupport.ok && String(providerSupport.reason || "").startsWith("no_supported_router_for_chain:")) {
    return providerSupport;
  }
  if (!stable) return { ok: false, reason: "src_stable_missing" };
  return canQuoteWithDex(route.srcChain, stable?.token, {
    token: route.srcToken,
    ticker: routeAsset(route).src.ticker,
    decimals: routeAsset(route).src.decimals,
  });
}

function exitSupport(route) {
  return canQuoteWithDex(route?.dstChain, route?.dstToken);
}

function blockerSummary(route) {
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

export function analyzeDexRouteSupport(route) {
  const summary = blockerSummary(route);
  return {
    routeKey: routeKey(route),
    srcChain: route?.srcChain || null,
    dstChain: route?.dstChain || null,
    asset: routeAsset(route).ticker,
    classification: summary.classification,
    blockers: summary.blockers,
    entry: summary.entry,
    exit: summary.exit,
  };
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

export function buildDexRouteUniverseSummary({ routes = [], observedAt = null } = {}, options = {}) {
  const routeFilter = options.routeFilter || isBtcFamilyRoute;
  const familyLabel = options.familyLabel || "btc";
  const familyRoutes = (routes || []).filter(routeFilter);
  const analyzed = familyRoutes.map((route) => {
    const summary = analyzeDexRouteSupport(route);
    return {
      routeKey: summary.routeKey,
      srcChain: summary.srcChain,
      dstChain: summary.dstChain,
      asset: summary.asset,
      classification: summary.classification,
      blockers: summary.blockers,
    };
  });

  const gapChains = chainGapItems(familyRoutes);
  const fullyMeasurable = analyzed.filter((item) => item.classification === "fully_measurable_loop_candidate");
  const singleGap = analyzed.filter((item) => item.classification === "single_provider_gap");
  const doubleGap = analyzed.filter((item) => item.classification === "double_provider_gap");

  const summary = {
    schemaVersion: 1,
    observedAt,
    family: familyLabel,
    totalRoutes: routes.length,
    familyRouteCount: familyRoutes.length,
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
  if (familyLabel === "btc") {
    summary.btcFamilyRouteCount = familyRoutes.length;
  }
  return summary;
}

export function buildEthRouteUniverseSummary(args = {}) {
  const summary = buildDexRouteUniverseSummary(args, { routeFilter: isEthFamilyRoute, familyLabel: "eth" });
  return {
    ...summary,
    ethFamilyRouteCount: summary.familyRouteCount,
  };
}
