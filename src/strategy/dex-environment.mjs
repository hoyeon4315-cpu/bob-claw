import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";

function observedAtMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function pctRange(values = []) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const midpoint = (min + max) / 2;
  if (!Number.isFinite(midpoint) || midpoint === 0) return null;
  return (max - min) / midpoint;
}

function btcFamily(asset) {
  return asset?.family === "btc" || asset?.family === "wrapped_btc";
}

function executionUsdPerBtc(quote) {
  const inputAsset = tokenAsset(quote?.chain, quote?.inputToken, {
    ticker: quote?.inputTicker || undefined,
    decimals: quote?.inputDecimals ?? undefined,
  });
  const outputAsset = tokenAsset(quote?.chain, quote?.outputToken, {
    ticker: quote?.outputTicker || undefined,
    decimals: quote?.outputDecimals ?? undefined,
  });

  if (btcFamily(inputAsset)) {
    const amount = unitsToDecimal(quote?.inputAmount, inputAsset.decimals);
    const netUsd = finite(quote?.netOutputValueUsd) ?? finite(quote?.outputValueUsd);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(netUsd)) return null;
    return netUsd / amount;
  }

  if (btcFamily(outputAsset)) {
    const amount = unitsToDecimal(quote?.outputAmount, outputAsset.decimals);
    const inUsd = finite(quote?.inputValueUsd);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(inUsd)) return null;
    return inUsd / amount;
  }

  return null;
}

function routeSelectionKey(quote) {
  if (!quote?.gatewayRouteKey || !quote?.gatewayAmount) return null;
  return `${quote.gatewayRouteKey}|${quote.gatewayAmount}`;
}

function legKey(quote) {
  return [
    routeSelectionKey(quote) || "unbound",
    quote?.source || "unknown",
    quote?.chain || "unknown",
    String(quote?.inputToken || "").toLowerCase(),
    String(quote?.outputToken || "").toLowerCase(),
  ].join("|");
}

function latestQuote(quotes = []) {
  return [...quotes].sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt))[0] || null;
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

function classifyLeg(summary, policy) {
  if (summary.ageMinutes !== null && summary.ageMinutes > policy.maxLegAgeMinutes) return "stale";
  if (summary.latestPriceImpactPct !== null && summary.latestPriceImpactPct > policy.maxPriceImpactPct) return "thin_liquidity";
  if (summary.quoteCount < policy.minRepeatedSamples) return "single_sample";
  if (summary.executionRangePct !== null && summary.executionRangePct > policy.maxExecutionRangePct) return "unstable";
  return "stable_enough_to_monitor";
}

function summarizeLeg(quotes, policy, now) {
  const latest = latestQuote(quotes);
  const executionSamples = quotes.map(executionUsdPerBtc).filter(Number.isFinite);
  const gasSamples = quotes.map((item) => finite(item?.gasEstimateValueUsd)).filter(Number.isFinite);
  const summary = {
    legKey: legKey(latest),
    routeSelectionKey: routeSelectionKey(latest),
    routeKey: latest?.gatewayRouteKey || null,
    amount: latest?.gatewayAmount || null,
    source: latest?.source || null,
    chain: latest?.chain || null,
    inputTicker: latest?.inputTicker || null,
    outputTicker: latest?.outputTicker || null,
    quoteCount: quotes.length,
    latestObservedAt: latest?.observedAt || null,
    ageMinutes: latest?.observedAt ? (observedAtMs(now) - observedAtMs(latest.observedAt)) / 60_000 : null,
    latestExecutionUsdPerBtc: finite(executionUsdPerBtc(latest)),
    executionRangePct: finite(pctRange(executionSamples)),
    latestGasUsd: finite(latest?.gasEstimateValueUsd),
    gasRangePct: finite(pctRange(gasSamples)),
    latestPriceImpactPct: finite(latest?.priceImpactPct),
  };
  return {
    ...summary,
    classification: classifyLeg(summary, policy),
  };
}

function classifyRoute(summary) {
  if (summary.staleLegCount > 0) return "refresh_needed";
  if (summary.unstableLegCount > 0) return "unstable_environment";
  if (summary.thinLiquidityLegCount > 0) return "thin_liquidity";
  if (summary.singleSampleLegCount > 0) return "needs_more_samples";
  if (summary.legCount === 0) return "unmeasured";
  return "stable_enough_to_monitor";
}

function summarizeRoute(routeSelectionKeyValue, legs) {
  const latestObservedAt = [...legs]
    .sort((left, right) => observedAtMs(right.latestObservedAt) - observedAtMs(left.latestObservedAt))[0]?.latestObservedAt || null;
  const summary = {
    routeSelectionKey: routeSelectionKeyValue,
    routeKey: legs[0]?.routeKey || null,
    amount: legs[0]?.amount || null,
    legCount: legs.length,
    latestObservedAt,
    staleLegCount: legs.filter((item) => item.classification === "stale").length,
    unstableLegCount: legs.filter((item) => item.classification === "unstable").length,
    thinLiquidityLegCount: legs.filter((item) => item.classification === "thin_liquidity").length,
    singleSampleLegCount: legs.filter((item) => item.classification === "single_sample").length,
    latestExecutionRangePct: finite(Math.max(...legs.map((item) => item.executionRangePct ?? Number.NEGATIVE_INFINITY))),
    latestPriceImpactPct: finite(Math.max(...legs.map((item) => item.latestPriceImpactPct ?? Number.NEGATIVE_INFINITY))),
    legs,
  };
  return {
    ...summary,
    classification: classifyRoute(summary),
  };
}

export function buildDexEnvironmentSummary({ dexQuotes = [], now = new Date().toISOString() } = {}, options = {}) {
  const policy = {
    maxLegAgeMinutes: 30,
    minRepeatedSamples: 2,
    maxExecutionRangePct: 0.01,
    maxPriceImpactPct: 3,
    ...options,
  };
  const relevantQuotes = (dexQuotes || []).filter((quote) => {
    const inputAsset = tokenAsset(quote?.chain, quote?.inputToken);
    const outputAsset = tokenAsset(quote?.chain, quote?.outputToken);
    return btcFamily(inputAsset) || btcFamily(outputAsset);
  });
  const legGroups = groupBy(relevantQuotes, legKey);
  const legs = [...legGroups.values()].map((items) => summarizeLeg(items, policy, now));
  const routeGroups = groupBy(legs, (item) => item.routeSelectionKey);
  const routes = [...routeGroups.entries()].map(([key, items]) => summarizeRoute(key, items));

  routes.sort(
    (left, right) =>
      (right.staleLegCount - left.staleLegCount) ||
      (right.unstableLegCount - left.unstableLegCount) ||
      (right.thinLiquidityLegCount - left.thinLiquidityLegCount) ||
      String(left.routeSelectionKey).localeCompare(String(right.routeSelectionKey)),
  );

  return {
    schemaVersion: 1,
    generatedAt: now,
    policy,
    quoteCount: relevantQuotes.length,
    legCount: legs.length,
    monitoredRouteCount: routes.length,
    staleLegCount: legs.filter((item) => item.classification === "stale").length,
    unstableLegCount: legs.filter((item) => item.classification === "unstable").length,
    thinLiquidityLegCount: legs.filter((item) => item.classification === "thin_liquidity").length,
    singleSampleLegCount: legs.filter((item) => item.classification === "single_sample").length,
    refreshNeededRouteCount: routes.filter((item) => item.classification === "refresh_needed").length,
    unstableRouteCount: routes.filter((item) => item.classification === "unstable_environment").length,
    topRiskRoute:
      routes.find((item) => item.classification !== "stable_enough_to_monitor") ||
      routes[0] ||
      null,
    routes: routes.slice(0, 10),
  };
}
