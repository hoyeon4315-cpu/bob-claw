import { tokenAsset } from "../assets/tokens.mjs";
import { buildDefaultRiskPolicy } from "../risk/policy.mjs";
import { latestBy } from "../lib/jsonl-read.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function minutesBetween(older, newer) {
  if (!older || !newer) return null;
  return (new Date(newer).getTime() - new Date(older).getTime()) / 60_000;
}

function stableNetOutUsd(quote) {
  if (Number.isFinite(quote?.netOutputValueUsd)) return quote.netOutputValueUsd;
  if (Number.isFinite(quote?.outputValueUsd)) return quote.outputValueUsd - (quote?.gasEstimateValueUsd || 0);
  return null;
}

function stableInputCostUsd(quote) {
  if (!Number.isFinite(quote?.inputValueUsd)) return null;
  return quote.inputValueUsd + (quote?.gasEstimateValueUsd || 0);
}

function amountGapPct(requiredAmount, acquiredAmount) {
  try {
    const required = BigInt(requiredAmount || 0);
    const acquired = BigInt(acquiredAmount || 0);
    if (required <= 0n) return null;
    const diff = required > acquired ? required - acquired : acquired - required;
    return Number(diff * 1_000_000n / required) / 1_000_000;
  } catch {
    return null;
  }
}

function pairKey(chain, token, amount) {
  return `${chain}:${String(token || "").toLowerCase()}:${amount}`;
}

function proxyGroupKey(asset) {
  return String(asset?.ticker || "")
    .replace(/\.oft$/i, "")
    .toLowerCase();
}

function buildObservedProxyCoverage(quotes, side) {
  const coverage = new Map();
  for (const quote of quotes) {
    const asset = tokenAsset(quote.chain, side === "buy" ? quote.outputToken : quote.inputToken);
    const proxyGroup = proxyGroupKey(asset);
    if (!proxyGroup) continue;
    const entry = coverage.get(proxyGroup) || { proxyGroup, quoteCount: 0, chains: new Set(), tickers: new Set() };
    entry.quoteCount += 1;
    entry.chains.add(quote.chain);
    entry.tickers.add(asset.ticker);
    coverage.set(proxyGroup, entry);
  }

  return [...coverage.values()]
    .map((entry) => ({
      proxyGroup: entry.proxyGroup,
      quoteCount: entry.quoteCount,
      chainCount: entry.chains.size,
      tickers: [...entry.tickers].sort(),
    }))
    .sort((left, right) => right.quoteCount - left.quoteCount || String(left.proxyGroup).localeCompare(String(right.proxyGroup)));
}

function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

function buildSellQuotes(dexQuotes = []) {
  const relevant = dexQuotes.filter((quote) => {
    const asset = tokenAsset(quote?.chain, quote?.inputToken);
    return quote?.quoteType === "token_to_stable" && asset.family === "wrapped_btc";
  });
  return latestBy(relevant, (quote) => pairKey(quote.chain, quote.inputToken, quote.inputAmount));
}

function buildBuyQuotes(dexQuotes = []) {
  const relevant = dexQuotes.filter((quote) => {
    const asset = tokenAsset(quote?.chain, quote?.outputToken);
    return quote?.quoteType === "stable_to_token" && asset.family === "wrapped_btc" && quote?.targetTokenAmount;
  });
  return latestBy(relevant, (quote) => pairKey(quote.chain, quote.outputToken, quote.targetTokenAmount));
}

function buildRouteMaps(routes = [], scoreSnapshot = null) {
  const routeMap = new Map();
  for (const route of routes || []) {
    routeMap.set(routeKey(route), route);
  }

  const scoreMap = new Map();
  for (const score of scoreSnapshot?.scores || []) {
    if (!score?.routeKey || !score?.amount) continue;
    scoreMap.set(`${score.routeKey}|${score.amount}`, score);
  }

  return { routeMap, scoreMap };
}

function requiredProfitUsd(baseCostUsd, policy) {
  return Math.max(policy.minNetProfitUsd, (baseCostUsd || 0) * policy.minNetProfitPct);
}

function summarizeOpportunity({ buyQuote, sellQuote, routeMaps, policy, amountTolerancePct }) {
  const buyAsset = tokenAsset(buyQuote.chain, buyQuote.outputToken);
  const sellAsset = tokenAsset(sellQuote.chain, sellQuote.inputToken);
  const proxyGroup = proxyGroupKey(buyAsset);
  const targetAmount = sellQuote.inputAmount;
  const buyCostUsd = stableInputCostUsd(buyQuote);
  const sellRevenueUsd = stableNetOutUsd(sellQuote);
  const rawSpreadUsd =
    Number.isFinite(sellRevenueUsd) && Number.isFinite(buyCostUsd)
      ? sellRevenueUsd - buyCostUsd
      : null;
  const rawSpreadPct =
    Number.isFinite(rawSpreadUsd) && Number.isFinite(buyCostUsd) && buyCostUsd > 0
      ? rawSpreadUsd / buyCostUsd
      : null;

  const amountMismatchPct = amountGapPct(targetAmount, buyQuote.outputAmount);
  const exactAmountMatch = Number.isFinite(amountMismatchPct) ? amountMismatchPct <= amountTolerancePct : false;

  const rebalanceRouteKey = `${buyQuote.chain}:${buyQuote.outputToken}->${sellQuote.chain}:${sellQuote.inputToken}`;
  const rebalanceRoute = routeMaps.routeMap.get(rebalanceRouteKey) || null;
  const rebalanceScore = routeMaps.scoreMap.get(`${rebalanceRouteKey}|${targetAmount}`) || null;
  const rebalanceKnownCostUsd = finite(rebalanceScore?.knownCostUsd);
  const rebalanceAdjustedSpreadUsd =
    Number.isFinite(rawSpreadUsd) && Number.isFinite(rebalanceKnownCostUsd)
      ? rawSpreadUsd - rebalanceKnownCostUsd
      : null;
  const rebalanceAdjustedSpreadPct =
    Number.isFinite(rebalanceAdjustedSpreadUsd) && Number.isFinite(buyCostUsd) && buyCostUsd > 0
      ? rebalanceAdjustedSpreadUsd / buyCostUsd
      : null;
  const profitGateUsd = requiredProfitUsd(buyCostUsd, policy);

  const blockers = [];
  if (!exactAmountMatch) blockers.push("amount_mismatch");
  if (!(rawSpreadUsd > 0)) blockers.push("non_positive_raw_spread");
  if (!rebalanceRoute) blockers.push("missing_rebalance_route");
  if (rebalanceRoute && !rebalanceScore) blockers.push("missing_rebalance_score");
  if (rebalanceScore?.tradeReadiness && rebalanceScore.tradeReadiness !== "shadow_candidate_review_only") {
    blockers.push(`rebalance_${rebalanceScore.tradeReadiness}`);
  }
  for (const gap of rebalanceScore?.dataGaps || []) blockers.push(`rebalance_${gap}`);
  if (rebalanceRoute && rebalanceScore && !(rebalanceAdjustedSpreadUsd > 0)) blockers.push("non_positive_rebalance_adjusted_spread");
  if (rebalanceRoute && rebalanceScore && Number.isFinite(rebalanceAdjustedSpreadUsd) && rebalanceAdjustedSpreadUsd < profitGateUsd) {
    blockers.push("below_policy_gate_after_rebalance");
  }

  return {
    proxyGroup,
    proxyTicker: buyAsset.ticker === sellAsset.ticker ? buyAsset.ticker : `${buyAsset.ticker}/${sellAsset.ticker}`,
    buyProxyTicker: buyAsset.ticker,
    sellProxyTicker: sellAsset.ticker,
    proxyToken: buyQuote.outputToken,
    amount: targetAmount,
    buyChain: buyQuote.chain,
    buyStableTicker: buyQuote.inputTicker || null,
    buyStableCostUsd: finite(buyCostUsd),
    buyGasUsd: finite(buyQuote.gasEstimateValueUsd),
    buyObservedAt: buyQuote.observedAt || null,
    buyGatewayRouteKey: buyQuote.gatewayRouteKey || null,
    sellChain: sellQuote.chain,
    sellStableTicker: sellQuote.outputTicker || null,
    sellStableRevenueUsd: finite(sellRevenueUsd),
    sellGasUsd: finite(sellQuote.gasEstimateValueUsd),
    sellObservedAt: sellQuote.observedAt || null,
    sellGatewayRouteKey: sellQuote.gatewayRouteKey || null,
    buyActualOutputAmount: buyQuote.outputAmount,
    sellInputAmount: sellQuote.inputAmount,
    amountMismatchPct: finite(amountMismatchPct),
    exactAmountMatch,
    rawSpreadUsd: finite(rawSpreadUsd),
    rawSpreadPct: finite(rawSpreadPct),
    rebalanceRouteKey: rebalanceRouteKey,
    rebalanceRoutePresent: Boolean(rebalanceRoute),
    rebalanceKnownCostUsd,
    rebalanceTradeReadiness: rebalanceScore?.tradeReadiness || null,
    rebalanceAdjustedSpreadUsd: finite(rebalanceAdjustedSpreadUsd),
    rebalanceAdjustedSpreadPct: finite(rebalanceAdjustedSpreadPct),
    requiredProfitUsd: finite(profitGateUsd),
    policyReadyAfterRebalance: Number.isFinite(rebalanceAdjustedSpreadUsd) && rebalanceAdjustedSpreadUsd >= profitGateUsd,
    blockers: [...new Set(blockers)],
  };
}

export function buildBtcProxySpreadSummary({ dexQuotes = [], routes = [], scoreSnapshot = null } = {}, options = {}) {
  const policy = {
    ...buildDefaultRiskPolicy(),
    ...(options.policy || {}),
  };
  const amountTolerancePct = Number.isFinite(options.amountTolerancePct) ? options.amountTolerancePct : 0.02;
  const maxQuoteAgeMinutes = Number.isFinite(options.maxQuoteAgeMinutes) ? options.maxQuoteAgeMinutes : 30;
  const now = options.now || new Date().toISOString();
  const proxyTicker = options.proxyTicker || null;
  const routeMaps = buildRouteMaps(routes, scoreSnapshot);
  const sellQuotes = [...buildSellQuotes(dexQuotes).values()];
  const buyQuotes = [...buildBuyQuotes(dexQuotes).values()];
  const opportunities = [];

  for (const buyQuote of buyQuotes) {
      const buyAsset = tokenAsset(buyQuote.chain, buyQuote.outputToken);
    const buyProxyGroup = proxyGroupKey(buyAsset);
    if (proxyTicker && buyAsset.ticker !== proxyTicker && buyProxyGroup !== String(proxyTicker).toLowerCase()) continue;
    for (const sellQuote of sellQuotes) {
      const sellAsset = tokenAsset(sellQuote.chain, sellQuote.inputToken);
      if (buyQuote.chain === sellQuote.chain) continue;
      if (buyProxyGroup !== proxyGroupKey(sellAsset)) continue;
      if (String(buyQuote.targetTokenAmount) !== String(sellQuote.inputAmount)) continue;
      opportunities.push(summarizeOpportunity({
        buyQuote,
        sellQuote,
        routeMaps,
        policy,
        amountTolerancePct,
      }));
    }
  }

  opportunities.sort(
    (left, right) =>
      (right.rebalanceAdjustedSpreadUsd ?? Number.NEGATIVE_INFINITY) - (left.rebalanceAdjustedSpreadUsd ?? Number.NEGATIVE_INFINITY) ||
      (right.rawSpreadUsd ?? Number.NEGATIVE_INFINITY) - (left.rawSpreadUsd ?? Number.NEGATIVE_INFINITY) ||
      String(left.proxyGroup).localeCompare(String(right.proxyGroup)) ||
      String(left.buyChain).localeCompare(String(right.buyChain)) ||
      String(left.sellChain).localeCompare(String(right.sellChain)),
  );

  const quoteAges = [...buyQuotes, ...sellQuotes]
    .map((item) => minutesBetween(item.observedAt, now))
    .filter(Number.isFinite);
  const buyFreshCount = buyQuotes.filter((item) => (minutesBetween(item.observedAt, now) ?? Number.POSITIVE_INFINITY) <= maxQuoteAgeMinutes).length;
  const sellFreshCount = sellQuotes.filter((item) => (minutesBetween(item.observedAt, now) ?? Number.POSITIVE_INFINITY) <= maxQuoteAgeMinutes).length;
  const observedBuyProxyCoverage = buildObservedProxyCoverage(buyQuotes, "buy");
  const observedSellProxyCoverage = buildObservedProxyCoverage(sellQuotes, "sell");
  const proxyGroups = new Map();
  for (const item of opportunities) {
    const existing = proxyGroups.get(item.proxyGroup) || { proxyGroup: item.proxyGroup, opportunityCount: 0, buyChains: new Set(), sellChains: new Set() };
    existing.opportunityCount += 1;
    existing.buyChains.add(item.buyChain);
    existing.sellChains.add(item.sellChain);
    proxyGroups.set(item.proxyGroup, existing);
  }
  const proxyCoverage = [...proxyGroups.values()]
    .map((item) => ({
      proxyGroup: item.proxyGroup,
      opportunityCount: item.opportunityCount,
      buyChainCount: item.buyChains.size,
      sellChainCount: item.sellChains.size,
    }))
    .sort((left, right) => right.opportunityCount - left.opportunityCount || String(left.proxyGroup).localeCompare(String(right.proxyGroup)));
  const unmatchedObservedProxyGroups = [
    ...new Set([
      ...observedBuyProxyCoverage
        .filter((item) => !proxyCoverage.find((matched) => matched.proxyGroup === item.proxyGroup))
        .map((item) => item.proxyGroup),
      ...observedSellProxyCoverage
        .filter((item) => !proxyCoverage.find((matched) => matched.proxyGroup === item.proxyGroup))
        .map((item) => item.proxyGroup),
    ]),
  ].sort();
  const overfitRisks = [];
  if (buyQuotes.length < 15) overfitRisks.push("thin_buy_quote_coverage");
  if (sellQuotes.length < 30) overfitRisks.push("thin_sell_quote_coverage");
  if (buyFreshCount === 0 || sellFreshCount === 0) overfitRisks.push("all_quotes_stale");
  if (proxyCoverage.length < 2) overfitRisks.push("single_proxy_group");
  if (opportunities.length < 20) overfitRisks.push("small_opportunity_surface");
  const overfitAssessment =
    overfitRisks.length >= 3 ? "high_overfit_risk" :
    overfitRisks.length >= 1 ? "moderate_overfit_risk" :
    "coverage_ok";

  return {
    schemaVersion: 1,
    generatedAt: now,
    amountTolerancePct,
    maxQuoteAgeMinutes,
    proxyTicker: proxyTicker || null,
    buyQuoteCount: buyQuotes.length,
    sellQuoteCount: sellQuotes.length,
    buyFreshCount,
    sellFreshCount,
    freshestQuoteAgeMinutes: quoteAges.length ? Math.min(...quoteAges) : null,
    stalestQuoteAgeMinutes: quoteAges.length ? Math.max(...quoteAges) : null,
    observedBuyProxyGroupCount: observedBuyProxyCoverage.length,
    observedSellProxyGroupCount: observedSellProxyCoverage.length,
    observedBuyProxyCoverage,
    observedSellProxyCoverage,
    proxyGroupCount: proxyCoverage.length,
    proxyCoverage,
    unmatchedObservedProxyGroups,
    opportunityCount: opportunities.length,
    rawPositiveCount: opportunities.filter((item) => (item.rawSpreadUsd ?? Number.NEGATIVE_INFINITY) > 0).length,
    rebalancePositiveCount: opportunities.filter((item) => (item.rebalanceAdjustedSpreadUsd ?? Number.NEGATIVE_INFINITY) > 0).length,
    policyReadyCount: opportunities.filter((item) => item.policyReadyAfterRebalance).length,
    overfitAssessment,
    overfitRisks,
    bestRawOpportunity:
      [...opportunities].sort(
        (left, right) =>
          (right.rawSpreadUsd ?? Number.NEGATIVE_INFINITY) - (left.rawSpreadUsd ?? Number.NEGATIVE_INFINITY) ||
          String(left.proxyGroup).localeCompare(String(right.proxyGroup)),
      )[0] || null,
    bestRebalanceOpportunity: opportunities[0] || null,
    opportunities: opportunities.slice(0, 20),
  };
}
