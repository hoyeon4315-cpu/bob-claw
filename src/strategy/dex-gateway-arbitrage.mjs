import { isBtcLikeAsset, isEthLikeAsset, isGoldAsset, isStableAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { defaultDexQuoteProvider, filterTrustedExecutableDexQuotes } from "../dex/odos.mjs";
import { hasEthereumL1PhaseBlock } from "../risk/ethereum-l1-policy.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function latestEntryQuotes(dexQuotes = []) {
  const latest = new Map();
  for (const quote of filterTrustedExecutableDexQuotes(dexQuotes)) {
    if (quote?.source !== "gateway_src_entry_leg" || !quote?.gatewayRouteKey || !quote?.gatewayAmount) continue;
    const key = `${quote.gatewayRouteKey}|${quote.gatewayAmount}`;
    const existing = latest.get(key);
    if (!existing || new Date(quote.observedAt || 0) > new Date(existing.observedAt || 0)) {
      latest.set(key, quote);
    }
  }
  return latest;
}

function amountGapPct(requiredAmount, acquiredAmount) {
  if (!Number.isFinite(requiredAmount) || !Number.isFinite(acquiredAmount) || requiredAmount <= 0) return null;
  return Math.abs(acquiredAmount - requiredAmount) / requiredAmount;
}

function loopBlockers({ score, exactAmountMatch, measuredLoopNetUsd, hasEntryQuote }) {
  const blockers = [];
  if (!hasEntryQuote) blockers.push("missing_source_entry_quote");
  if (!exactAmountMatch) blockers.push("entry_amount_mismatch");
  if (!Number.isFinite(score?.executableOutputUsd)) blockers.push("missing_destination_exit_quote");
  if (Number.isFinite(score?.routeStats?.failureRate) && score.routeStats.failureRate > 0.1)
    blockers.push("high_failure_rate");
  for (const gap of score?.dataGaps || []) blockers.push(`gateway_${gap}`);
  if (
    hasEthereumL1PhaseBlock(score) ||
    (score?.tradeReadiness && String(score.tradeReadiness).startsWith("observe_only_"))
  ) {
    blockers.push(`gateway_${score.tradeReadiness}`);
  }
  if (!(measuredLoopNetUsd > 0)) blockers.push("non_positive_loop_net_edge");
  return [...new Set(blockers)];
}

function summarizeLoop(score, entryQuote, amountTolerancePct) {
  if (!entryQuote) {
    return {
      routeKey: score.routeKey,
      amount: score.amount,
      srcChain: score.srcChain,
      dstChain: score.dstChain,
      srcTicker: score.srcAsset?.ticker || null,
      dstTicker: score.dstAsset?.ticker || null,
      entryQuoteObservedAt: null,
      entryStableUsd: null,
      entryGasUsd: null,
      requiredGatewayInputAmount: finite(score.inputAmount),
      acquiredEntryAmount: null,
      amountGapPct: null,
      exactAmountMatch: false,
      destinationExecutableUsd: finite(score.executableOutputUsd),
      gatewayKnownCostUsd: finite(score.knownCostUsd),
      measuredLoopNetUsd: null,
      blockers: loopBlockers({ score, exactAmountMatch: false, measuredLoopNetUsd: null, hasEntryQuote: false }),
    };
  }

  const requiredGatewayInputAmount = finite(score.inputAmount);
  const acquiredEntryAmount = unitsToDecimal(entryQuote.outputAmount, score?.srcAsset?.decimals);
  const gapPct = amountGapPct(requiredGatewayInputAmount, acquiredEntryAmount);
  const exactAmountMatch = Number.isFinite(gapPct) ? gapPct <= amountTolerancePct : false;
  const entryStableUsd = finite(entryQuote.inputValueUsd);
  const entryGasUsd = finite(entryQuote.gasEstimateValueUsd) || 0;
  const destinationExecutableUsd = finite(score.executableOutputUsd);
  const gatewayKnownCostUsd = finite(score.knownCostUsd) || 0;
  const measuredLoopNetUsd =
    Number.isFinite(destinationExecutableUsd) && Number.isFinite(entryStableUsd)
      ? destinationExecutableUsd - entryStableUsd - gatewayKnownCostUsd - entryGasUsd
      : null;

  return {
    routeKey: score.routeKey,
    amount: score.amount,
    srcChain: score.srcChain,
    dstChain: score.dstChain,
    srcTicker: score.srcAsset?.ticker || null,
    dstTicker: score.dstAsset?.ticker || null,
    entryQuoteObservedAt: entryQuote.observedAt || null,
    entryStableUsd,
    entryGasUsd: finite(entryGasUsd),
    requiredGatewayInputAmount,
    acquiredEntryAmount: finite(acquiredEntryAmount),
    amountGapPct: finite(gapPct),
    exactAmountMatch,
    destinationExecutableUsd,
    gatewayKnownCostUsd: finite(gatewayKnownCostUsd),
    measuredLoopNetUsd: finite(measuredLoopNetUsd),
    blockers: loopBlockers({ score, exactAmountMatch, measuredLoopNetUsd, hasEntryQuote: true }),
  };
}

function eligibleBtc(score) {
  return isBtcLikeAsset(score?.srcAsset) && isBtcLikeAsset(score?.dstAsset);
}

function eligibleEth(score) {
  return isEthLikeAsset(score?.srcAsset) && isEthLikeAsset(score?.dstAsset);
}

function isBtcEndpoint(asset) {
  return isBtcLikeAsset(asset) || asset?.family === "btc";
}

function eligibleStable(score) {
  const src = score?.srcAsset;
  const dst = score?.dstAsset;
  return (isStableAsset(src) && isBtcEndpoint(dst)) || (isBtcEndpoint(src) && isStableAsset(dst));
}

function eligibleGold(score) {
  const src = score?.srcAsset;
  const dst = score?.dstAsset;
  return (isGoldAsset(src) && isBtcEndpoint(dst)) || (isBtcEndpoint(src) && isGoldAsset(dst));
}

export const ASSET_FAMILY_SCORE_FILTERS = Object.freeze({
  wbtc: eligibleBtc,
  eth: eligibleEth,
  stable: eligibleStable,
  gold: eligibleGold,
});

export function resolveScoreFilter(familyKey) {
  return ASSET_FAMILY_SCORE_FILTERS[familyKey] || eligibleBtc;
}

export function buildDexGatewayLoops({ scoreSnapshot = null, dexQuotes = [] } = {}, options = {}) {
  const amountTolerancePct = Number.isFinite(options.amountTolerancePct) ? options.amountTolerancePct : 0.02;
  const scoreFilter = options.scoreFilter || eligibleBtc;
  const scores = (scoreSnapshot?.scores || []).filter(scoreFilter);
  const entryQuotes = latestEntryQuotes(dexQuotes);
  const loops = scores.map((score) =>
    summarizeLoop(score, entryQuotes.get(`${score.routeKey}|${score.amount}`) || null, amountTolerancePct),
  );

  loops.sort(
    (left, right) =>
      (right.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) - (left.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) ||
      (left.amountGapPct ?? Number.POSITIVE_INFINITY) - (right.amountGapPct ?? Number.POSITIVE_INFINITY) ||
      String(left.routeKey).localeCompare(String(right.routeKey)),
  );

  return {
    amountTolerancePct,
    scores,
    entryQuotes,
    loops,
  };
}

export function buildDexGatewayArbitrageSummary({ scoreSnapshot = null, dexQuotes = [] } = {}, options = {}) {
  const { amountTolerancePct, scores, entryQuotes, loops } = buildDexGatewayLoops(
    { scoreSnapshot, dexQuotes },
    options,
  );
  const bothDexSupportedRoutes = scores.filter(
    (score) => defaultDexQuoteProvider(score.srcChain) && defaultDexQuoteProvider(score.dstChain),
  );

  return {
    schemaVersion: 1,
    generatedAt: scoreSnapshot?.generatedAt || null,
    amountTolerancePct,
    routeCount: scores.length,
    bothDexSupportedRouteCount: bothDexSupportedRoutes.length,
    entryQuoteCount: entryQuotes.size,
    executableLoopCount: loops.filter((item) => Number.isFinite(item.destinationExecutableUsd)).length,
    exactAmountMatchCount: loops.filter((item) => item.exactAmountMatch).length,
    measuredNetLoopCount: loops.filter((item) => Number.isFinite(item.measuredLoopNetUsd)).length,
    profitableExactCount: loops.filter(
      (item) => item.exactAmountMatch && Number.isFinite(item.measuredLoopNetUsd) && item.measuredLoopNetUsd > 0,
    ).length,
    bestLoop:
      loops.find(
        (item) => item.exactAmountMatch && Number.isFinite(item.measuredLoopNetUsd) && item.measuredLoopNetUsd > 0,
      ) || null,
    closestLoop: loops[0] || null,
    loops: loops.slice(0, 10),
  };
}

export function buildEthGatewayLoops(args = {}, options = {}) {
  return buildDexGatewayLoops(args, {
    ...options,
    scoreFilter: eligibleEth,
  });
}

export function buildEthGatewayArbitrageSummary(args = {}, options = {}) {
  return buildDexGatewayArbitrageSummary(args, {
    ...options,
    scoreFilter: eligibleEth,
  });
}

export function buildStableGatewayLoops(args = {}, options = {}) {
  return buildDexGatewayLoops(args, {
    ...options,
    scoreFilter: eligibleStable,
  });
}

export function buildStableGatewayArbitrageSummary(args = {}, options = {}) {
  return buildDexGatewayArbitrageSummary(args, {
    ...options,
    scoreFilter: eligibleStable,
  });
}

export function buildGoldGatewayLoops(args = {}, options = {}) {
  return buildDexGatewayLoops(args, {
    ...options,
    scoreFilter: eligibleGold,
  });
}

export function buildGoldGatewayArbitrageSummary(args = {}, options = {}) {
  return buildDexGatewayArbitrageSummary(args, {
    ...options,
    scoreFilter: eligibleGold,
  });
}

const FAMILY_SUMMARY_BUILDERS = Object.freeze({
  wbtc: buildDexGatewayArbitrageSummary,
  eth: buildEthGatewayArbitrageSummary,
  stable: buildStableGatewayArbitrageSummary,
  gold: buildGoldGatewayArbitrageSummary,
});

export function buildMultiFamilyGatewayArbitrageSummary(args = {}, options = {}) {
  const requestedFamilies =
    Array.isArray(options.families) && options.families.length
      ? options.families.filter((key) => FAMILY_SUMMARY_BUILDERS[key])
      : ["wbtc", "stable", "gold"];

  const families = requestedFamilies.map((familyKey) => {
    const summary = FAMILY_SUMMARY_BUILDERS[familyKey](args, options);
    return {
      family: familyKey,
      routeCount: summary.routeCount,
      bothDexSupportedRouteCount: summary.bothDexSupportedRouteCount,
      entryQuoteCount: summary.entryQuoteCount,
      executableLoopCount: summary.executableLoopCount,
      exactAmountMatchCount: summary.exactAmountMatchCount,
      measuredNetLoopCount: summary.measuredNetLoopCount,
      profitableExactCount: summary.profitableExactCount,
      bestLoop: summary.bestLoop,
      closestLoop: summary.closestLoop,
      amountTolerancePct: summary.amountTolerancePct,
    };
  });

  families.sort(
    (left, right) =>
      (right.bestLoop?.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) -
        (left.bestLoop?.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) ||
      right.profitableExactCount - left.profitableExactCount ||
      right.exactAmountMatchCount - left.exactAmountMatchCount ||
      String(left.family).localeCompare(String(right.family)),
  );

  return {
    schemaVersion: 1,
    generatedAt: args?.scoreSnapshot?.generatedAt || null,
    requestedFamilies,
    families,
  };
}
