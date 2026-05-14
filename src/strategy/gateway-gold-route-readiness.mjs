import { join } from "node:path";
import { ZERO_TOKEN, tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { config } from "../config/env.mjs";
import { routeKey, GatewayClient } from "../gateway/client.mjs";
import { buildGatewayQuoteParams } from "../gateway/quote-params.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../market/prices.mjs";

const GOLD_TICKER_ORDER = Object.freeze(["XAUT", "PAXG"]);
const ROUTE_NOT_AVAILABLE_BLOCKERS = Object.freeze(["route_not_available_yet", "gateway_gold_route_missing"]);
const GOLD_FAMILY_TARGETS = Object.freeze(["gold_rotation", "tokenized_gold_rotation", "tokenized_reserve_sleeve"]);

const ISSUER_REDEMPTION_RISK_NOTES = Object.freeze({
  XAUT: "XAUT issuer redemption and bar-delivery constraints must stay explicit before any live sleeve promotion.",
  PAXG: "PAXG issuer custody/KYC redemption constraints must stay explicit before any live sleeve promotion.",
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeToken(value) {
  return String(value || "").toLowerCase();
}

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isNativeBitcoinRouteToken(value) {
  return normalizeToken(value) === normalizeToken(ZERO_TOKEN);
}

export function isGoldTicker(value) {
  return GOLD_TICKER_ORDER.includes(normalizeTicker(value));
}

function preferredGoldTicker(left, right) {
  const leftRank = GOLD_TICKER_ORDER.indexOf(left);
  const rightRank = GOLD_TICKER_ORDER.indexOf(right);
  const normalizedLeftRank = leftRank === -1 ? GOLD_TICKER_ORDER.length : leftRank;
  const normalizedRightRank = rightRank === -1 ? GOLD_TICKER_ORDER.length : rightRank;
  return normalizedLeftRank - normalizedRightRank;
}

function routePairKeyFromEntry(route) {
  return `${normalizeTicker(route.assetTicker)}:${route.goldChain}:${normalizeToken(route.goldToken)}`;
}

function toArrayUnique(values = []) {
  return [...new Set(values)];
}

function extractQuotePayload(body) {
  return body?.onramp || body?.offramp || body?.layerZero || body || null;
}

function parsePositiveBigInt(value) {
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function computeSlippageBps({ inputUsd, outputUsd }) {
  if (!Number.isFinite(inputUsd) || !Number.isFinite(outputUsd) || inputUsd <= 0) return null;
  return round(((inputUsd - outputUsd) / inputUsd) * 10_000, 2);
}

function sortAttempts(items = []) {
  return [...items].sort(
    (left, right) =>
      preferredGoldTicker(left.assetTicker, right.assetTicker) ||
      String(left.pairKey || "").localeCompare(String(right.pairKey || "")) ||
      Number(left.inputSats || 0) - Number(right.inputSats || 0),
  );
}

function buildDefaultPerAssetStatus(surface) {
  const map = {};
  for (const ticker of GOLD_TICKER_ORDER) {
    const asset = surface.assets.find((item) => item.assetTicker === ticker) || null;
    map[ticker] = {
      routeAvailable: asset?.routeAvailable === true,
      exitLiquidityStatus:
        asset?.routeAvailable === true ? "route_present_quote_unmeasured" : "route_not_available_yet",
    };
  }
  return map;
}

export function buildGatewayGoldRouteSurface(routes = []) {
  const normalized = Array.isArray(routes) ? routes : [];
  const pairCandidates = new Map();

  for (const route of normalized) {
    const srcAsset = tokenAsset(route.srcChain, route.srcToken);
    const dstAsset = tokenAsset(route.dstChain, route.dstToken);
    const srcTicker = normalizeTicker(srcAsset.ticker);
    const dstTicker = normalizeTicker(dstAsset.ticker);

    if (route.srcChain === "bitcoin" && isNativeBitcoinRouteToken(route.srcToken) && isGoldTicker(dstTicker)) {
      const key = `${dstTicker}:${route.dstChain}:${normalizeToken(route.dstToken)}`;
      if (!pairCandidates.has(key)) {
        pairCandidates.set(key, {
          assetTicker: dstTicker,
          goldChain: route.dstChain,
          goldToken: route.dstToken,
          entryRoutes: [],
          exitRoutes: [],
        });
      }
      pairCandidates.get(key).entryRoutes.push(route);
    }

    if (route.dstChain === "bitcoin" && isNativeBitcoinRouteToken(route.dstToken) && isGoldTicker(srcTicker)) {
      const key = `${srcTicker}:${route.srcChain}:${normalizeToken(route.srcToken)}`;
      if (!pairCandidates.has(key)) {
        pairCandidates.set(key, {
          assetTicker: srcTicker,
          goldChain: route.srcChain,
          goldToken: route.srcToken,
          entryRoutes: [],
          exitRoutes: [],
        });
      }
      pairCandidates.get(key).exitRoutes.push(route);
    }
  }

  const routePairs = [...pairCandidates.values()]
    .map((pair) => {
      const entryRoute = pair.entryRoutes[0] || null;
      const exitRoute = pair.exitRoutes[0] || null;
      return {
        assetTicker: pair.assetTicker,
        goldChain: pair.goldChain,
        goldToken: pair.goldToken,
        routeAvailable: Boolean(entryRoute && exitRoute),
        entryRoute,
        exitRoute,
        entryRouteKey: entryRoute ? routeKey(entryRoute) : null,
        exitRouteKey: exitRoute ? routeKey(exitRoute) : null,
      };
    })
    .sort(
      (left, right) =>
        preferredGoldTicker(left.assetTicker, right.assetTicker) ||
        left.goldChain.localeCompare(right.goldChain) ||
        normalizeToken(left.goldToken).localeCompare(normalizeToken(right.goldToken)),
    );

  const assets = GOLD_TICKER_ORDER.map((ticker) => {
    const pairs = routePairs.filter((pair) => pair.assetTicker === ticker);
    return {
      assetTicker: ticker,
      routePairCount: pairs.length,
      routeAvailable: pairs.some((pair) => pair.routeAvailable),
      routePairs: pairs,
    };
  });

  const routeAvailable = routePairs.some((pair) => pair.routeAvailable);
  const bestGoldAsset = assets.find((item) => item.routeAvailable)?.assetTicker || null;
  const blockers = routeAvailable ? [] : [...ROUTE_NOT_AVAILABLE_BLOCKERS];

  return Object.freeze({
    routeAvailable,
    bestGoldAsset,
    blockers: Object.freeze(blockers),
    assets: Object.freeze(assets),
    routePairs: Object.freeze(routePairs),
  });
}

function evaluateAttempt({ pair, satsAmount, entryQuote, exitQuote, prices, now }) {
  const entryPayload = extractQuotePayload(entryQuote?.body);
  const exitPayload = extractQuotePayload(exitQuote?.body);
  const entryOutputAmount = parsePositiveBigInt(entryPayload?.outputAmount?.amount);
  const exitOutputAmount = parsePositiveBigInt(exitPayload?.outputAmount?.amount);
  if (!entryOutputAmount || !exitOutputAmount) return null;

  const btcPriceUsd = priceForAssetUsd(tokenAsset("bitcoin", ZERO_TOKEN), prices);
  const goldAsset = tokenAsset(pair.goldChain, pair.goldToken);
  const goldPriceUsd = priceForAssetUsd(goldAsset, prices);
  const satsInput = Number(satsAmount);
  const satsOutput = Number(exitOutputAmount);
  const roundTripCostSats = satsInput - satsOutput;
  const roundTripCostBtc = roundTripCostSats / 100_000_000;
  const roundTripCostUsd = Number.isFinite(btcPriceUsd) ? roundTripCostBtc * btcPriceUsd : null;
  const roundTripCostBps = satsInput > 0 ? (roundTripCostSats / satsInput) * 10_000 : null;

  const entryInputUsd = Number.isFinite(btcPriceUsd) ? (satsInput / 100_000_000) * btcPriceUsd : null;
  const entryOutputDecimal = unitsToDecimal(entryOutputAmount.toString(), goldAsset.decimals);
  const entryOutputUsd =
    Number.isFinite(goldPriceUsd) && Number.isFinite(entryOutputDecimal) ? entryOutputDecimal * goldPriceUsd : null;
  const exitInputDecimal = unitsToDecimal(entryOutputAmount.toString(), goldAsset.decimals);
  const exitInputUsd =
    Number.isFinite(goldPriceUsd) && Number.isFinite(exitInputDecimal) ? exitInputDecimal * goldPriceUsd : null;
  const exitOutputUsd = Number.isFinite(btcPriceUsd) ? (satsOutput / 100_000_000) * btcPriceUsd : null;

  const entrySlippageBps = computeSlippageBps({ inputUsd: entryInputUsd, outputUsd: entryOutputUsd });
  const exitSlippageBps = computeSlippageBps({ inputUsd: exitInputUsd, outputUsd: exitOutputUsd });
  const combinedSlippageBps =
    Number.isFinite(entrySlippageBps) && Number.isFinite(exitSlippageBps)
      ? round(entrySlippageBps + exitSlippageBps, 2)
      : null;

  return {
    observedAt: now,
    pairKey: routePairKeyFromEntry(pair),
    assetTicker: pair.assetTicker,
    goldChain: pair.goldChain,
    inputSats: satsAmount.toString(),
    entryOutputAmount: entryOutputAmount.toString(),
    exitOutputSats: exitOutputAmount.toString(),
    roundTripCostSats,
    roundTripCostBtc: round(roundTripCostBtc, 10),
    roundTripCostUsd: round(roundTripCostUsd, 6),
    roundTripCostBps: round(roundTripCostBps, 2),
    entrySlippageBps,
    exitSlippageBps,
    combinedSlippageBps,
    quoteLatenciesMs: {
      entry: finite(entryQuote?.latencyMs),
      exit: finite(exitQuote?.latencyMs),
    },
  };
}

export async function evaluateGatewayGoldRouteReadiness({
  gatewayApiBase = config.gatewayApiBase,
  routes = null,
  client = null,
  sampleSats = config.sampleSats,
  sender = config.verifyRecipient,
  btcRecipient = config.verifyBtcRecipient,
  slippage = config.slippageBps,
  prices = null,
  now = new Date().toISOString(),
} = {}) {
  const gatewayClient = client || new GatewayClient({ baseUrl: gatewayApiBase });
  const routeSource = routes || (await gatewayClient.getRoutes()).body || [];
  const surface = buildGatewayGoldRouteSurface(routeSource);
  const priceSnapshot = prices || (await getCoinGeckoPricesUsd());
  const perAssetStatus = buildDefaultPerAssetStatus(surface);

  if (!surface.routeAvailable) {
    return Object.freeze({
      schemaVersion: 1,
      observedAt: now,
      routeAvailable: false,
      bestGoldAsset: null,
      blocker: ROUTE_NOT_AVAILABLE_BLOCKERS[0],
      blockers: [...ROUTE_NOT_AVAILABLE_BLOCKERS],
      quoteObservedAt: null,
      roundTripCostBtc: null,
      roundTripCostUsd: null,
      slippageBps: null,
      minViableCanarySizeSats: null,
      onChainExitLiquidityStatus: perAssetStatus,
      issuerRedemptionRiskNotes: ISSUER_REDEMPTION_RISK_NOTES,
      liveEligible: false,
      familyTargets: GOLD_FAMILY_TARGETS,
      preflight: {
        attempted: false,
        reason: "gateway_gold_route_missing",
        successfulAttemptCount: 0,
        attemptedPairCount: 0,
        attemptedSats: [],
        attempts: [],
      },
      routeSurface: surface,
    });
  }

  const attemptSats = toArrayUnique(
    (sampleSats || [])
      .map((value) => parsePositiveBigInt(value))
      .filter(Boolean)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((value) => value.toString()),
  );
  const attempts = [];
  const successfulAttempts = [];
  const routablePairs = surface.routePairs.filter((pair) => pair.routeAvailable);

  for (const pair of routablePairs) {
    for (const sats of attemptSats) {
      const entryParams = buildGatewayQuoteParams({
        route: pair.entryRoute,
        amount: sats,
        recipient: sender,
        slippage,
      });

      let entryQuote;
      try {
        entryQuote = await gatewayClient.getQuote(entryParams);
      } catch (error) {
        attempts.push({
          pairKey: routePairKeyFromEntry(pair),
          assetTicker: pair.assetTicker,
          goldChain: pair.goldChain,
          inputSats: sats,
          status: "entry_quote_failed",
          error: error.message,
        });
        continue;
      }

      const entryPayload = extractQuotePayload(entryQuote.body);
      const entryOutput = parsePositiveBigInt(entryPayload?.outputAmount?.amount);
      if (!entryOutput) {
        attempts.push({
          pairKey: routePairKeyFromEntry(pair),
          assetTicker: pair.assetTicker,
          goldChain: pair.goldChain,
          inputSats: sats,
          status: "entry_output_missing",
        });
        continue;
      }

      const exitParams = buildGatewayQuoteParams({
        route: pair.exitRoute,
        amount: entryOutput.toString(),
        sender,
        recipient: btcRecipient,
        slippage,
      });

      let exitQuote;
      try {
        exitQuote = await gatewayClient.getQuote(exitParams);
      } catch (error) {
        attempts.push({
          pairKey: routePairKeyFromEntry(pair),
          assetTicker: pair.assetTicker,
          goldChain: pair.goldChain,
          inputSats: sats,
          entryOutputAmount: entryOutput.toString(),
          status: "exit_quote_failed",
          error: error.message,
        });
        continue;
      }

      const evaluated = evaluateAttempt({
        pair,
        satsAmount: BigInt(sats),
        entryQuote,
        exitQuote,
        prices: priceSnapshot,
        now,
      });

      if (!evaluated) {
        attempts.push({
          pairKey: routePairKeyFromEntry(pair),
          assetTicker: pair.assetTicker,
          goldChain: pair.goldChain,
          inputSats: sats,
          entryOutputAmount: entryOutput.toString(),
          status: "round_trip_evaluation_failed",
        });
        continue;
      }

      attempts.push({
        pairKey: evaluated.pairKey,
        assetTicker: evaluated.assetTicker,
        goldChain: evaluated.goldChain,
        inputSats: evaluated.inputSats,
        entryOutputAmount: evaluated.entryOutputAmount,
        exitOutputSats: evaluated.exitOutputSats,
        status: "success",
        roundTripCostBps: evaluated.roundTripCostBps,
      });
      successfulAttempts.push(evaluated);
    }
  }

  const sortedSuccessful = [...successfulAttempts].sort(
    (left, right) =>
      (left.roundTripCostBps ?? Number.POSITIVE_INFINITY) - (right.roundTripCostBps ?? Number.POSITIVE_INFINITY) ||
      preferredGoldTicker(left.assetTicker, right.assetTicker) ||
      Number(left.inputSats) - Number(right.inputSats),
  );
  const best = sortedSuccessful[0] || null;

  for (const ticker of GOLD_TICKER_ORDER) {
    const hasSuccess = sortedSuccessful.some((item) => item.assetTicker === ticker);
    const hasExitQuoteFailure = attempts.some(
      (item) => item.assetTicker === ticker && item.status === "exit_quote_failed",
    );
    if (perAssetStatus[ticker]) {
      perAssetStatus[ticker].exitLiquidityStatus = hasSuccess
        ? "quoted_round_trip"
        : hasExitQuoteFailure
          ? "entry_quote_available_exit_quote_unavailable"
          : perAssetStatus[ticker].routeAvailable
            ? "route_present_quote_unavailable"
            : "route_not_available_yet";
    }
  }

  const minViable =
    sortedSuccessful
      .map((item) => Number(item.inputSats))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0] ?? null;
  const bestGoldAsset = best?.assetTicker || surface.bestGoldAsset || null;
  const exitQuoteFailed = attempts.some((item) => item.status === "exit_quote_failed");
  const blocker = best
    ? null
    : exitQuoteFailed
      ? "gateway_gold_exit_quote_preflight_failed"
      : "gateway_gold_quote_preflight_failed";
  const blockers = best ? [] : [blocker];

  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    routeAvailable: true,
    bestGoldAsset,
    blocker,
    blockers,
    quoteObservedAt: best?.observedAt || null,
    roundTripCostBtc: best?.roundTripCostBtc ?? null,
    roundTripCostUsd: best?.roundTripCostUsd ?? null,
    slippageBps: best?.combinedSlippageBps ?? null,
    minViableCanarySizeSats: Number.isFinite(minViable) ? String(Math.trunc(minViable)) : null,
    onChainExitLiquidityStatus: perAssetStatus,
    issuerRedemptionRiskNotes: ISSUER_REDEMPTION_RISK_NOTES,
    liveEligible: Boolean(best),
    familyTargets: GOLD_FAMILY_TARGETS,
    preflight: {
      attempted: true,
      reason: best ? "quoted_round_trip_available" : "quoted_round_trip_unavailable",
      successfulAttemptCount: sortedSuccessful.length,
      attemptedPairCount: routablePairs.length,
      attemptedSats: attemptSats,
      attempts: sortAttempts(attempts).slice(0, 50),
      best,
    },
    routeSurface: surface,
  });
}

export function buildGatewayGoldRouteReadinessSlice({
  routes = [],
  report = null,
  now = new Date().toISOString(),
} = {}) {
  const surface = buildGatewayGoldRouteSurface(routes);
  const perAssetStatus = buildDefaultPerAssetStatus(surface);

  const fallback = {
    observedAt: now,
    routeAvailable: surface.routeAvailable,
    bestGoldAsset: surface.bestGoldAsset,
    blocker: surface.blockers[0] || null,
    blockers: surface.blockers,
    quoteObservedAt: null,
    roundTripCostBtc: null,
    roundTripCostUsd: null,
    slippageBps: null,
    minViableCanarySizeSats: null,
    onChainExitLiquidityStatus: perAssetStatus,
    issuerRedemptionRiskNotes: ISSUER_REDEMPTION_RISK_NOTES,
    liveEligible: false,
    familyTargets: GOLD_FAMILY_TARGETS,
    preflight: {
      attempted: false,
      reason: surface.routeAvailable ? "route_available_quote_not_collected" : "gateway_gold_route_missing",
      successfulAttemptCount: 0,
      attemptedPairCount: surface.routePairs.filter((item) => item.routeAvailable).length,
      attemptedSats: [],
      attempts: [],
    },
  };

  if (!report || typeof report !== "object") return Object.freeze({ ...fallback, routeSurface: surface });

  const mergedPerAssetStatus = {
    ...perAssetStatus,
    ...(report.onChainExitLiquidityStatus || {}),
  };
  return Object.freeze({
    ...fallback,
    observedAt: report.observedAt || fallback.observedAt,
    routeAvailable: report.routeAvailable === true || fallback.routeAvailable,
    bestGoldAsset: report.bestGoldAsset || fallback.bestGoldAsset,
    blocker: report.blocker || fallback.blocker,
    blockers: Array.isArray(report.blockers) ? report.blockers : fallback.blockers,
    quoteObservedAt: report.quoteObservedAt || null,
    roundTripCostBtc: finite(report.roundTripCostBtc),
    roundTripCostUsd: finite(report.roundTripCostUsd),
    slippageBps: finite(report.slippageBps),
    minViableCanarySizeSats: report.minViableCanarySizeSats || null,
    onChainExitLiquidityStatus: mergedPerAssetStatus,
    issuerRedemptionRiskNotes: report.issuerRedemptionRiskNotes || ISSUER_REDEMPTION_RISK_NOTES,
    liveEligible: report.liveEligible === true && !report.blocker,
    familyTargets: Array.isArray(report.familyTargets) ? report.familyTargets : GOLD_FAMILY_TARGETS,
    preflight: {
      ...fallback.preflight,
      ...(report.preflight || {}),
    },
    routeSurface: surface,
  });
}

export async function writeGatewayGoldReadinessReport({ dataDir = config.dataDir, report } = {}) {
  const outputPath = join(dataDir, "gateway-gold-readiness-latest.json");
  const payload = report || {};
  await writeTextIfChanged(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}
