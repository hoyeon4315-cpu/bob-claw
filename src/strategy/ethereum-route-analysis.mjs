import { isEthFamilyRoute, isEthLikeAsset, tokenAsset } from "../assets/tokens.mjs";
import { filterTrustedExecutableDexQuotes } from "../dex/odos.mjs";
import { hasEthereumL1PhaseBlock, isEthereumL1Route } from "../risk/ethereum-l1-policy.mjs";
import { buildEdgeViabilitySummary, buildEdgeViabilityVerdict } from "./edge-viability.mjs";
import { buildEthGatewayArbitrageSummary } from "./dex-gateway-arbitrage.mjs";
import { buildEthRouteFocusSummary } from "./dex-route-focus.mjs";
import { buildEthereumRoutePersistenceSummary } from "./ethereum-route-persistence.mjs";
import { buildEthRouteUniverseSummary } from "./dex-route-universe.mjs";

function parseRouteKey(routeKey) {
  const [left, right] = String(routeKey || "").split("->");
  const [srcChain, srcToken] = String(left || "").split(":");
  const [dstChain, dstToken] = String(right || "").split(":");
  if (!srcChain || !srcToken || !dstChain || !dstToken) return null;
  return { srcChain, srcToken, dstChain, dstToken };
}

function routeFromValue(value) {
  if (value?.route) return value.route;
  if (value?.srcChain && value?.dstChain && value?.srcToken && value?.dstToken) {
    return {
      srcChain: value.srcChain,
      srcToken: value.srcToken,
      dstChain: value.dstChain,
      dstToken: value.dstToken,
    };
  }
  if (value?.routeKey) return parseRouteKey(value.routeKey);
  if (value?.gatewayRouteKey) return parseRouteKey(value.gatewayRouteKey);
  return null;
}

function isNativeEthRoute(value) {
  const route = routeFromValue(value);
  if (!route) return false;
  return tokenAsset(route.srcChain, route.srcToken).ticker === "ETH" || tokenAsset(route.dstChain, route.dstToken).ticker === "ETH";
}

function isEthRelated(value) {
  const route = routeFromValue(value);
  if (!route) return false;
  return isEthereumL1Route(route) || isNativeEthRoute(route);
}

function isEthFamilyValue(value) {
  const route = routeFromValue(value);
  return isEthFamilyRoute(route);
}

function isEthFamilyScore(value) {
  return isEthLikeAsset(value?.srcAsset) && isEthLikeAsset(value?.dstAsset);
}

function routeLabel(route) {
  if (!route) return null;
  const src = tokenAsset(route.srcChain, route.srcToken);
  const dst = tokenAsset(route.dstChain, route.dstToken);
  return `${route.srcChain}->${route.dstChain} ${src.ticker}->${dst.ticker}`;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

function numericSummary(values = []) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: null, median: null, max: null };
  return {
    min: Math.min(...finite),
    median: median(finite),
    max: Math.max(...finite),
  };
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))));
}

function topBy(items, selector, limit = 5) {
  return [...items]
    .sort(
      (left, right) =>
        (selector(right) ?? Number.NEGATIVE_INFINITY) - (selector(left) ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey || left.gatewayRouteKey || "").localeCompare(String(right.routeKey || right.gatewayRouteKey || "")),
    )
    .slice(0, limit);
}

function labelValue(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.code || value.message || value.error || value.detail || JSON.stringify(value);
  }
  return String(value);
}

function failureReason(failure) {
  return (
    labelValue(failure?.reason) ||
    labelValue(failure?.code) ||
    labelValue(failure?.errorCode) ||
    labelValue(failure?.status) ||
    labelValue(failure?.message) ||
    labelValue(failure?.error) ||
    "unknown_failure"
  );
}

function hourBucket(observedAt) {
  if (!observedAt) return null;
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 13);
}

function routeAmountLevelCounts(items = []) {
  const byRoute = new Map();
  for (const item of items) {
    if (!hasRouteAmountPair(item)) continue;
    if (!byRoute.has(item.routeKey)) byRoute.set(item.routeKey, new Set());
    byRoute.get(item.routeKey).add(String(item.amount));
  }
  return [...byRoute.values()].map((amounts) => amounts.size);
}

function hasRouteAmountPair(item) {
  return Boolean(item?.routeKey) && item?.amount !== null && item?.amount !== undefined && String(item.amount) !== "";
}

function overfitSignals({ quotes = [], scores = [] } = {}) {
  const routeCount = new Set(quotes.map((item) => item.routeKey).filter(Boolean)).size;
  const routeAmountCount = new Set(quotes.filter(hasRouteAmountPair).map((item) => `${item.routeKey}|${item.amount}`)).size;
  const hourBucketCount = new Set(quotes.map((item) => hourBucket(item.observedAt)).filter(Boolean)).size;
  const amountLevels = routeAmountLevelCounts(quotes);
  const scoreHourBucketCount = new Set(scores.map((item) => hourBucket(item.observedAt)).filter(Boolean)).size;
  const risks = [];
  if (quotes.length < 10) risks.push("thin_quote_samples");
  if (routeCount < 2) risks.push("single_route_surface");
  if (routeAmountCount < 3) risks.push("narrow_amount_surface");
  if ((amountLevels.length > 0 ? Math.max(...amountLevels) : 0) < 2) risks.push("single_amount_level_per_route");
  if (hourBucketCount < 3) risks.push("narrow_quote_time_coverage");
  if (scoreHourBucketCount > 0 && scoreHourBucketCount < 3) risks.push("narrow_score_time_coverage");
  return {
    quoteRouteCount: routeCount,
    quoteRouteAmountCount: routeAmountCount,
    quoteHourBucketCount: hourBucketCount,
    scoreHourBucketCount,
    maxAmountLevelsPerRoute: amountLevels.length ? Math.max(...amountLevels) : 0,
    medianAmountLevelsPerRoute: amountLevels.length ? median(amountLevels) : null,
    risks,
  };
}

function bestScore(scores = [], predicate = () => true) {
  return topBy(
    scores.filter(predicate),
    (score) => score.executableNetEdgeUsd ?? score.netEdgeUsd,
    1,
  )[0] || null;
}

function scoreSummary(score) {
  if (!score) return null;
  const route = routeFromValue(score);
  return {
    routeKey: score.routeKey || null,
    label: routeLabel(route),
    amount: score.amount || null,
    tradeReadiness: score.tradeReadiness || null,
    netEdgeUsd: numberOrNull(score.netEdgeUsd),
    executableNetEdgeUsd: numberOrNull(score.executableNetEdgeUsd),
    knownCostUsd: numberOrNull(score.knownCostUsd),
  };
}

function recommendation({
  capability,
  scores,
  overfit,
  ethFamilyOverfit,
  ethFamilyPersistence,
  ethFamilyRouteUniverse,
  ethFamilyRouteFocus,
  ethFamilyGatewayArbitrage,
}) {
  if (capability.gatewayRouteCount === 0) {
    return {
      code: "no_eth_routes_observed",
      label: "No ETH-related Gateway routes observed yet",
      detail: "Do not expand strategy scope until the route inventory shows stable ETH-related coverage.",
    };
  }

  if (capability.ethFamilyRouteCount === 0) {
    return {
      code: "no_multichain_eth_family_surface",
      label: "No chain-to-chain ETH family Gateway surface yet",
      detail: "Current ETH-related routes are still dominated by BTC<->ETH or Ethereum-L1 touchpoints, not pure ETH-on-ETH cross-chain loops.",
    };
  }

  if ((ethFamilyPersistence?.stableRouteCount || 0) === 0) {
    return {
      code: "eth_family_surface_not_persistent",
      label: "ETH family routes are not persistent yet",
      detail: "A route must persist across repeated inventory snapshots before it counts as durable cross-chain surface rather than transient Gateway inventory.",
    };
  }

  if ((ethFamilyRouteUniverse?.fullyMeasurableRouteCount || 0) === 0) {
    return {
      code: "eth_family_provider_gaps",
      label: "ETH family routes still have provider gaps",
      detail: "Before calling it arbitrage, collect route support where both stable entry and stable exit can be measured around the Gateway leg.",
    };
  }

  if ((ethFamilyRouteFocus?.loopObservableCount || 0) === 0) {
    return {
      code: "collect_eth_family_loop_quotes",
      label: "Collect ETH family loop quotes first",
      detail: "A measurable ETH family route surface exists, but the stable-entry and stable-exit quote set is not closed yet.",
    };
  }

  if ((ethFamilyGatewayArbitrage?.measuredNetLoopCount || 0) === 0) {
    return {
      code: "collect_eth_family_entry_quotes",
      label: "Collect ETH family entry quotes first",
      detail: "The ETH family Gateway leg is measurable, but a closed stable->ETH->Gateway->stable loop has not been measured yet.",
    };
  }

  if (scores.policyBlockedCount > 0) {
    return {
      code: "observe_only_until_fee_review",
      label: "Keep Ethereum L1 observe-only",
      detail: "ETH capability exists, but Ethereum L1 routes remain blocked in the USD 300 phase until fee analysis and explicit re-approval clear them.",
    };
  }

  if ((ethFamilyOverfit?.risks || []).length > 0) {
    return {
      code: "collect_more_eth_evidence",
      label: "Collect more ETH evidence first",
      detail: "The current ETH family route sample is still too thin across amounts, routes, or time buckets to treat as a durable edge surface.",
    };
  }

  return {
    code: "research_non_l1_eth_routes",
    label: "Research non-L1 ETH routes next",
    detail: "ETH-related coverage exists outside Ethereum L1, so shadow-only monitoring can expand there without changing live-trading policy.",
  };
}

export function buildEthereumRouteAnalysis({
  routesRecord = null,
  routeRecords = [],
  quotes = [],
  failures = [],
  dexQuotes = [],
  scores = [],
  shadowObservations = [],
} = {}) {
  const latestRoutesRecord = routesRecord || routeRecords.at(-1) || null;
  const trustedDexQuotes = filterTrustedExecutableDexQuotes(dexQuotes);
  const gatewayRoutes = (latestRoutesRecord?.routes || []).filter(isEthRelated);
  const ethQuotes = (quotes || []).filter(isEthRelated);
  const ethFailures = (failures || []).filter(isEthRelated);
  const ethScores = (scores || []).filter(isEthRelated);
  const ethFamilyQuotes = (quotes || []).filter(isEthFamilyValue);
  const ethFamilyScores = (scores || []).filter(isEthFamilyValue);
  const ethDexQuotes = trustedDexQuotes.filter((quote) => {
    if (isEthRelated(quote)) return true;
    return quote?.chain === "ethereum" || quote?.inputTicker === "ETH" || quote?.outputTicker === "ETH";
  });
  const ethFamilyRouteUniverse = buildEthRouteUniverseSummary({
    routes: latestRoutesRecord?.routes || [],
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  const ethFamilyRouteFocus = buildEthRouteFocusSummary({
    routes: latestRoutesRecord?.routes || [],
    quotes,
    scoreSnapshot: { generatedAt: null, scores },
    dexQuotes: trustedDexQuotes,
  });
  const ethFamilyGatewayArbitrage = buildEthGatewayArbitrageSummary({
    scoreSnapshot: { generatedAt: null, scores },
    dexQuotes: trustedDexQuotes,
  });
  const ethFamilyEdgeViability = buildEdgeViabilitySummary(
    {
      scoreSnapshot: { generatedAt: null, scores },
      dexQuotes: trustedDexQuotes,
    },
    {
      scoreFilter: isEthFamilyScore,
    },
  );
  const ethFamilyVerdict = buildEdgeViabilityVerdict({
    edgeViability: ethFamilyEdgeViability,
    dexRouteFocus: ethFamilyRouteFocus,
  });
  const ethFamilyPersistence = buildEthereumRoutePersistenceSummary({
    routeRecords,
    quotes,
    shadowObservations,
  });
  const ethFamilyOverfit = overfitSignals({ quotes: ethFamilyQuotes, scores: ethFamilyScores });

  const capability = {
    latestObservedAt: latestRoutesRecord?.observedAt || null,
    gatewayRouteCount: gatewayRoutes.length,
    ethereumL1RouteCount: gatewayRoutes.filter(isEthereumL1Route).length,
    nativeEthRouteCount: gatewayRoutes.filter(isNativeEthRoute).length,
    ethFamilyRouteCount: gatewayRoutes.filter(isEthFamilyRoute).length,
    nonL1NativeEthRouteCount: gatewayRoutes.filter((route) => isNativeEthRoute(route) && !isEthereumL1Route(route)).length,
    sampleRoutes: gatewayRoutes.slice(0, 8).map((route) => ({
      label: routeLabel(route),
      routeKey: `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`,
    })),
  };

  const quotesSummary = {
    successCount: ethQuotes.length,
    failureCount: ethFailures.length,
    successRate:
      ethQuotes.length + ethFailures.length > 0
        ? ethQuotes.length / (ethQuotes.length + ethFailures.length)
        : null,
    uniqueRouteCount: new Set(ethQuotes.map((item) => item.routeKey).filter(Boolean)).size,
    uniqueRouteAmountCount: new Set(ethQuotes.filter(hasRouteAmountPair).map((item) => `${item.routeKey}|${item.amount}`)).size,
    latencyMs: numericSummary(ethQuotes.map((item) => item.latencyMs)),
    feeRatio: numericSummary(ethQuotes.map((item) => item.feeRatio)),
    failureReasons: countBy(ethFailures, failureReason),
  };

  const scoresSummary = {
    count: ethScores.length,
    ethFamilyCount: ethFamilyScores.length,
    policyBlockedCount: ethScores.filter(hasEthereumL1PhaseBlock).length,
    tradeReadiness: countBy(ethScores, (item) => item.tradeReadiness || "null"),
    netEdgeUsd: numericSummary(ethScores.map((item) => item.netEdgeUsd)),
    executableNetEdgeUsd: numericSummary(ethScores.map((item) => item.executableNetEdgeUsd)),
    knownCostUsd: numericSummary(ethScores.map((item) => item.knownCostUsd)),
    bestOpenResearchRoute: scoreSummary(bestScore(ethScores, (item) => !hasEthereumL1PhaseBlock(item))),
    bestPolicyBlockedRoute: scoreSummary(bestScore(ethScores, hasEthereumL1PhaseBlock)),
  };

  const dexSummary = {
    quoteCount: ethDexQuotes.length,
    chainCounts: countBy(ethDexQuotes, (item) => item.chain || "unknown"),
    inputTickerCounts: countBy(ethDexQuotes, (item) => item.inputTicker || "unknown"),
    outputTickerCounts: countBy(ethDexQuotes, (item) => item.outputTicker || "unknown"),
  };

  const overfit = overfitSignals({ quotes: ethQuotes, scores: ethScores });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    capability,
    quotes: quotesSummary,
    scores: scoresSummary,
    dex: dexSummary,
    ethFamily: {
      quoteCount: ethFamilyQuotes.length,
      scoreCount: ethFamilyScores.length,
      overfit: ethFamilyOverfit,
      persistence: ethFamilyPersistence,
      routeUniverse: ethFamilyRouteUniverse,
      routeFocus: ethFamilyRouteFocus,
      gatewayArbitrage: ethFamilyGatewayArbitrage,
      viability: ethFamilyEdgeViability,
      verdict: ethFamilyVerdict,
    },
    overfit,
    recommendation: recommendation({
      capability,
      scores: scoresSummary,
      overfit,
      ethFamilyOverfit,
      ethFamilyPersistence,
      ethFamilyRouteUniverse,
      ethFamilyRouteFocus,
      ethFamilyGatewayArbitrage,
    }),
  };
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value >= 1 ? 2 : 4)}` : "n/a";
}

export function formatEthereumRouteAnalysis(analysis) {
  const lines = [];
  lines.push("ETH route analysis");
  lines.push(`gateway routes=${analysis.capability.gatewayRouteCount} ethereum_l1=${analysis.capability.ethereumL1RouteCount} native_eth=${analysis.capability.nativeEthRouteCount}`);
  lines.push(`eth_family routes=${analysis.capability.ethFamilyRouteCount} measurable=${analysis.ethFamily.routeUniverse.fullyMeasurableRouteCount} loopObservable=${analysis.ethFamily.routeFocus.loopObservableCount}`);
  lines.push(`eth_family persistence snapshots=${analysis.ethFamily.persistence.snapshotCount} stable=${analysis.ethFamily.persistence.stableRouteCount} emerging=${analysis.ethFamily.persistence.emergingRouteCount} sampled=${analysis.ethFamily.persistence.currentSampledRouteCount}`);
  lines.push(`quotes success=${analysis.quotes.successCount} failures=${analysis.quotes.failureCount} successRate=${pct(analysis.quotes.successRate)}`);
  lines.push(`scores=${analysis.scores.count} policyBlocked=${analysis.scores.policyBlockedCount}`);
  lines.push(`eth_family loops measured=${analysis.ethFamily.gatewayArbitrage.measuredNetLoopCount} profitable=${analysis.ethFamily.gatewayArbitrage.profitableExactCount}`);
  lines.push(`eth_family verdict=${analysis.ethFamily.verdict.code} ${analysis.ethFamily.verdict.label}`);
  lines.push(`eth_family overfit=${analysis.ethFamily.overfit.risks.join(",") || "none"}`);
  lines.push(`netEdge median=${money(analysis.scores.netEdgeUsd.median)} executable median=${money(analysis.scores.executableNetEdgeUsd.median)}`);
  lines.push(`overfit risks=${analysis.overfit.risks.join(",") || "none"}`);
  lines.push(`recommendation=${analysis.recommendation.code} ${analysis.recommendation.label}`);
  if (analysis.scores.bestOpenResearchRoute) {
    lines.push(`best open route=${analysis.scores.bestOpenResearchRoute.label} amount=${analysis.scores.bestOpenResearchRoute.amount} exec=${money(analysis.scores.bestOpenResearchRoute.executableNetEdgeUsd)}`);
  }
  if (analysis.scores.bestPolicyBlockedRoute) {
    lines.push(`best policy-blocked=${analysis.scores.bestPolicyBlockedRoute.label} amount=${analysis.scores.bestPolicyBlockedRoute.amount} exec=${money(analysis.scores.bestPolicyBlockedRoute.executableNetEdgeUsd)}`);
  }
  return lines.join("\n");
}
