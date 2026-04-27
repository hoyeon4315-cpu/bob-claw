import { join } from "node:path";
import { WBTC_OFT_TOKEN, classifyGatewayAssetUniverse, isBtcFamilyRoute, isEthFamilyRoute, routeAsset, tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { buildOverfitAudit } from "../audit/overfit.mjs";
import { compareAnnouncedGatewayChains } from "../chains/gateway-announced.mjs";
import { canQuoteWithDex, filterTrustedExecutableDexQuotes, normalizeDexSupportReason, STABLE_QUOTE_TOKENS } from "../dex/odos.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { latestBy } from "../lib/jsonl-read.mjs";
import { emptyPricesUsd, latestPriceSnapshot, overlayObservedPricesUsd, pricesFromSnapshot } from "../market/prices.mjs";
import { buildPreliveReadinessSummary } from "../prelive/readiness.mjs";
import { buildPreliveEvidenceCampaignSummary } from "../prelive/evidence-campaign.mjs";
import { buildPromotionSlice } from "./promotion-slice.mjs";
import { buildConnectedRefreshExecutionSummary } from "../prelive/connected-refresh-runner.mjs";
import { buildCurrentRoutePrelivePassSummary } from "../prelive/current-route-prelive-pass.mjs";
import { buildShadowRefreshBatchSummary } from "../session/shadow-refresh-batch.mjs";
import { buildShadowRefreshQueue } from "../session/shadow-refresh-queue.mjs";
import { buildShadowRefreshExecutionSummary } from "../session/shadow-refresh-runner.mjs";
import { buildReceiptLedgerSummary } from "../ledger/receipt-reconciliation.mjs";
import { buildYieldShadowBook, summarizeYieldShadowBook } from "../ledger/yield-shadow-book.mjs";
import { buildBtcProxySpreadSummary } from "../strategy/btc-proxy-spreads.mjs";
import { buildCrossAssetArbitrageSummary } from "../strategy/cross-asset-arbitrage.mjs";
import { buildDexEnvironmentSummary } from "../strategy/dex-environment.mjs";
import { buildDexRouteFocusSummary } from "../strategy/dex-route-focus.mjs";
import { buildDexGatewayArbitrageSummary } from "../strategy/dex-gateway-arbitrage.mjs";
import { buildDexRouteUniverseSummary } from "../strategy/dex-route-universe.mjs";
import { buildEdgeViabilitySummary, buildEdgeViabilityVerdict } from "../strategy/edge-viability.mjs";
import { buildEdgeResearchSummary } from "../strategy/edge-research.mjs";
import { buildEthereumRouteAnalysis } from "../strategy/ethereum-route-analysis.mjs";
import { buildNoEdgePersistenceSummary } from "../strategy/no-edge-persistence.mjs";
import { buildEthProfitabilitySummary } from "../strategy/profitability-summary.mjs";
import { buildStrategyPivotPlan, summarizeStrategyPivotPlan } from "../strategy/pivot-plan.mjs";
import { buildProxySpreadCoveragePlan, summarizeProxySpreadCoveragePlan } from "../strategy/proxy-spread-coverage-plan.mjs";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../strategy/strategy-snapshot.mjs";
import { buildStrategyTracksSummary } from "../strategy/strategy-tracks.mjs";

const STATUS_SCHEMA_VERSION = 2;
// No project-wide risk budget anymore; per-strategy caps live in each
// strategy's config. Public status reports `null` for legacy fields.
const RISK_BUDGET_USD = null;
const GATEWAY_NODE = "bob_gateway";
const CHAIN_PRICE_STALE_MINUTES = 60;
const DECISION_INPUT_STALE_MINUTES = 30;

function stripVolatileStatusFields(value) {
  if (typeof value === "string") {
    return value.replace(/\b[\d.]+m old\b/g, "<volatile_age>");
  }
  if (Array.isArray(value)) return value.map(stripVolatileStatusFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "generatedAt" && key !== "ageMinutes")
      .map(([key, nested]) => [key, stripVolatileStatusFields(nested)]),
  );
}

function emptyResearchFunnelSlice() {
  return {
    available: false,
    generatedAt: null,
    summary: {
      candidateCount: 0,
      oosEligibleCount: 0,
      promotionIntentCount: 0,
      latestBlocker: null,
      latestRunAt: null,
    },
    tracks: {
      A: {
        candidateCount: 0,
        oosEligibleCount: 0,
        promotionIntentCount: 0,
        latestBlocker: null,
        latestRunAt: null,
      },
      B: {
        candidateCount: 0,
        oosEligibleCount: 0,
        promotionIntentCount: 0,
        latestBlocker: null,
        latestRunAt: null,
      },
    },
  };
}

function latest(items) {
  return items.at(-1) || null;
}

function minutesBetween(older, newer) {
  if (!older) return null;
  return (new Date(newer).getTime() - new Date(older).getTime()) / 60_000;
}

function freshnessStatus(observedAt, now, staleAfterMinutes = DECISION_INPUT_STALE_MINUTES) {
  const ageMinutes = minutesBetween(observedAt, now);
  return {
    observedAt: observedAt || null,
    ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
    stale: Number.isFinite(ageMinutes) ? ageMinutes > staleAfterMinutes : true,
  };
}

function pctChange(reference, value) {
  if (!Number.isFinite(reference) || reference === 0 || !Number.isFinite(value)) return null;
  return ((value - reference) / reference) * 100;
}

function countRecent(items, now, hours) {
  const cutoff = new Date(now).getTime() - hours * 3_600_000;
  return items.filter((item) => item.observedAt && new Date(item.observedAt).getTime() >= cutoff).length;
}

function routeChains(routes) {
  return [...new Set(routes.flatMap((route) => [route.srcChain, route.dstChain]))].sort();
}

function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

function chainPairKey(route) {
  return `${route.srcChain}->${route.dstChain}`;
}

function directionForRoute(route) {
  if (route.srcChain === "bitcoin") return "btc_out";
  if (route.dstChain === "bitcoin") return "btc_in";
  if (route.srcChain === "bob") return "bob_out";
  if (route.dstChain === "bob") return "bob_in";
  return "chain_to_chain";
}

function visualPathForRoute(route) {
  return [route.srcChain, GATEWAY_NODE, route.dstChain];
}

function visualSegmentsForRoute(route) {
  const src = tokenAsset(route.srcChain, route.srcToken);
  const dst = tokenAsset(route.dstChain, route.dstToken);
  return [
    { from: route.srcChain, to: GATEWAY_NODE, asset: src },
    { from: GATEWAY_NODE, to: route.dstChain, asset: dst },
  ];
}

function buildFlowRoutes(routes) {
  const byPair = new Map();

  for (const route of routes) {
    const pair = chainPairKey(route);
    const path = visualPathForRoute(route);
    const key = `${pair}|${path.join(">")}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        pair,
        srcChain: route.srcChain,
        dstChain: route.dstChain,
        direction: directionForRoute(route),
        path,
        routeCount: 0,
        routeKeys: [],
        btcFamilyRoutes: 0,
        assets: new Map(),
      });
    }

    const item = byPair.get(key);
    item.routeCount += 1;
    item.routeKeys.push(routeKey(route));
    if (isBtcFamilyRoute(route)) item.btcFamilyRoutes += 1;
    const asset = routeAsset(route);
    const assetKey = `${asset.src.ticker}->${asset.dst.ticker}`;
    item.assets.set(assetKey, {
      ticker: asset.ticker,
      family: asset.family,
      icon: asset.icon,
      src: asset.src,
      dst: asset.dst,
      count: (item.assets.get(assetKey)?.count || 0) + 1,
    });
  }

  const directionOrder = {
    btc_out: 0,
    btc_in: 1,
    bob_out: 2,
    bob_in: 3,
    chain_to_chain: 4,
  };

  return [...byPair.values()]
    .map((item) => ({
      ...item,
      assets: [...item.assets.values()].sort((left, right) => right.count - left.count || left.ticker.localeCompare(right.ticker)),
      routeKeys: item.routeKeys.sort().slice(0, 8),
    }))
    .sort(
      (left, right) =>
        directionOrder[left.direction] - directionOrder[right.direction] ||
        right.routeCount - left.routeCount ||
        left.pair.localeCompare(right.pair),
    );
}

function buildRecentFlowEvents(quotes) {
  return quotes
    .filter((quote) => quote.route)
    .slice(-40)
    .map((quote) => ({
      observedAt: quote.observedAt,
      srcChain: quote.route.srcChain,
      dstChain: quote.route.dstChain,
      direction: directionForRoute(quote.route),
      path: visualPathForRoute(quote.route),
      segments: visualSegmentsForRoute(quote.route),
      asset: routeAsset(quote.route),
      quoteType: quote.quoteType,
      amount: quote.amount,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      feeRatio: Number.isFinite(quote.feeRatio) ? quote.feeRatio : null,
      latencyMs: quote.latencyMs || null,
      estimatedTimeInSecs: quote.estimatedTimeInSecs || null,
    }))
    .sort((left, right) => new Date(left.observedAt) - new Date(right.observedAt));
}

function buildAssetCoverage(routes, quotes, failures) {
  const supported = new Map();
  const sampled = new Map();
  const failed = new Map();

  for (const route of routes || []) {
    const asset = routeAsset(route);
    const key = asset.ticker;
    const existing = supported.get(key);
    supported.set(key, {
      ticker: key,
      family: asset.family,
      icon: asset.icon,
      routeCount: (existing?.routeCount || 0) + 1,
    });
  }

  for (const quote of quotes || []) {
    if (!quote.route) continue;
    const asset = routeAsset(quote.route);
    const key = asset.ticker;
    const existing = sampled.get(key);
    sampled.set(key, {
      ticker: key,
      family: asset.family,
      icon: asset.icon,
      quoteCount: (existing?.quoteCount || 0) + 1,
      lastObservedAt: quote.observedAt,
    });
  }

  for (const failure of failures || []) {
    if (!failure.route) continue;
    const asset = routeAsset(failure.route);
    const key = asset.ticker;
    const existing = failed.get(key);
    failed.set(key, {
      ticker: key,
      failureCount: (existing?.failureCount || 0) + 1,
      lastObservedAt: failure.observedAt,
    });
  }

  const supportedAssets = [...supported.values()].sort((left, right) => right.routeCount - left.routeCount || left.ticker.localeCompare(right.ticker));
  const sampledAssets = [...sampled.values()].sort((left, right) => right.quoteCount - left.quoteCount || left.ticker.localeCompare(right.ticker));
  const failedAssets = [...failed.values()].sort((left, right) => right.failureCount - left.failureCount || left.ticker.localeCompare(right.ticker));
  const unsampledAssets = supportedAssets.filter((asset) => !sampled.has(asset.ticker));

  return {
    supportedAssetCount: supportedAssets.length,
    sampledAssetCount: sampledAssets.length,
    unsampledAssetCount: unsampledAssets.length,
    supportedAssets,
    sampledAssets,
    failedAssets,
    unsampledAssets,
  };
}

function buildBtcWatchlistSummary(routes = []) {
  const assetUniverse = classifyGatewayAssetUniverse(routes);
  const uniqueTickers = (items = []) => [...new Set(items.map((item) => item.ticker).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    observedCount: assetUniverse.observedBtcLikeAssets.length,
    observedTickers: uniqueTickers(assetUniverse.watchlistObserved),
    missingWatchCount: assetUniverse.watchlistMissing.length,
    missingTickers: uniqueTickers(assetUniverse.watchlistMissing),
    unknownAssetCount: assetUniverse.unknownAssets.length,
    watchlistObserved: assetUniverse.watchlistObserved.map((item) => ({
      ticker: item.ticker,
      chain: item.chain || null,
      status: item.status,
      source: item.source
        ? {
            label: item.source.label,
            url: item.source.url,
          }
        : null,
    })),
    watchlistMissing: assetUniverse.watchlistMissing.map((item) => ({
      ticker: item.ticker,
      chain: item.chain || null,
      status: item.status,
      source: item.source
        ? {
            label: item.source.label,
            url: item.source.url,
          }
        : null,
    })),
    unknownAssets: assetUniverse.unknownAssets.map((item) => ({
      chain: item.chain,
      token: item.token,
      ticker: item.ticker,
    })),
  };
}

function gatewaySummary({ latestRoutesRecord, latestUpdateSnapshot, latestUpdateAlert, updateAlerts, quotes, failures, now }) {
  const snapshot = latestUpdateSnapshot?.snapshot || null;
  const routes = latestRoutesRecord?.routes || [];
  const chains = snapshot?.chains || routeChains(routes);
  const routeCount = snapshot?.routeCount || latestRoutesRecord?.summary?.totalRoutes || routes.length || 0;
  const ethFamilyRouteCount =
    latestUpdateSnapshot?.ethFamily?.routeCount ??
    snapshot?.ethFamilyRouteCount ??
    routes.filter(isEthFamilyRoute).length;
  const probeOk = latestUpdateSnapshot?.probes?.filter((probe) => probe.ok).length || 0;
  const probeTotal = latestUpdateSnapshot?.probes?.length || 0;
  const probeFailures = latestUpdateSnapshot?.probeFailures || [];
  const flowRoutes = buildFlowRoutes(routes);

  return {
    observedAt: latestUpdateSnapshot?.observedAt || latestRoutesRecord?.observedAt || null,
    ageMinutes: minutesBetween(latestUpdateSnapshot?.observedAt || latestRoutesRecord?.observedAt, now),
    routeCount,
    chainCount: chains.length,
    chains,
    announcedChainCoverage: compareAnnouncedGatewayChains(chains),
    bobTouchingRouteCount: snapshot?.bobTouchingRouteKeys?.length || null,
    ethFamilyWatch: {
      routeCount: ethFamilyRouteCount,
      surfaceChanged: Boolean(latestUpdateSnapshot?.ethFamily?.surfaceChanged),
      addedRoutesCount: latestUpdateSnapshot?.diff?.addedEthFamilyRoutes?.length || 0,
      removedRoutesCount: latestUpdateSnapshot?.diff?.removedEthFamilyRoutes?.length || 0,
      chainPairs: latestUpdateSnapshot?.ethFamily?.chainPairs || snapshot?.ethFamilyChainPairs || [],
      addedChainPairs: latestUpdateSnapshot?.ethFamily?.addedChainPairs || [],
      removedChainPairs: latestUpdateSnapshot?.ethFamily?.removedChainPairs || [],
    },
    updateDetected: Boolean(latestUpdateSnapshot?.updateDetected),
    changeReasons: latestUpdateSnapshot?.changeReasons || [],
    routeHash: snapshot?.routeHash || null,
    chainPairs: latestRoutesRecord?.summary?.chainPairs || snapshot?.summary?.chainPairs || [],
    flowRoutes,
    recentFlowEvents: buildRecentFlowEvents(quotes || []),
    assetCoverage: buildAssetCoverage(routes, quotes || [], failures || []),
    btcWatchlist: buildBtcWatchlistSummary(routes),
    schemaHash: latestUpdateSnapshot?.schemaHash || null,
    probeHealthHash: latestUpdateSnapshot?.probeHealthHash || null,
    probeOk,
    probeTotal,
    probeFailures: probeFailures.map((failure) => ({
      routeKey: failure.routeKey,
      errorStatus: failure.errorStatus || null,
      errorCode: failure.errorCode || null,
      errorName: failure.errorName || null,
    })),
    recentAlertCount24h: countRecent(updateAlerts, now, 24),
    lastAlert: latestUpdateAlert
      ? {
          observedAt: latestUpdateAlert.observedAt,
          changeReasons: latestUpdateAlert.changeReasons || [],
          routeCount: latestUpdateAlert.routeCount || null,
          ethFamily: latestUpdateAlert.ethFamily || null,
          routeDiff: latestUpdateAlert.routeDiff || null,
          schemaDiff: latestUpdateAlert.schemaDiff || null,
          probeHealthDiff: latestUpdateAlert.probeHealthDiff || null,
          probeFailures: latestUpdateAlert.probeFailures || [],
        }
      : null,
  };
}

function gasSummary({ gasSnapshots, gasFailures, gatewayChains, now }) {
  const latestGasByChain = latestBy(gasSnapshots, (snapshot) => snapshot.chain);
  const expectedGatewayGasChains = gatewayChains.filter((chain) => chain !== "bitcoin").sort();
  const missingGatewayGasChains = expectedGatewayGasChains.filter((chain) => !latestGasByChain.has(chain));
  const chains = [...latestGasByChain.entries()]
    .map(([chain, snapshot]) => ({
      chain,
      observedAt: snapshot.observedAt,
      ageMinutes: minutesBetween(snapshot.observedAt, now),
      gasPriceWei: snapshot.gasPriceWei,
      blockNumber: snapshot.blockNumber,
      latencyMs: snapshot.latencyMs,
      fallbackGasUnits: snapshot.fallbackGasUnits,
      fallbackTxUsd: snapshot.fallbackTxUsd,
      nativeUsd: snapshot.nativeUsd,
    }))
    .sort((left, right) => left.chain.localeCompare(right.chain));
  const staleGatewayGasChains = chains.filter((item) => item.ageMinutes === null || item.ageMinutes > 30).map((item) => item.chain);

  return {
    latestChainCount: chains.length,
    expectedGatewayGasChains,
    missingGatewayGasChains,
    missingGatewayGasChainCount: missingGatewayGasChains.length,
    staleGatewayGasChains,
    staleChainCount30m: staleGatewayGasChains.length,
    recentFailureCount24h: countRecent(gasFailures, now, 24),
    chains,
    lastFailure: latest(gasFailures)
      ? {
          observedAt: latest(gasFailures).observedAt,
          chain: latest(gasFailures).chain,
          error: latest(gasFailures).error,
        }
      : null,
  };
}

function impliedDexWbtcUsd(quote) {
  if (!quote?.chain || !quote?.inputToken || !Number.isFinite(quote?.inputValueUsd)) return null;
  const asset = tokenAsset(quote.chain, quote.inputToken);
  if (asset.family !== "wrapped_btc" || !Number.isInteger(asset.decimals)) return null;
  const inputAmountDecimal = unitsToDecimal(quote.inputAmount, asset.decimals);
  if (!Number.isFinite(inputAmountDecimal) || inputAmountDecimal <= 0) return null;
  return Math.round((quote.inputValueUsd / inputAmountDecimal) * 100) / 100;
}

function isPositiveAmount(value) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function latestDexWbtcFailureByChain(dexFailures = []) {
  const latest = new Map();
  for (const failure of dexFailures) {
    if (!failure?.chain || !failure?.token) continue;
    if (tokenAsset(failure.chain, failure.token).family !== "wrapped_btc") continue;
    const existing = latest.get(failure.chain);
    if (!existing || new Date(failure.observedAt || 0) > new Date(existing.observedAt || 0)) {
      latest.set(failure.chain, failure);
    }
  }
  return latest;
}

function latestGatewayWrappedBtcLegByChain(quotes = []) {
  const latest = new Map();
  for (const quote of quotes) {
    const legs = [
      {
        chain: quote?.route?.srcChain,
        token: quote?.route?.srcToken,
        amount: quote?.inputAmount || quote?.amount,
        observedAt: quote?.observedAt || null,
      },
      {
        chain: quote?.route?.dstChain,
        token: quote?.route?.dstToken,
        amount: quote?.outputAmount || quote?.amount,
        observedAt: quote?.observedAt || null,
      },
    ];
    for (const leg of legs) {
      if (!leg.chain || !leg.token || !isPositiveAmount(leg.amount)) continue;
      if (tokenAsset(leg.chain, leg.token).family !== "wrapped_btc") continue;
      const existing = latest.get(leg.chain);
      if (!existing || new Date(leg.observedAt || 0) > new Date(existing.observedAt || 0)) {
        latest.set(leg.chain, {
          observedAt: leg.observedAt,
          token: leg.token,
        });
      }
    }
  }
  return latest;
}

function dexCoverageReason(chain, { dexPrice, latestFailureReason, sampledWrappedBtcLeg }) {
  if (chain === "bitcoin") return "btc_spot_reference";
  if (Number.isFinite(dexPrice?.usd)) return "dex_quote_observed";
  const support = canQuoteWithDex(chain, WBTC_OFT_TOKEN, STABLE_QUOTE_TOKENS[chain]);
  if (!support.ok) return support.reason;
  if (latestFailureReason) return latestFailureReason;
  if (sampledWrappedBtcLeg) return "eligible_quote_not_run";
  return "wrapped_btc_leg_not_sampled";
}

function latestDexWbtcPriceByChain(dexQuotes = []) {
  const latest = new Map();
  for (const quote of filterTrustedExecutableDexQuotes(dexQuotes)) {
    const impliedUsd = impliedDexWbtcUsd(quote);
    if (!Number.isFinite(impliedUsd)) continue;
    const existing = latest.get(quote.chain);
    if (!existing || new Date(quote.observedAt || 0) > new Date(existing.observedAt || 0)) {
      latest.set(quote.chain, {
        chain: quote.chain,
        ticker: "wBTC",
        usd: impliedUsd,
        observedAt: quote.observedAt || null,
        source: `${quote.provider || "dex"}:${quote.source || "quote"}`,
      });
    }
  }
  return latest;
}

function marketSummary({ priceSnapshots = [], gasSnapshots = [], bitcoinFeeSnapshots = [], dexQuotes = [], dexFailures = [], quotes = [], gatewayChains = [], now }) {
  const latestObservedPrices = latestPriceSnapshot(priceSnapshots);
  const basePrices = latestObservedPrices ? pricesFromSnapshot(latestObservedPrices) : emptyPricesUsd();
  const prices = overlayObservedPricesUsd(basePrices, {
    gasSnapshots,
    bitcoinFeeSnapshots,
  });
  const observedAt =
    latestObservedPrices?.observedAt ||
    latest(bitcoinFeeSnapshots)?.observedAt ||
    latest(gasSnapshots)?.observedAt ||
    null;
  const wbtcUsd = Number.isFinite(prices.tokenByKey?.wbtc) ? prices.tokenByKey.wbtc : Number.isFinite(prices.btc) ? prices.btc : null;
  const btcUsd = Number.isFinite(prices.btc) ? prices.btc : wbtcUsd;
  const dexWbtcByChain = latestDexWbtcPriceByChain(dexQuotes);
  const dexWbtcFailureByChain = latestDexWbtcFailureByChain(dexFailures);
  const latestWrappedBtcLegByChain = latestGatewayWrappedBtcLegByChain(quotes);
  const chainWbtcPrices = gatewayChains.map((chain) => {
    const dexPrice = dexWbtcByChain.get(chain) || null;
    const latestFailure = dexWbtcFailureByChain.get(chain) || null;
    const latestFailureReason = normalizeDexSupportReason(latestFailure?.reason, latestFailure?.chain || chain);
    const sampledWrappedBtcLeg = latestWrappedBtcLegByChain.get(chain) || null;
    const support = chain === "bitcoin" ? null : canQuoteWithDex(chain, WBTC_OFT_TOKEN, STABLE_QUOTE_TOKENS[chain]);
    const chainObservedAt = chain === "bitcoin" ? observedAt : dexPrice?.observedAt || null;
    const ageMinutes = minutesBetween(chainObservedAt, now);
    const usd = chain === "bitcoin" ? btcUsd : dexPrice?.usd ?? null;
    return {
      chain,
      ticker: chain === "bitcoin" ? "BTC" : "wBTC",
      usd,
      observedAt: chainObservedAt,
      ageMinutes,
      deltaPct: chain === "bitcoin" ? null : pctChange(btcUsd, usd),
      stale: Number.isFinite(ageMinutes) ? ageMinutes > CHAIN_PRICE_STALE_MINUTES : false,
      source: chain === "bitcoin" ? latestObservedPrices?.source || latest(bitcoinFeeSnapshots)?.source || "observed_overlay" : dexPrice?.source || null,
      quoteable: chain !== "bitcoin" && Boolean(support?.ok),
      coverageReason: dexCoverageReason(chain, { dexPrice, latestFailureReason, sampledWrappedBtcLeg }),
      coverageObservedAt: sampledWrappedBtcLeg?.observedAt || null,
      coverageFailure: latestFailureReason || null,
    };
  });
  const nonBitcoinChainPrices = chainWbtcPrices.filter((item) => item.chain !== "bitcoin");
  const observedChainCount = nonBitcoinChainPrices.filter((item) => Number.isFinite(item.usd)).length;
  const staleChainCount = nonBitcoinChainPrices.filter((item) => Number.isFinite(item.usd) && item.stale).length;
  const totalChainCount = nonBitcoinChainPrices.length;

  return {
    observedAt,
    ageMinutes: minutesBetween(observedAt, now),
    source: latestObservedPrices?.source || latest(bitcoinFeeSnapshots)?.source || "observed_overlay",
    btcUsd: Number.isFinite(btcUsd) ? btcUsd : null,
    wbtcUsd: Number.isFinite(wbtcUsd) ? wbtcUsd : null,
    chainPriceStaleMinutes: CHAIN_PRICE_STALE_MINUTES,
    observedChainCount,
    missingChainCount: Math.max(0, totalChainCount - observedChainCount),
    staleChainCount,
    chainWbtcPrices,
  };
}

function auditSummary(audit) {
  return {
    decision: audit.decision,
    shadow: audit.shadow,
    sampleSource: audit.sampleSource,
    firstObservedAt: audit.firstObservedAt,
    lastObservedAt: audit.lastObservedAt,
    shadowHours: audit.shadowHours,
    hourBuckets: audit.hourBuckets,
    targetShadowHours: audit.targetShadowHours,
    remainingShadowHours: audit.remainingShadowHours,
    targetHourBuckets: audit.targetHourBuckets,
    remainingHourBuckets: audit.remainingHourBuckets,
    earliestShadowWindowReadyAt: audit.earliestShadowWindowReadyAt,
    earliestHourBucketReadyAt: audit.earliestHourBucketReadyAt,
    earliestTimeGateReadyAt: audit.earliestTimeGateReadyAt,
    latencyP50Ms: audit.latencyP50Ms,
    latencyP95Ms: audit.latencyP95Ms,
    executionGasP50Usd: audit.executionGasP50Usd,
    executionGasP95Usd: audit.executionGasP95Usd,
    quoteDecayCoveredGroups: audit.quoteDecayCoveredGroups,
    quoteDecayWindows: audit.quoteDecayWindows,
    quotes: audit.quotes,
    activeQuotes: audit.activeQuotes,
    shadowObservations: audit.shadowObservations,
    failures: audit.failures,
    cloudflareFailures: audit.cloudflareFailures,
    sampledRoutes: audit.sampledRoutes,
    totalGatewayRoutes: audit.totalGatewayRoutes,
    sampledBobNeighborRoutes: audit.sampledBobNeighborRoutes,
    bobNeighborRoutes: audit.bobNeighborRoutes,
    checks: audit.checks,
    warnings: audit.warnings,
    blockers: audit.checks.filter((check) => !check.ok).map((check) => check.label),
    warningLabels: audit.warnings.filter((warning) => !warning.ok).map((warning) => warning.label),
    topSampledRoutes: audit.topSampledRoutes,
  };
}

function opportunitySummary(scoreSnapshot, now) {
  const scores = scoreSnapshot?.scores || [];
  const candidateCount = scoreSnapshot?.summary?.shadowCandidates ?? scores.filter((score) => score.tradeReadiness === "shadow_candidate_review_only").length;
  const rejectedNoEdge = scores.filter((score) => score.tradeReadiness === "reject_no_net_edge").length;
  const insufficientData = scoreSnapshot?.summary?.insufficientData ?? scores.filter((score) => score.tradeReadiness === "insufficient_data").length;
  const positiveInsufficient = [...scores]
    .filter((score) => score.tradeReadiness === "insufficient_data" && Number.isFinite(score.netEdgeUsd) && score.netEdgeUsd > 0)
    .sort((left, right) => right.netEdgeUsd - left.netEdgeUsd);
  const dataGaps = new Map();
  for (const score of scores) {
    for (const gap of score.dataGaps || []) {
      dataGaps.set(gap, (dataGaps.get(gap) || 0) + 1);
    }
  }
  const best = [...scores]
    .filter((score) => Number.isFinite(score.netEdgeUsd))
    .sort((left, right) => right.netEdgeUsd - left.netEdgeUsd)
    .at(0);

  return {
    generatedAt: scoreSnapshot?.generatedAt || null,
    ageMinutes: minutesBetween(scoreSnapshot?.generatedAt || null, now),
    stale: Number.isFinite(minutesBetween(scoreSnapshot?.generatedAt || null, now))
      ? minutesBetween(scoreSnapshot?.generatedAt || null, now) > DECISION_INPUT_STALE_MINUTES
      : true,
    scoredQuotes: scoreSnapshot?.scoredQuotes || scores.length,
    candidateCount,
    dexBacked: scoreSnapshot?.summary?.dexBacked ?? scores.filter((score) => score.dex).length,
    rejectedNoEdge,
    highFailureRate: scoreSnapshot?.summary?.highFailureRate ?? scores.filter((score) => (score.routeStats?.failureRate ?? 0) > 0.1).length,
    insufficientData,
    positiveInsufficientCount: positiveInsufficient.length,
    topPositiveInsufficientRoute: positiveInsufficient[0]
      ? {
          srcChain: positiveInsufficient[0].srcChain,
          dstChain: positiveInsufficient[0].dstChain,
          srcTicker: positiveInsufficient[0].srcAsset?.ticker || null,
          dstTicker: positiveInsufficient[0].dstAsset?.ticker || null,
          readiness: positiveInsufficient[0].tradeReadiness || null,
          netEdgeUsd: positiveInsufficient[0].netEdgeUsd ?? null,
          dataGaps: positiveInsufficient[0].dataGaps || [],
        }
      : null,
    bestNetEdgeUsd: best?.netEdgeUsd ?? null,
    bestRoute: best
      ? {
          srcChain: best.srcChain,
          dstChain: best.dstChain,
          srcTicker: best.srcAsset?.ticker || null,
          dstTicker: best.dstAsset?.ticker || null,
          readiness: best.tradeReadiness,
          dataGaps: best.dataGaps || [],
        }
      : null,
    dataGaps: [...dataGaps.entries()]
      .map(([gap, count]) => ({ gap, count }))
      .sort((left, right) => right.count - left.count || left.gap.localeCompare(right.gap)),
  };
}

function decisionInputsSummary({ scoreSnapshot = null, shadowCycle = null, quoteLagLatest = null, dexSpreadLatest = null, now }) {
  const score = freshnessStatus(scoreSnapshot?.generatedAt || null, now);
  const cycle = freshnessStatus(shadowCycle?.generatedAt || shadowCycle?.observedAt || null, now);
  const quoteLag = freshnessStatus(quoteLagLatest?.generatedAt || quoteLagLatest?.observedAt || null, now);
  const dexSpread = freshnessStatus(dexSpreadLatest?.generatedAt || dexSpreadLatest?.observedAt || null, now);
  const warnings = [];

  if (score.stale) warnings.push("stale_score_snapshot");
  if (cycle.stale) warnings.push("stale_shadow_cycle");

  const scoreVsCycleLagMinutes =
    Number.isFinite(score.ageMinutes) && Number.isFinite(cycle.ageMinutes)
      ? Math.abs(score.ageMinutes - cycle.ageMinutes)
      : null;
  if (Number.isFinite(scoreVsCycleLagMinutes) && scoreVsCycleLagMinutes > DECISION_INPUT_STALE_MINUTES) {
    warnings.push("score_shadow_cycle_age_skew");
  }

  return {
    staleAfterMinutes: DECISION_INPUT_STALE_MINUTES,
    scoreSnapshot: score,
    shadowCycle: cycle,
    quoteLag,
    dexSpread,
    scoreVsShadowCycleLagMinutes: scoreVsCycleLagMinutes,
    warnings,
  };
}

function thresholdItem(items = [], label) {
  return (items || []).find((item) => item.label === label) || null;
}

function researchSignalsSummary(thresholdSensitivity = null, now) {
  if (!thresholdSensitivity) return null;

  const effectiveCurrent = thresholdItem(thresholdSensitivity.gateway?.effectiveSystemSummary, "current");
  const executableCurrent = thresholdItem(thresholdSensitivity.gateway?.executableSummary, "current");
  const executableResearch = thresholdItem(thresholdSensitivity.gateway?.executableSummary, "looser_0.05usd_0.05pct");
  const triangleCurrent = thresholdItem(thresholdSensitivity.triangularArb, "current");
  const triangleResearch = thresholdItem(thresholdSensitivity.triangularArb, "looser_0.05usd_0.05pct");

  return {
    generatedAt: thresholdSensitivity.generatedAt || null,
    ageMinutes: minutesBetween(thresholdSensitivity.generatedAt || null, now),
    scoreObservedAt: thresholdSensitivity.scoreObservedAt || null,
    gateway: {
      effectiveCurrentPassCount: effectiveCurrent?.passCount ?? 0,
      effectiveCurrentNoMajorGapCount: effectiveCurrent?.passWithoutMajorGap ?? 0,
      executableCurrentPassCount: executableCurrent?.passCount ?? 0,
      executableCurrentNoMajorGapCount: executableCurrent?.passWithoutMajorGap ?? 0,
      executableResearchPassCount: executableResearch?.passCount ?? 0,
      executableResearchNoMajorGapCount: executableResearch?.passWithoutMajorGap ?? 0,
    },
    triangularArb: {
      currentPassCount: triangleCurrent?.passCount ?? 0,
      researchPassCount: triangleResearch?.passCount ?? 0,
      bestResearchNetPct: triangleResearch?.bestRoute?.netPct ?? null,
      bestResearchNetProfitUsd: triangleResearch?.bestRoute?.netProfitUsd ?? null,
    },
    researchThreshold: {
      minProfitUsd: 0.05,
      minProfitPct: 0.0005,
      label: "research_only",
    },
    livePolicyInterpretation: {
      liveReadySignal: (effectiveCurrent?.passCount || 0) > 0 && (effectiveCurrent?.passWithoutMajorGap || 0) > 0,
      researchOnlySignal:
        (triangleResearch?.passCount || 0) > 0 ||
        ((executableResearch?.passCount || 0) > 0 && (executableResearch?.passWithoutMajorGap || 0) === 0),
      note:
        "Research signals may justify more measurement, but they do not change canary or live policy until freshness and execution gaps are cleared.",
    },
    conclusions: thresholdSensitivity.conclusion || [],
  };
}

function bestStablecoinRoute(scoreSnapshot) {
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

function strategySummary({
  scoreSnapshot = null,
  shadowCycle = null,
  overall = null,
  shadowObservations = [],
  dexQuotes = [],
  quotes = [],
  failures = [],
  routes = [],
  routeRecords = [],
  routesObservedAt = null,
}) {
  const trustedDexQuotes = filterTrustedExecutableDexQuotes(dexQuotes);
  const bestStable = bestStablecoinRoute(scoreSnapshot);
  const btcProxySpreads = buildBtcProxySpreadSummary({ dexQuotes: trustedDexQuotes, routes, scoreSnapshot });
  const crossAssetArbitrage = buildCrossAssetArbitrageSummary(scoreSnapshot);
  const dexEnvironment = buildDexEnvironmentSummary({ dexQuotes: trustedDexQuotes });
  const dexRouteFocus = buildDexRouteFocusSummary({ routes, quotes, scoreSnapshot, dexQuotes: trustedDexQuotes });
  const dexGatewayArbitrage = buildDexGatewayArbitrageSummary({ scoreSnapshot, dexQuotes: trustedDexQuotes });
  const dexRouteUniverse = buildDexRouteUniverseSummary({ routes, observedAt: routesObservedAt });
  const edgeViability = buildEdgeViabilitySummary({ scoreSnapshot, dexQuotes: trustedDexQuotes });
  const edgeResearch = buildEdgeResearchSummary({ scoreSnapshot, shadowObservations });
  const noEdgePersistence = buildNoEdgePersistenceSummary({ scoreSnapshot, dexQuotes: trustedDexQuotes });
  const edgeViabilityVerdict = buildEdgeViabilityVerdict({ edgeViability, dexRouteFocus });
  const ethAnalysis = buildEthereumRouteAnalysis({
    routesRecord: routeRecords.at(-1) || (routes.length ? { observedAt: routesObservedAt, routes } : null),
    routeRecords,
    quotes,
    failures,
    dexQuotes: trustedDexQuotes,
    scores: scoreSnapshot?.scores || [],
    shadowObservations,
  });
  const ethProfitability = buildEthProfitabilitySummary(ethAnalysis);
  const topTradeReadiness = shadowCycle?.topRoute?.tradeReadiness || null;
  return {
    profitModel: "non_directional_edge_only",
    directionalBtcAccumulationCountsAsProfit: false,
    boundaryNote:
      "Long-term BTC appreciation may be a discretionary thesis, but it does not count as route profit or canary readiness.",
    manualCanaryReviewReady: topTradeReadiness === "shadow_candidate_review_only",
    liveExecutionBlocked: overall?.liveTrading !== "ALLOWED",
    pivotDecision: shadowCycle?.pivotDecision || null,
    crossAssetArbitrage,
    dexEnvironment,
    dexRouteFocus,
    dexGatewayArbitrage,
    dexRouteUniverse,
    edgeViability: {
      ...edgeViability,
      verdict: edgeViabilityVerdict,
    },
    edgeResearch,
    noEdgePersistence,
    btcProxySpreads,
    ethProfitability,
    objectivePlans: shadowCycle?.objectivePlans || null,
    strategyTracks: buildStrategyTracksSummary({
      shadowCycle,
      bestStablecoinRoute: bestStable,
      crossAssetArbitrage,
      btcProxySpreads,
      ethProfitability,
    }),
    bestStablecoinRoute: bestStable
      ? {
          routeKey: bestStable.routeKey,
          amount: bestStable.amount,
          srcChain: bestStable.srcChain,
          dstChain: bestStable.dstChain,
          srcTicker: bestStable.srcAsset?.ticker || null,
          dstTicker: bestStable.dstAsset?.ticker || null,
          tradeReadiness: bestStable.tradeReadiness || null,
          netEdgeUsd: bestStable.netEdgeUsd ?? null,
          executableNetEdgeUsd: bestStable.executableNetEdgeUsd ?? null,
          dataGaps: bestStable.dataGaps || [],
        }
      : null,
  };
}

function dexSummary({ dexQuotes = [], dexFailures = [], now }) {
  const trustedDexQuotes = filterTrustedExecutableDexQuotes(dexQuotes);
  const latestQuote = latest(trustedDexQuotes);
  const recentQuotes24h = countRecent(trustedDexQuotes, now, 24);
  const recentFailures24h = countRecent(dexFailures, now, 24);
  const quotedChains = [...new Set(trustedDexQuotes.map((quote) => quote.chain).filter(Boolean))].sort();
  const skippedReasons = new Map();
  for (const failure of dexFailures) {
    const reason = normalizeDexSupportReason(failure.reason, failure.chain) || "unknown";
    skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1);
  }

  return {
    provider: dexQuotes.at(-1)?.provider || dexFailures.at(-1)?.provider || "odos",
    quoteCount: trustedDexQuotes.length,
    rawQuoteCount: dexQuotes.length,
    failureCount: dexFailures.length,
    recentQuotes24h,
    recentFailures24h,
    quotedChains,
    latestQuote: latestQuote
      ? {
          observedAt: latestQuote.observedAt,
          chain: latestQuote.chain,
          inputValueUsd: latestQuote.inputValueUsd,
          outputValueUsd: latestQuote.outputValueUsd,
          gasEstimateValueUsd: latestQuote.gasEstimateValueUsd,
          priceImpactPct: latestQuote.priceImpactPct,
        }
      : null,
    skippedReasons: [...skippedReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

function bitcoinFeeSummary({ bitcoinFeeSnapshots = [], now }) {
  const snapshot = latest(bitcoinFeeSnapshots);
  return {
    latest: snapshot
      ? {
          observedAt: snapshot.observedAt,
          ageMinutes: minutesBetween(snapshot.observedAt, now),
          source: snapshot.source || null,
          feeRateSatVb: Number.isFinite(snapshot.selectedFeeRateSatVb) ? snapshot.selectedFeeRateSatVb : null,
          vbytes: Number.isFinite(snapshot.vbytes) ? snapshot.vbytes : null,
          estimatedFeeSats: Number.isFinite(snapshot.estimatedFeeSats) ? snapshot.estimatedFeeSats : null,
          estimatedFeeUsd: Number.isFinite(snapshot.estimatedFeeUsd) ? snapshot.estimatedFeeUsd : null,
          btcUsd: Number.isFinite(snapshot.btcUsd) ? snapshot.btcUsd : null,
          model: snapshot.model || null,
        }
      : null,
    snapshotCount: bitcoinFeeSnapshots.length,
  };
}

function executionGasSummary({ gatewayGasEstimates = [], gatewayGasEstimateFailures = [], now }) {
  const latestEstimate = latest(gatewayGasEstimates);
  const reasons = new Map();
  for (const failure of gatewayGasEstimateFailures) {
    const reason = failure.reason || "unknown";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  return {
    estimateCount: gatewayGasEstimates.length,
    failureCount: gatewayGasEstimateFailures.length,
    recentEstimateCount24h: countRecent(gatewayGasEstimates, now, 24),
    recentFailureCount24h: countRecent(gatewayGasEstimateFailures, now, 24),
    latestEstimate: latestEstimate
      ? {
          observedAt: latestEstimate.observedAt,
          ageMinutes: minutesBetween(latestEstimate.observedAt, now),
          srcChain: latestEstimate.srcChain,
          dstChain: latestEstimate.dstChain,
          gasUnits: latestEstimate.gasUnits,
          estimatedGasUsd: latestEstimate.estimatedGasUsd,
          source: latestEstimate.source,
        }
      : null,
    failureReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

function estimatorWalletSummary({ estimatorWalletReadiness = [], estimatorWalletReadinessFailures = [], now }) {
  const latestByRoute = latestBy(estimatorWalletReadiness, (item) => `${item.routeKey}|${item.amount}`);
  const latestChecks = [...latestByRoute.values()];
  const latestCheck = latest(latestChecks);
  const readinessFailures = new Map();
  for (const failure of estimatorWalletReadinessFailures) {
    const reason = failure.reason || "unknown";
    readinessFailures.set(reason, (readinessFailures.get(reason) || 0) + 1);
  }
  return {
    latestAddress: latestCheck?.address || latest(estimatorWalletReadinessFailures)?.address || null,
    routeCount: latestChecks.length,
    readyCount: latestChecks.filter((item) => item.overallReady).length,
    nativeBlockedCount: latestChecks.filter((item) => item.native && !item.native.ok).length,
    tokenBlockedCount: latestChecks.filter((item) => item.token && !item.token.ok).length,
    allowanceBlockedCount: latestChecks.filter((item) => item.allowance && !item.allowance.ok).length,
    recentFailureCount24h: countRecent(estimatorWalletReadinessFailures, now, 24),
    latestCheck: latestCheck
      ? {
          observedAt: latestCheck.observedAt,
          ageMinutes: minutesBetween(latestCheck.observedAt, now),
          srcChain: latestCheck.srcChain,
          dstChain: latestCheck.dstChain,
          overallReady: latestCheck.overallReady,
          nativeOk: latestCheck.native?.ok ?? null,
          tokenOk: latestCheck.token?.ok ?? null,
          allowanceOk: latestCheck.allowance?.ok ?? null,
        }
      : null,
    failureReasons: [...readinessFailures.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

function humanShadowCycleAuditIssue(issue) {
  return {
    configured_address_stale_vs_resolved_cycle_address: "기본 지갑 설정이 최신 운영 주소와 다름",
    explicit_address_differs_from_latest_inventory: "지정한 주소와 최신 운영 지갑이 다름",
    latest_inventory_and_wallet_readiness_addresses_differ: "지갑 준비 기록과 재고 주소가 다름",
    resolved_address_differs_from_latest_inventory: "현재 사이클 주소와 최신 재고 주소가 다름",
    resolved_address_differs_from_latest_wallet_readiness: "현재 사이클 주소와 준비 점검 주소가 다름",
    inventory_snapshot_missing: "지갑 재고 스냅샷이 없음",
    inventory_snapshot_address_mismatch: "지갑 재고 스냅샷 주소가 다름",
    inventory_summary_value_mismatch: "지갑 평가값과 보유 자산 합계가 다름",
  }[issue] || issue;
}

function humanTreasuryNeedActivation(code) {
  return {
    demand_active_now: "현재 수요 기준 보강 가능",
    awaiting_wallet_readiness_check: "지갑 준비 점검이 더 필요함",
    awaiting_wallet_readiness_retry: "지갑 준비 재점검이 필요함",
    awaiting_tx_payload: "실행 payload 확인이 더 필요함",
    awaiting_score_gap_clear: "점수 데이터 공백 해소가 필요함",
    awaiting_route_viability: "경로 적합성 확인이 더 필요함",
    no_candidate_route: "해당 체인 수요 후보가 아직 없음",
  }[code] || code;
}

function money(value) {
  if (!Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 100 ? 0 : abs >= 1 ? 2 : 6;
  return `${value < 0 ? "-" : ""}$${abs.toLocaleString("ko-KR", { maximumFractionDigits })}`;
}

function amountLabel(value) {
  if (value == null) return null;
  try {
    return `${BigInt(value).toLocaleString("ko-KR")} sats`;
  } catch {
    return String(value);
  }
}

function shortChainLabel(chain) {
  if (!chain) return null;
  return chain === "bob" ? "BOB" : chain === "bitcoin" ? "BTC" : chainMetaLabel(chain);
}

function chainMetaLabel(chain) {
  return {
    avalanche: "Avalanche",
    base: "Base",
    bera: "Berachain",
    bitcoin: "Bitcoin",
    bob: "BOB",
    bsc: "BNB",
    ethereum: "Ethereum",
    optimism: "Optimism",
    sei: "Sei",
    soneium: "Soneium",
    sonic: "Sonic",
    unichain: "Unichain",
  }[chain] || chain;
}

function humanTradeReadiness(code, netEdgeUsd) {
  if (!code) return { label: null, detail: null };
  if (code === "reject_no_net_edge") {
    return {
      label: "알려진 비용 반영 후 순이익이 아직 음수",
      detail: Number.isFinite(netEdgeUsd) ? `순엣지 ${money(netEdgeUsd)}` : "순엣지가 아직 음수",
    };
  }
  if (code === "shadow_candidate_review_only") {
    return {
      label: "수동 canary 검토 가능",
      detail: Number.isFinite(netEdgeUsd) ? `추정 순엣지 ${money(netEdgeUsd)}` : null,
    };
  }
  if (code === "insufficient_data") {
    return {
      label: "가격 또는 가스 데이터가 아직 부족함",
      detail: null,
    };
  }
  if (code === "observe_only_slow_settlement") {
    return {
      label: "정산 지연이 커서 아직 관찰 전용",
      detail: null,
    };
  }
  if (code === "reject_high_failure_rate") {
    return {
      label: "실패율이 높아 아직 진행 불가",
      detail: null,
    };
  }
  return {
    label: code,
    detail: Number.isFinite(netEdgeUsd) ? `순엣지 ${money(netEdgeUsd)}` : null,
  };
}

function humanShadowRosterRole(role) {
  return {
    active_canary: "현재 canary",
    prep_candidate: "대안 prep 후보",
    tx_ready_shadow: "payload 확보 shadow 후보",
    research_candidate: "연구 후보",
  }[role] || role;
}

function humanShadowAction(code) {
  return {
    capture_tx_payload: "route payload 확보",
    check_wallet_readiness: "지갑 준비 점검",
    refresh_exact_gas: "정확 가스 재측정",
    refresh_dex_and_score: "DEX 레그 갱신 후 재점수화",
    wait_for_fresh_inputs: "신선한 입력 대기",
    review_candidate: "수동 검토",
    rescore_candidate: "후보 재점수화",
  }[code] || code;
}

function humanExecutionStatus(status) {
  return {
    confirmed: "체결 확인",
    submitted: "제출됨",
    failed: "실패",
    pending_output: "출력 확인 중",
    planned: "예정",
    dry_run_planned: "드라이런",
  }[status] || status || "대기";
}

function pnlSummary({ opportunity = null, shadowCycle = null, receiptRecords = [] }) {
  const executionReview = shadowCycle?.objectivePlans?.executionReview || null;
  const receiptLedger = buildReceiptLedgerSummary(receiptRecords || []);
  const strategyRealized = receiptLedger.classifications?.strategy_realized_pnl || receiptLedger.summary;
  const executionEvidence = receiptLedger.classifications?.execution_evidence_cost || null;
  return {
    paper: {
      valueUsd: opportunity?.bestNetEdgeUsd ?? shadowCycle?.topRoute?.netEdgeUsd ?? null,
      label: "관측 기준",
      routeLabel: shadowCycle?.topRoute?.label || null,
      detail:
        shadowCycle?.topRoute?.tradeReadinessLabel ||
        (Number.isFinite(opportunity?.bestNetEdgeUsd) ? "현재 상위 관측 경로 기준" : "아직 관측 중"),
    },
    estimated: {
      valueUsd:
        executionReview?.executableNetUsd ??
        executionReview?.scoreNetUsd ??
        executionReview?.measuredNetUsd ??
        null,
      label: "검토 경로 기준",
      routeLabel: executionReview?.routeLabel || null,
      detail: executionReview?.nextActionLabel || executionReview?.tradeReadiness || "다음 실행 검토 대기",
    },
    realized: {
      valueUsd: strategyRealized.realizedNetPnlUsd ?? null,
      totalValueUsd: receiptLedger.summary.realizedNetPnlUsd ?? null,
      evidenceCostUsd: executionEvidence?.realizedNetPnlUsd ?? 0,
      label: executionEvidence ? "전략 receipt 기준" : "receipt 기준",
      tradeCount: strategyRealized.reconciledCount ?? 0,
      failedCount: strategyRealized.failedCount ?? 0,
      evidenceCount: executionEvidence?.reconciledCount ?? 0,
      breakdown: {
        strategyRealizedPnlUsd: strategyRealized.realizedNetPnlUsd ?? null,
        executionEvidenceCostUsd: executionEvidence?.realizedNetPnlUsd ?? 0,
        byClassification: Object.values(receiptLedger.classifications || {}),
        byKind: (receiptLedger.kinds || []).slice(0, 8),
      },
      detail:
        (receiptLedger.summary.recordCount || 0) > 0
          ? `전략 ${strategyRealized.reconciledCount || 0}건 · 탐사/수송 ${executionEvidence?.reconciledCount || 0}건`
          : "아직 receipt 기록 없음",
    },
  };
}

function tradeHistorySummary({ executionEvents = [], receiptRecords = [], preliveForkReceipts = [], now }) {
  const receiptByTxHash = new Map(
    (receiptRecords || [])
      .filter((item) => item?.txHash)
      .map((item) => [String(item.txHash).toLowerCase(), item]),
  );
  const forkItems = (preliveForkReceipts || []).map((item) => ({
    observedAt: item.observedAt || null,
    status: item.reconciliationStatus === "reconciled" ? "confirmed" : item.reconciliationStatus === "failed" ? "failed" : "pending_output",
    kind: "fork",
    chain: item.chain || null,
    txHash: item.txHash || null,
    routeLabel: item.routeLabel || item.routeKey || null,
    amount: item.amount || null,
    realizedNetPnlUsd: item.realized?.realizedNetPnlUsd ?? null,
    estimatedNetPnlUsd: item.routeContext?.estimatedNetPnlUsd ?? null,
  }));
  const eventItems = (executionEvents || []).map((event) => {
    const receipt = event.txHash ? receiptByTxHash.get(String(event.txHash).toLowerCase()) : null;
    return {
      observedAt: event.observedAt || null,
      status: event.status || null,
      kind: event.eventType || "execution",
      chain: event.chain || null,
      txHash: event.txHash || null,
      routeLabel: receipt?.routeContext?.routeKey || event.resourceKey || event.jobId || null,
      amount: receipt?.routeContext?.amount || null,
      realizedNetPnlUsd: event.realized?.realizedNetPnlUsd ?? receipt?.realized?.realizedNetPnlUsd ?? null,
      estimatedNetPnlUsd: receipt?.routeContext?.estimatedNetPnlUsd ?? null,
    };
  });
  const merged = [...forkItems, ...eventItems]
    .filter((item) => item.observedAt)
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))
    .slice(0, 6)
    .map((item, index) => ({
      id: `${item.txHash || item.kind || "event"}-${index}`,
      observedAt: item.observedAt,
      ageMinutes: minutesBetween(item.observedAt, now),
      status: item.status,
      statusLabel: humanExecutionStatus(item.status),
      chain: item.chain || null,
      chainLabel: chainMetaLabel(item.chain),
      kind: item.kind,
      routeLabel: item.routeLabel || null,
      amount: item.amount || null,
      txHash: item.txHash || null,
      txHashShort: item.txHash ? `${item.txHash.slice(0, 6)}…${item.txHash.slice(-4)}` : null,
      realizedNetPnlUsd: item.realizedNetPnlUsd ?? null,
      estimatedNetPnlUsd: item.estimatedNetPnlUsd ?? null,
    }));

  const latest = merged[0] || null;
  return {
    count: merged.length,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: latest?.status || null,
    items: merged,
  };
}

function buildManualMemos({ decisionInputs = null, shadowCycle = null, prelive = null, gateway = null }) {
  const memos = [];

  if (decisionInputs?.warnings?.length) {
    const staleParts = [];
    if (decisionInputs.warnings.includes("stale_score_snapshot")) staleParts.push("score");
    if (decisionInputs.warnings.includes("stale_shadow_cycle")) staleParts.push("shadow cycle");
    if (decisionInputs.warnings.includes("score_shadow_cycle_age_skew")) staleParts.push("판정 시점 차이");
    memos.push({
      id: "refresh_inputs",
      level: "now",
      title: "데이터 갱신 메모",
      whenLabel: "지금",
      summary: "판정에 쓰는 입력이 오래돼서 먼저 새로고침이 필요합니다.",
      detail: staleParts.length ? `${staleParts.join(" · ")} 확인 필요` : "판정 입력 다시 측정 필요",
      command: "npm run watch:canary-readiness",
      prompt: "현재 stale input만 갱신하고 dashboard 상태를 다시 만들어줘.",
    });
  }

  if (gateway?.ethFamilyWatch?.surfaceChanged) {
    const addedPairs = gateway.ethFamilyWatch.addedChainPairs || [];
    const pairLabel = (addedPairs.length ? addedPairs : gateway.ethFamilyWatch.chainPairs || []).slice(0, 2).join(" · ");
    memos.push({
      id: "eth_family_surface",
      level: "now",
      title: "ETH 경로 관측 메모",
      whenLabel: "지금",
      summary: pairLabel ? `새 ETH 경로 ${pairLabel}` : "새 ETH family 경로 관측",
      detail: "새 경로가 보여도 바로 실행하지 말고 route 스캔과 ETH 전용 감사부터 다시 갱신합니다.",
      command: "npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard",
      prompt: "새 ETH-family route surface를 다시 확인하고 analyze/audit 결과와 blocker만 짧게 정리해줘.",
    });
  }

  const executionReview = shadowCycle?.objectivePlans?.executionReview || null;
  if (executionReview) {
    const blockerText = executionReview.blockerLabels?.length
      ? executionReview.blockerLabels.slice(0, 2).join(" · ")
      : executionReview.nextActionLabel || executionReview.tradeReadiness || "다음 단계 점검";
    const whenLabel = executionReview.blockers?.some((item) => ["native", "token", "allowance"].includes(item))
      ? "자금 준비 후"
      : decisionInputs?.warnings?.length
        ? "데이터 갱신 뒤"
        : "다음 수동 점검 때";
    memos.push({
      id: "execution_review",
      level: "next",
      title: "수동 재검증 메모",
      whenLabel,
      summary: executionReview.routeLabel
        ? `${executionReview.routeLabel}${executionReview.amount ? ` · ${amountLabel(executionReview.amount)}` : ""}`
        : "Measured leader 다시 확인",
      detail: blockerText,
      command: executionReview.command || "npm run run:execution-review -- --execute --write --continue-on-error",
      prompt: executionReview.routeLabel
        ? `현재 measured leader ${executionReview.routeLabel}를 다시 점검하고 blocker와 다음 액션만 정리해줘.`
        : "현재 measured leader를 다시 점검하고 blocker와 다음 액션만 정리해줘.",
    });
  }

  const treasury = shadowCycle?.treasury || null;
  const nextNeed = treasury?.nextNeeds?.[0] || null;
  if (treasury && (treasury.decision === "BLOCKED" || nextNeed)) {
    const refillAmountLabel =
      Number.isFinite(nextNeed?.refillAmountDecimal) && nextNeed?.ticker
        ? `${nextNeed.refillAmountDecimal.toLocaleString("ko-KR", { maximumFractionDigits: 6 })} ${nextNeed.ticker}`
        : null;
    const refillCostLabel = Number.isFinite(nextNeed?.refillEstimatedUsd) ? money(nextNeed.refillEstimatedUsd) : null;
    const walletShortfallLabel = Number.isFinite(treasury.walletValueShortfallUsd) ? money(treasury.walletValueShortfallUsd) : null;
    memos.push({
      id: "treasury_check",
      level: "later",
      title: "가스 준비 메모",
      whenLabel: walletShortfallLabel ? "수동 충전 전" : "다음 준비 때",
      summary: nextNeed?.chain && nextNeed?.ticker
        ? `${nextNeed.chain} ${nextNeed.ticker} 준비 상태 확인`
        : "지갑 준비 상태 다시 확인",
      detail:
        [
          refillAmountLabel,
          refillCostLabel ? `예상 ${refillCostLabel}` : null,
          walletShortfallLabel ? `지갑 기준 부족 ${walletShortfallLabel}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "다음 refill 필요 금액 확인",
      command: "npm run plan:treasury-actions -- --json",
      prompt: "현재 treasury blocker와 다음 refill 필요 금액만 짧게 정리해줘.",
    });
  }

  if (!memos.length && prelive?.evidenceCampaign?.nextAction) {
    memos.push({
      id: "prelive_next_action",
      level: "next",
      title: "다음 검증 메모",
      whenLabel: "다음 검토 때",
      summary: prelive.evidenceCampaign.nextAction.label || "다음 prelive 단계 확인",
      detail: prelive.evidenceCampaign.latestStatus || "현재 검증 상태 점검",
      command: "npm run status:dashboard",
      prompt: "현재 prelive 다음 단계와 막힌 이유만 짧게 정리해줘.",
    });
  }

  return memos.slice(0, 3);
}

function shadowCycleSummary(shadowCycle, now, { readinessRecords = [], readinessFailures = [] } = {}) {
  if (!shadowCycle) return null;
  const refreshBatch = buildShadowRefreshBatchSummary(shadowCycle.refreshBatches || [], now);
  const refreshExecution = buildShadowRefreshExecutionSummary(shadowCycle.refreshExecutions || [], now);
  const refreshedQueue = buildShadowRefreshQueue({
    shadowCycle,
    readinessRecords,
    readinessFailures,
    now,
    limit: 8,
  });
  const topRouteTradeReadiness = humanTradeReadiness(shadowCycle.topRoute?.tradeReadiness || null, shadowCycle.topRoute?.netEdgeUsd);

  return {
    observedAt: shadowCycle.observedAt || null,
    ageMinutes: minutesBetween(shadowCycle.observedAt, now),
    mode: shadowCycle.mode || null,
    headline: shadowCycle.headline || null,
    blockerCount: shadowCycle.blockers?.length || 0,
    canaryDecision: shadowCycle.canary?.decision || null,
    canary: shadowCycle.canary
      ? {
          decision: shadowCycle.canary.decision || null,
          nextReadinessCheck: shadowCycle.canary.nextReadinessCheck
            ? {
                label: shadowCycle.canary.nextReadinessCheck.label || null,
                amount: shadowCycle.canary.nextReadinessCheck.amount || null,
                srcChain: shadowCycle.canary.nextReadinessCheck.srcChain || null,
                srcTicker: shadowCycle.canary.nextReadinessCheck.srcTicker || null,
                dstChain: shadowCycle.canary.nextReadinessCheck.dstChain || null,
                dstTicker: shadowCycle.canary.nextReadinessCheck.dstTicker || null,
              }
            : null,
          nextReadinessRefresh: shadowCycle.canary.nextReadinessRefresh
            ? {
                state: shadowCycle.canary.nextReadinessRefresh.state || null,
                reason: shadowCycle.canary.nextReadinessRefresh.reason || null,
                latestObservedAt: shadowCycle.canary.nextReadinessRefresh.latestObservedAt || null,
                ageSeconds: shadowCycle.canary.nextReadinessRefresh.ageSeconds ?? null,
                maxAgeSeconds: shadowCycle.canary.nextReadinessRefresh.maxAgeSeconds ?? null,
              }
            : null,
          readinessCheckCount: shadowCycle.canary.readinessCheckCount ?? 0,
        }
      : null,
    topRoute: shadowCycle.topRoute
      ? {
          label: shadowCycle.topRoute.label || null,
          amount: shadowCycle.topRoute.amount || null,
          tradeReadiness: shadowCycle.topRoute.tradeReadiness || null,
          tradeReadinessLabel: topRouteTradeReadiness.label,
          tradeReadinessDetail: topRouteTradeReadiness.detail,
          netEdgeUsd: shadowCycle.topRoute.netEdgeUsd ?? null,
        }
      : null,
    shadowRoster: {
      candidateCount: shadowCycle.shadowRoster?.candidateCount ?? 0,
      viableCount: shadowCycle.shadowRoster?.viableCount ?? 0,
      txReadyCount: shadowCycle.shadowRoster?.txReadyCount ?? 0,
      candidates: (shadowCycle.shadowRoster?.candidates || []).map((item) => {
        const readiness = humanTradeReadiness(item.tradeReadiness || null, item.netEdgeUsd);
        return {
          role: item.role || null,
          roleLabel: humanShadowRosterRole(item.role || null),
          label: item.label || null,
          amount: item.amount || null,
          srcChain: item.srcChain || null,
          dstChain: item.dstChain || null,
          viableForPrep: Boolean(item.viableForPrep),
          txReady: Boolean(item.txReady),
          tradeReadiness: item.tradeReadiness || null,
          tradeReadinessLabel: readiness.label,
          tradeReadinessDetail: readiness.detail,
          prepFundingUsd: item.prepFundingUsd ?? null,
          netEdgeUsd: item.netEdgeUsd ?? null,
          prepBlockers: item.prepBlockers || [],
          scoreDisqualifiers: item.scoreDisqualifiers || [],
          readinessFailureReason: item.readinessFailureReason || null,
          shadowPriorityScore: item.shadowPriorityScore ?? null,
          shadowPriorityReason: item.shadowPriorityReason || null,
          evidence: item.evidence
            ? {
                quoteSampleCount: item.evidence.quoteSampleCount ?? 0,
                quoteFailureCount: item.evidence.quoteFailureCount ?? 0,
                quoteAttemptCount: item.evidence.quoteAttemptCount ?? 0,
                quoteSuccessRate: item.evidence.quoteSuccessRate ?? null,
                quoteLatencyP50Ms: item.evidence.quoteLatencyP50Ms ?? null,
                quoteLatencyP95Ms: item.evidence.quoteLatencyP95Ms ?? null,
                shadowObservationCount: item.evidence.shadowObservationCount ?? 0,
                latestQuoteObservedAt: item.evidence.latestQuoteObservedAt || null,
                latestFailureObservedAt: item.evidence.latestFailureObservedAt || null,
                latestObservationObservedAt: item.evidence.latestObservationObservedAt || null,
                latestObservedEdgeUsd: item.evidence.latestObservedEdgeUsd ?? null,
                latestKnownCostUsd: item.evidence.latestKnownCostUsd ?? null,
                latestExecutionGasUsd: item.evidence.latestExecutionGasUsd ?? null,
                latestRouteFailureRate: item.evidence.latestRouteFailureRate ?? null,
                latestTradeReadiness: item.evidence.latestTradeReadiness || null,
                rejectionReasons: item.evidence.rejectionReasons || [],
              }
            : null,
        };
      }),
    },
    strategyPlans: shadowCycle.strategyPlans
      ? {
          stableLoop: shadowCycle.strategyPlans.stableLoop || null,
          proxySpread: shadowCycle.strategyPlans.proxySpread || null,
        }
      : null,
    objectivePlans: shadowCycle.objectivePlans
      ? {
          executionReview: shadowCycle.objectivePlans.executionReview
            ? {
                status: shadowCycle.objectivePlans.executionReview.status || null,
                selectionCode: shadowCycle.objectivePlans.executionReview.selectionCode || null,
                selectionLabel: shadowCycle.objectivePlans.executionReview.selectionLabel || null,
                routeKey: shadowCycle.objectivePlans.executionReview.routeKey || null,
                routeLabel: shadowCycle.objectivePlans.executionReview.label || null,
                amount: shadowCycle.objectivePlans.executionReview.amount || null,
                tradeReadiness: shadowCycle.objectivePlans.executionReview.tradeReadiness || null,
                measuredNetUsd: shadowCycle.objectivePlans.executionReview.measuredNetUsd ?? null,
                scoreNetUsd: shadowCycle.objectivePlans.executionReview.scoreNetUsd ?? null,
                executableNetUsd: shadowCycle.objectivePlans.executionReview.executableNetUsd ?? null,
                blockers: shadowCycle.objectivePlans.executionReview.blockers || [],
                blockerLabels: shadowCycle.objectivePlans.executionReview.blockerLabels || [],
                reasonLabels: shadowCycle.objectivePlans.executionReview.reasonLabels || [],
                nextActionCode: shadowCycle.objectivePlans.executionReview.nextActionCode || null,
                nextActionLabel: shadowCycle.objectivePlans.executionReview.nextActionLabel || null,
                command: shadowCycle.objectivePlans.executionReview.command || null,
                stepCount: shadowCycle.objectivePlans.executionReview.stepCount ?? 0,
                steps: shadowCycle.objectivePlans.executionReview.steps || [],
                hypothesisGuard: shadowCycle.objectivePlans.executionReview.hypothesisGuard || null,
              }
            : null,
          discovery: shadowCycle.objectivePlans.discovery
            ? {
                source: shadowCycle.objectivePlans.discovery.source || null,
                sourceLabel: shadowCycle.objectivePlans.discovery.sourceLabel || null,
                status: shadowCycle.objectivePlans.discovery.status || null,
                selectionCode: shadowCycle.objectivePlans.discovery.selectionCode || null,
                selectionLabel: shadowCycle.objectivePlans.discovery.selectionLabel || null,
                routeKey: shadowCycle.objectivePlans.discovery.routeKey || null,
                routeLabel: shadowCycle.objectivePlans.discovery.label || null,
                amount: shadowCycle.objectivePlans.discovery.amount || null,
                classification: shadowCycle.objectivePlans.discovery.classification || null,
                measuredNetUsd: shadowCycle.objectivePlans.discovery.measuredNetUsd ?? null,
                gapToPolicyUsd: shadowCycle.objectivePlans.discovery.gapToPolicyUsd ?? null,
                requiredNetProfitUsd: shadowCycle.objectivePlans.discovery.requiredNetProfitUsd ?? null,
                bestNetEdgeUsd: shadowCycle.objectivePlans.discovery.bestNetEdgeUsd ?? null,
                profitableLevels: shadowCycle.objectivePlans.discovery.profitableLevels ?? null,
                amountLevels: shadowCycle.objectivePlans.discovery.amountLevels ?? null,
                nextActionCode: shadowCycle.objectivePlans.discovery.nextActionCode || null,
                nextActionLabel: shadowCycle.objectivePlans.discovery.nextActionLabel || null,
                reason: shadowCycle.objectivePlans.discovery.reason || null,
                command: shadowCycle.objectivePlans.discovery.command || null,
                stepCount: shadowCycle.objectivePlans.discovery.stepCount ?? 0,
                steps: shadowCycle.objectivePlans.discovery.steps || [],
              }
            : null,
        }
      : null,
    pivotDecision: shadowCycle.pivotDecision
      ? {
          decisionCode: shadowCycle.pivotDecision.decisionCode || null,
          decisionLabel: shadowCycle.pivotDecision.decisionLabel || null,
          status: shadowCycle.pivotDecision.status || null,
          focusRouteKey: shadowCycle.pivotDecision.focusRouteKey || null,
          focusRouteLabel: shadowCycle.pivotDecision.focusRouteLabel || null,
          focusAmount: shadowCycle.pivotDecision.focusAmount || null,
          nextActionCode: shadowCycle.pivotDecision.nextActionCode || null,
          nextActionLabel: shadowCycle.pivotDecision.nextActionLabel || null,
          command: shadowCycle.pivotDecision.command || null,
          currentCanaryVerdict: shadowCycle.pivotDecision.currentCanaryVerdict || null,
          currentCanaryReasonCode: shadowCycle.pivotDecision.currentCanaryReasonCode || null,
          measuredLeaderVerdict: shadowCycle.pivotDecision.measuredLeaderVerdict || null,
          measuredLeaderReasonCode: shadowCycle.pivotDecision.measuredLeaderReasonCode || null,
          candidateCounts: shadowCycle.pivotDecision.candidateCounts || null,
          familyCounts: shadowCycle.pivotDecision.familyCounts || null,
          evidenceCounts: shadowCycle.pivotDecision.evidenceCounts || null,
        }
      : null,
    refreshQueue: refreshedQueue.map((item) => ({
      rank: item.rank ?? null,
      priority: item.priority ?? null,
      kind: item.kind || null,
      scope: item.scope || null,
      code: item.code || null,
      label: item.label || null,
      reason: item.reason || null,
      command: item.command || null,
      routeKey: item.routeKey || null,
      routeLabel: item.routeLabel || null,
      amount: item.amount || null,
      routeKeys: item.routeKeys || [],
      chains: item.chains || [],
      proxyGroup: item.proxyGroup || null,
      status: item.status || null,
      selectionCode: item.selectionCode || null,
      source: item.source || null,
    })),
    refreshExecution: {
      runCount: refreshExecution.runCount,
      successCount: refreshExecution.successCount,
      failureCount: refreshExecution.failureCount,
      previewCount: refreshExecution.previewCount,
      invalidCount: refreshExecution.invalidCount,
      latestObservedAt: refreshExecution.latestObservedAt,
      latestStatus: refreshExecution.latestStatus,
      recentExecutions: refreshExecution.recentExecutions,
    },
    refreshBatch: {
      runCount: refreshBatch.runCount,
      successCount: refreshBatch.successCount,
      failureCount: refreshBatch.failureCount,
      blockedCount: refreshBatch.blockedCount,
      invalidCount: refreshBatch.invalidCount,
      latestObservedAt: refreshBatch.latestObservedAt,
      latestStatus: refreshBatch.latestStatus,
      latestMode: refreshBatch.latestMode,
      latestStopReason: refreshBatch.latestStopReason,
      latestFailureCategory: refreshBatch.latestFailureCategory,
      latestFailureRouteLabel: refreshBatch.latestFailureRouteLabel,
      recentFailureObservedAt: refreshBatch.recentFailureObservedAt,
      recentFailureCategory: refreshBatch.recentFailureCategory,
      recentFailureRouteLabel: refreshBatch.recentFailureRouteLabel,
      recentFailureTransient: refreshBatch.recentFailureTransient,
      recentBatches: refreshBatch.recentBatches,
    },
    shadowActions: (shadowCycle.shadowActions || []).map((item) => ({
      role: item.role || null,
      roleLabel: humanShadowRosterRole(item.role || null),
      label: item.label || null,
      amount: item.amount || null,
      code: item.code || null,
      actionLabel: humanShadowAction(item.code || null),
      reason: item.reason || null,
      command: item.command || null,
    })),
    treasury: shadowCycle.treasury
      ? {
          decision: shadowCycle.treasury.decision || null,
          estimatedWalletUsd: shadowCycle.treasury.estimatedWalletUsd ?? null,
          walletValueFloorUsd: shadowCycle.treasury.walletValueFloorUsd ?? null,
          walletValueShortfallUsd: shadowCycle.treasury.walletValueShortfallUsd ?? null,
          noDemandBlockerCount: shadowCycle.treasury.noDemandBlockerCount ?? 0,
          nextNeeds: (shadowCycle.treasury.nextNeeds || []).map((item) => ({
            state: item.state || null,
            chain: item.chain || null,
            ticker: item.ticker || null,
            refillAmountDecimal: item.refillAmountDecimal ?? null,
            refillEstimatedUsd: item.refillEstimatedUsd ?? null,
            activation: item.activation
              ? {
                  code: item.activation.code || null,
                  label: humanTreasuryNeedActivation(item.activation.code),
                  routeLabel: item.activation.routeLabel || null,
                  candidateCount: item.activation.candidateCount ?? 0,
                }
              : null,
          })),
        }
      : null,
    audit: {
      addressConsistent: shadowCycle.audit?.address?.consistent ?? null,
      inventoryConsistent: shadowCycle.audit?.inventory?.consistent ?? null,
      issueCount:
        (shadowCycle.audit?.address?.issues?.length || 0) + (shadowCycle.audit?.inventory?.issues?.length || 0),
      issues: [
        ...(shadowCycle.audit?.address?.issues || []),
        ...(shadowCycle.audit?.inventory?.issues || []),
      ].map((issue) => ({
        code: issue,
        label: humanShadowCycleAuditIssue(issue),
      })),
    },
  };
}

function advanceCanarySummary(advanceCanary, now) {
  if (!advanceCanary) return null;
  return {
    observedAt: advanceCanary.observedAt || null,
    ageMinutes: minutesBetween(advanceCanary.observedAt, now),
    address: advanceCanary.address || null,
    actionCount: advanceCanary.actionCount ?? (advanceCanary.actions?.length || 0),
    actions: advanceCanary.actions || [],
    initial: advanceCanary.initial
      ? {
          decision: advanceCanary.initial.decision || null,
          headline: advanceCanary.initial.headline || null,
          routeLabel: advanceCanary.initial.routeLabel || null,
          routeKey: advanceCanary.initial.routeKey || null,
          amount: advanceCanary.initial.amount || null,
          reasons: advanceCanary.initial.reasons || [],
        }
      : null,
    afterWalletCheck: advanceCanary.afterWalletCheck
      ? {
          decision: advanceCanary.afterWalletCheck.decision || null,
          headline: advanceCanary.afterWalletCheck.headline || null,
          routeLabel: advanceCanary.afterWalletCheck.routeLabel || null,
          routeKey: advanceCanary.afterWalletCheck.routeKey || null,
          amount: advanceCanary.afterWalletCheck.amount || null,
          reasons: advanceCanary.afterWalletCheck.reasons || [],
        }
      : null,
    final: advanceCanary.final
      ? {
          decision: advanceCanary.final.decision || null,
          headline: advanceCanary.final.headline || null,
          routeLabel: advanceCanary.final.routeLabel || null,
          routeKey: advanceCanary.final.routeKey || null,
          amount: advanceCanary.final.amount || null,
          reasons: advanceCanary.final.reasons || [],
        }
      : null,
  };
}

function decideOverall({ audit, gateway, gas, decisionInputs = null }) {
  const blockers = [];
  const warnings = [];
  if (audit.decision !== "LIVE_CANARY_REVIEW_POSSIBLE") blockers.push("audit_blocks_live");
  if (gateway.updateDetected) blockers.push("gateway_update_pending_review");
  if (gateway.probeFailures.length > 0) blockers.push("gateway_probe_failures");
  if (gas.missingGatewayGasChainCount > 0) blockers.push("missing_gateway_gas_snapshots");
  if (gas.staleChainCount30m > 0) blockers.push("stale_gas_snapshots");
  if (decisionInputs?.warnings?.includes("stale_score_snapshot")) warnings.push("stale_score_snapshot");
  if (decisionInputs?.warnings?.includes("stale_shadow_cycle")) warnings.push("stale_shadow_cycle");
  if (decisionInputs?.warnings?.includes("score_shadow_cycle_age_skew")) warnings.push("decision_input_age_skew");

  return {
    severity: blockers.length > 0 ? "blocked" : "review",
    liveTrading: blockers.length > 0 ? "BLOCKED" : "ALLOWED",
    shadowTrading: audit.shadow,
    blockers,
    warnings,
    decisionConfidence: warnings.length > 0 ? "low" : "normal",
    riskBudgetUsd: RISK_BUDGET_USD,
    lossLimitUsd: RISK_BUDGET_USD,
    capitalRule: "Capital sizing is per-strategy. Each live strategy declares its own per-trade and daily caps; there is no project-wide ring-fence.",
  };
}

export function buildDashboardStatus(input, options = {}) {
  const now = options.now || new Date().toISOString();
  const audit = buildOverfitAudit(
    {
      routesRecords: input.routesRecords || [],
      quotes: input.quotes || [],
      failures: input.failures || [],
      gasSnapshots: input.gasSnapshots || [],
      gasFailures: input.gasFailures || [],
      shadowObservations: input.shadowObservations || [],
      now,
    },
    options.auditTargets,
  );
  const latestRoutesRecord = latest(input.routesRecords || []);
  const latestUpdateSnapshot = latest(input.updateSnapshots || []);
  const latestUpdateAlert = latest(input.updateAlerts || []);
  const gateway = gatewaySummary({
    latestRoutesRecord,
    latestUpdateSnapshot,
    latestUpdateAlert,
    updateAlerts: input.updateAlerts || [],
    quotes: input.quotes || [],
    failures: input.failures || [],
    now,
  });
  const gas = gasSummary({
    gasSnapshots: input.gasSnapshots || [],
    gasFailures: input.gasFailures || [],
    gatewayChains: gateway.chains,
    now,
  });
  const market = marketSummary({
    priceSnapshots: input.priceSnapshots || [],
    gasSnapshots: input.gasSnapshots || [],
    bitcoinFeeSnapshots: input.bitcoinFeeSnapshots || [],
    dexQuotes: input.dexQuotes || [],
    dexFailures: input.dexFailures || [],
    quotes: input.quotes || [],
    gatewayChains: gateway.chains,
    now,
  });
  const auditStatus = auditSummary(audit);
  const decisionInputs = decisionInputsSummary({
    scoreSnapshot: input.scoreSnapshot || null,
    shadowCycle: input.shadowCycle || null,
    quoteLagLatest: input.quoteLagLatest || null,
    dexSpreadLatest: input.dexSpreadLatest || null,
    now,
  });
  const overall = decideOverall({ audit: auditStatus, gateway, gas, decisionInputs });
  const opportunity = opportunitySummary(input.scoreSnapshot || null, now);
  const dex = dexSummary({ dexQuotes: input.dexQuotes || [], dexFailures: input.dexFailures || [], now });
  const bitcoinFee = bitcoinFeeSummary({ bitcoinFeeSnapshots: input.bitcoinFeeSnapshots || [], now });
  const executionGas = executionGasSummary({
    gatewayGasEstimates: input.gatewayGasEstimates || [],
    gatewayGasEstimateFailures: input.gatewayGasEstimateFailures || [],
    now,
  });
  const estimatorWallet = estimatorWalletSummary({
    estimatorWalletReadiness: input.estimatorWalletReadiness || [],
    estimatorWalletReadinessFailures: input.estimatorWalletReadinessFailures || [],
    now,
  });
  const shadowCycle = shadowCycleSummary(
    input.shadowCycle
      ? {
          ...input.shadowCycle,
          refreshExecutions: input.shadowRefreshExecutions || [],
          refreshBatches: input.shadowRefreshBatches || [],
        }
      : null,
    now,
    {
      readinessRecords: input.estimatorWalletReadiness || [],
      readinessFailures: input.estimatorWalletReadinessFailures || [],
    },
  );
  const canaryAdvance = advanceCanarySummary(input.advanceCanary || null, now);
  const strategyBase = strategySummary({
    scoreSnapshot: input.scoreSnapshot || null,
    shadowCycle,
    overall,
    shadowObservations: input.shadowObservations || [],
    dexQuotes: input.dexQuotes || [],
    quotes: input.quotes || [],
    failures: input.failures || [],
    routes: latestRoutesRecord?.routes || [],
    routeRecords: input.routesRecords || [],
    routesObservedAt: latestRoutesRecord?.observedAt || null,
  });
  const preliveBase = buildPreliveReadinessSummary({
    overall,
    audit: auditStatus,
    shadowCycle,
    strategy: strategyBase,
    simulationRuns: input.preliveSimulationRuns || [],
    walletReadinessRecords: input.estimatorWalletReadiness || [],
    forkExecutionPlans: input.preliveForkPlan?.plans || [],
    forkExecutionSubmissions: input.preliveForkSubmissions || [],
    forkExecutionReceipts: input.preliveForkReceipts || [],
    executionEvents: input.executionEvents || [],
  });
  const evidenceCampaign = buildPreliveEvidenceCampaignSummary(input.preliveEvidenceCampaigns || [], now);
  const connectedRefreshExecution = buildConnectedRefreshExecutionSummary(input.connectedRefreshRuns || [], now);
  const currentRoutePrelivePass = buildCurrentRoutePrelivePassSummary(input.currentRoutePrelivePasses || [], now);
  const prelive = {
    ...preliveBase,
    connectedRefreshExecution: {
      runCount: connectedRefreshExecution.runCount,
      previewCount: connectedRefreshExecution.previewCount,
      successCount: connectedRefreshExecution.successCount,
      partialCount: connectedRefreshExecution.partialCount,
      noopCount: connectedRefreshExecution.noopCount,
      failureCount: connectedRefreshExecution.failureCount,
      latestObservedAt: connectedRefreshExecution.latestObservedAt,
      latestStatus: connectedRefreshExecution.latestStatus,
      latestMode: connectedRefreshExecution.latestMode,
      latestStopReason: connectedRefreshExecution.latestStopReason,
      nextAction: connectedRefreshExecution.nextAction,
      remainingRefreshCount: connectedRefreshExecution.remainingRefreshCount,
      recentRuns: connectedRefreshExecution.recentRuns,
    },
    currentRoutePrelivePass: {
      runCount: currentRoutePrelivePass.runCount,
      previewCount: currentRoutePrelivePass.previewCount,
      readyForSignerCount: currentRoutePrelivePass.readyForSignerCount,
      provenCount: currentRoutePrelivePass.provenCount,
      blockedCount: currentRoutePrelivePass.blockedCount,
      partialCount: currentRoutePrelivePass.partialCount,
      failureCount: currentRoutePrelivePass.failureCount,
      latestObservedAt: currentRoutePrelivePass.latestObservedAt,
      latestStatus: currentRoutePrelivePass.latestStatus,
      latestMode: currentRoutePrelivePass.latestMode,
      latestStopReason: currentRoutePrelivePass.latestStopReason,
      nextAction: currentRoutePrelivePass.nextAction,
      recentRuns: currentRoutePrelivePass.recentRuns,
    },
    evidenceCampaign: {
      runCount: evidenceCampaign.runCount,
      previewCount: evidenceCampaign.previewCount,
      readyCount: evidenceCampaign.readyCount,
      reviewReadyCount: evidenceCampaign.reviewReadyCount,
      awaitingManualCount: evidenceCampaign.awaitingManualCount,
      blockedCount: evidenceCampaign.blockedCount,
      failureCount: evidenceCampaign.failureCount,
      latestObservedAt: evidenceCampaign.latestObservedAt,
      latestStatus: evidenceCampaign.latestStatus,
      latestMode: evidenceCampaign.latestMode,
      latestStopReason: evidenceCampaign.latestStopReason,
      nextAction: evidenceCampaign.nextAction,
      recentCampaigns: evidenceCampaign.recentCampaigns,
    },
  };
  const pivotPlan = buildStrategyPivotPlan({
    dashboardStatus: {
      generatedAt: now,
      overall,
      prelive,
      strategy: strategyBase,
    },
    state: {
      scoreSnapshot: input.scoreSnapshot || null,
    },
    triangleArtifacts: input.triangleArtifacts || {},
  });
  const yieldShadowBook = buildYieldShadowBook({ pivotPlan });
  const proxySpreadCoveragePlan = buildProxySpreadCoveragePlan({
    proxySpreadSummary: strategyBase.btcProxySpreads || null,
    now,
  });
  const promotion = buildPromotionSlice(input.promotionReport || null);
  const strategy = {
    ...strategyBase,
    pivotPlan: summarizeStrategyPivotPlan(pivotPlan),
    yieldShadowBook: summarizeYieldShadowBook(yieldShadowBook),
    proxySpreadCoveragePlan: summarizeProxySpreadCoveragePlan(proxySpreadCoveragePlan),
    // parity floor defaults — enriched by current-dashboard-context.mjs when data available
    chainParity: null,
    strategyParity: null,
    promotionSummary: promotion,
    microCanarySummary: { total: 0, byStrategy: {} },
  };
  const strategySnapshot = buildStrategySnapshot({
    dashboardStatus: {
      generatedAt: now,
      overall,
      prelive,
      strategy,
    },
    state: {
      scoreSnapshot: input.scoreSnapshot || null,
    },
    triangleArtifacts: input.triangleArtifacts || {},
    now,
  });
  strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);

  // Quote lag dry-run summary (from collect-quote-lag collector)
  const quoteLag = input.quoteLagLatest || null;

  // DEX spread monitor (from collect-dex-spreads collector)
  const dexSpread = input.dexSpreadLatest || null;
  const researchSignals = researchSignalsSummary(input.thresholdSensitivity || null, now);
  const pnl = pnlSummary({
    opportunity,
    shadowCycle,
    receiptRecords: input.receiptReconciliations || [],
  });
  const tradeHistory = tradeHistorySummary({
    executionEvents: input.executionEvents || [],
    receiptRecords: input.receiptReconciliations || [],
    preliveForkReceipts: input.preliveForkReceipts || [],
    now,
  });
  const manualMemos = buildManualMemos({ decisionInputs, shadowCycle, prelive, gateway });
  const executorRuntime = input.executorRuntime || null;

  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    generatedAt: now,
    overall,
    gateway,
    market,
    gas,
    executionGas,
    estimatorWallet,
    shadowCycle,
    canaryAdvance,
    strategy,
    prelive,
    bitcoinFee,
    opportunity,
    pnl,
    tradeHistory,
    decisionInputs,
    researchSignals,
    manualMemos,
    dex,
    audit: auditStatus,
    executorRuntime,
    promotion,
    researchFunnel: input.researchFunnel || emptyResearchFunnelSlice(),
    quoteLag,
    dexSpread,
    dataCounts: {
      routesRecords: input.routesRecords?.length || 0,
      quotes: input.quotes?.length || 0,
      quoteFailures: input.failures?.length || 0,
      gasSnapshots: input.gasSnapshots?.length || 0,
      gasFailures: input.gasFailures?.length || 0,
      priceSnapshots: input.priceSnapshots?.length || 0,
      updateSnapshots: input.updateSnapshots?.length || 0,
      updateAlerts: input.updateAlerts?.length || 0,
      dexQuotes: input.dexQuotes?.length || 0,
      dexFailures: input.dexFailures?.length || 0,
      bitcoinFeeSnapshots: input.bitcoinFeeSnapshots?.length || 0,
      gatewayGasEstimates: input.gatewayGasEstimates?.length || 0,
      gatewayGasEstimateFailures: input.gatewayGasEstimateFailures?.length || 0,
      estimatorWalletReadiness: input.estimatorWalletReadiness?.length || 0,
      estimatorWalletReadinessFailures: input.estimatorWalletReadinessFailures?.length || 0,
      shadowObservations: input.shadowObservations?.length || 0,
      preliveSimulationRuns: input.preliveSimulationRuns?.length || 0,
      preliveForkPlans: input.preliveForkPlan?.plans?.length || 0,
      preliveForkSubmissions: input.preliveForkSubmissions?.length || 0,
      preliveForkReceipts: input.preliveForkReceipts?.length || 0,
      receiptReconciliations: input.receiptReconciliations?.length || 0,
      executionJournalEvents: input.executionEvents?.length || 0,
      shadowRefreshExecutions: input.shadowRefreshExecutions?.length || 0,
      shadowRefreshBatches: input.shadowRefreshBatches?.length || 0,
      connectedRefreshRuns: input.connectedRefreshRuns?.length || 0,
      currentRoutePrelivePasses: input.currentRoutePrelivePasses?.length || 0,
      preliveEvidenceCampaigns: input.preliveEvidenceCampaigns?.length || 0,
      executorHeartbeatPresent: executorRuntime?.heartbeatPresent ? 1 : 0,
      shadowCyclePresent: shadowCycle ? 1 : 0,
      advanceCanaryPresent: canaryAdvance ? 1 : 0,
    },
    exposurePolicy: {
      cloudflare: "dashboard_only",
      containsPrivateKeys: false,
      containsWalletSigning: false,
      containsExecutionPermission: false,
    },
  };
}

export async function writeDashboardStatus(dataDir, status, fileName = "dashboard-status.json") {
  const path = join(dataDir, fileName);
  return writeTextIfChanged(path, `${JSON.stringify(status, null, 2)}\n`, {
    normalize: (contents) => {
      if (!contents) return contents;
      return JSON.stringify(stripVolatileStatusFields(JSON.parse(contents)));
    },
  });
}
