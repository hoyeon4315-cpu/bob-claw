import { unitsToDecimal } from "../assets/tokens.mjs";
import { ODOS_CHAIN_IDS } from "../dex/odos.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function latestEntryQuotes(dexQuotes = []) {
  const latest = new Map();
  for (const quote of dexQuotes) {
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
  if (Number.isFinite(score?.routeStats?.failureRate) && score.routeStats.failureRate > 0.1) blockers.push("high_failure_rate");
  for (const gap of score?.dataGaps || []) blockers.push(`gateway_${gap}`);
  if (score?.tradeReadiness === "observe_only_expensive_exit" || score?.tradeReadiness === "observe_only_slow_settlement") {
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

function eligible(score) {
  return ["btc", "wrapped_btc"].includes(score?.srcAsset?.family) && ["btc", "wrapped_btc"].includes(score?.dstAsset?.family);
}

export function buildDexGatewayLoops({ scoreSnapshot = null, dexQuotes = [] } = {}, options = {}) {
  const amountTolerancePct = Number.isFinite(options.amountTolerancePct) ? options.amountTolerancePct : 0.02;
  const scores = (scoreSnapshot?.scores || []).filter(eligible);
  const entryQuotes = latestEntryQuotes(dexQuotes);
  const loops = scores.map((score) => summarizeLoop(score, entryQuotes.get(`${score.routeKey}|${score.amount}`) || null, amountTolerancePct));

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
  const { amountTolerancePct, scores, entryQuotes, loops } = buildDexGatewayLoops({ scoreSnapshot, dexQuotes }, options);
  const bothDexSupportedRoutes = scores.filter((score) => ODOS_CHAIN_IDS[score.srcChain] && ODOS_CHAIN_IDS[score.dstChain]);

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
    profitableExactCount: loops.filter((item) => item.exactAmountMatch && Number.isFinite(item.measuredLoopNetUsd) && item.measuredLoopNetUsd > 0).length,
    bestLoop: loops.find((item) => item.exactAmountMatch && Number.isFinite(item.measuredLoopNetUsd) && item.measuredLoopNetUsd > 0) || null,
    closestLoop: loops[0] || null,
    loops: loops.slice(0, 10),
  };
}
