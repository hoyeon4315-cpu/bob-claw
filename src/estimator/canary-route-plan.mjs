import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { latestBy } from "../lib/jsonl-read.mjs";

const DISQUALIFYING_SCORE_GAPS = new Set([
  "implausible_quote_value_ratio",
  "missing_src_token_decimals",
  "missing_dst_token_decimals",
  "missing_src_token_price",
  "missing_dst_token_price",
  "bitcoin_network_fee_not_modelled",
  "stale_src_gas_snapshot",
]);

function bigint(value) {
  return BigInt(value || 0);
}

function latestByRouteAndAmount(items) {
  return [...latestBy(items, (item) => `${item.routeKey}|${item.amount}`).values()];
}

function mapByRouteAndAmount(items) {
  return new Map(latestByRouteAndAmount(items).map((item) => [`${item.routeKey}|${item.amount}`, item]));
}

function nativeShortfallUsd(readiness, prices) {
  if (!readiness?.native?.shortfallWei) return null;
  const nativeUsd = prices?.nativeByChain?.[readiness.srcChain];
  if (!Number.isFinite(nativeUsd)) return null;
  return (Number(bigint(readiness.native.shortfallWei)) / 1e18) * nativeUsd;
}

function tokenShortfallUsd(readiness, score) {
  if (!readiness?.token?.shortfall || !score?.srcAsset) return null;
  const decimals = score.srcAsset.decimals;
  const rawUsd = score.price?.srcRawUsd;
  if (!Number.isInteger(decimals) || !Number.isFinite(rawUsd)) return null;
  const amount = unitsToDecimal(readiness.token.shortfall, decimals);
  if (!Number.isFinite(amount)) return null;
  return amount * rawUsd;
}

function routePrepBlockers(readiness) {
  if (!readiness) return ["wallet_not_checked"];
  const blockers = [];
  if (readiness.native && !readiness.native.ok) blockers.push("native");
  if (readiness.token && !readiness.token.ok) blockers.push("token");
  if (readiness.allowance && !readiness.allowance.ok) blockers.push("allowance");
  return blockers;
}

function disqualifyingGaps(score) {
  return (score?.dataGaps || []).filter((gap) => DISQUALIFYING_SCORE_GAPS.has(gap));
}

function routeLabel(quote) {
  const src = tokenAsset(quote.route.srcChain, quote.route.srcToken);
  const dst = tokenAsset(quote.route.dstChain, quote.route.dstToken);
  return `${quote.route.srcChain}->${quote.route.dstChain} ${src.ticker}->${dst.ticker}`;
}

export function buildCanaryRoutePlan(
  {
    quotes = [],
    scores = [],
    readinessRecords = [],
    readinessFailures = [],
  },
  options = {},
) {
  const prices = options.prices || null;
  const address = options.address || null;
  const latestQuotes = latestByRouteAndAmount(quotes);
  const scoreByKey = new Map(scores.map((score) => [`${score.routeKey}|${score.amount}`, score]));
  const readinessByKey = new Map(
    latestByRouteAndAmount(
      address
        ? readinessRecords.filter((item) => String(item.address || "").toLowerCase() === address.toLowerCase())
        : readinessRecords,
    ).map((item) => [`${item.routeKey}|${item.amount}`, item]),
  );
  const failureByKey = new Map(
    latestByRouteAndAmount(
      address
        ? readinessFailures.filter((item) => String(item.address || "").toLowerCase() === address.toLowerCase())
        : readinessFailures,
    ).map((item) => [`${item.routeKey}|${item.amount}`, item]),
  );

  const candidates = latestQuotes
    .filter((quote) => quote.route?.srcChain !== "bitcoin")
    .map((quote) => {
      const key = `${quote.routeKey}|${quote.amount}`;
      const score = scoreByKey.get(key) || null;
      const readiness = readinessByKey.get(key) || null;
      const readinessFailure = failureByKey.get(key) || null;
      const srcAsset = tokenAsset(quote.route.srcChain, quote.route.srcToken);
      const dstAsset = tokenAsset(quote.route.dstChain, quote.route.dstToken);
      const blockers = routePrepBlockers(readiness);
      const scoreDisqualifiers = disqualifyingGaps(score);
      const txReady = Boolean(quote.txTo && quote.txData);
      const exactGasDone = score?.executionGasSource === "eth_estimateGas";
      const nativeUsd = nativeShortfallUsd(readiness, prices);
      const tokenUsd = tokenShortfallUsd(readiness, score);
      const prepFundingUsd = [nativeUsd, tokenUsd].filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
      const viableForPrep =
        txReady &&
        quote.quoteType === "layerZero" &&
        !readinessFailure &&
        scoreDisqualifiers.length === 0;

      return {
        routeKey: quote.routeKey,
        amount: quote.amount,
        label: routeLabel(quote),
        srcChain: quote.route.srcChain,
        dstChain: quote.route.dstChain,
        srcToken: quote.route.srcToken,
        dstToken: quote.route.dstToken,
        srcTicker: srcAsset.ticker,
        dstTicker: dstAsset.ticker,
        quoteType: quote.quoteType,
        txReady,
        exactGasDone,
        viableForPrep,
        prepBlockers: blockers,
        blockerCount: blockers.length,
        readinessFailureReason: readinessFailure?.reason || null,
        scoreDisqualifiers,
        inputUsd: score?.inputUsd ?? null,
        executableNetEdgeUsd: score?.executableNetEdgeUsd ?? null,
        netEdgeUsd: score?.netEdgeUsd ?? null,
        tradeReadiness: score?.tradeReadiness ?? null,
        prepFundingUsd: Number.isFinite(prepFundingUsd) ? prepFundingUsd : null,
        nativeShortfallUsd: nativeUsd,
        tokenShortfallUsd: tokenUsd,
        readiness: readiness
          ? {
              nativeShortfallWei: readiness.native?.shortfallWei ?? null,
              tokenShortfall: readiness.token?.shortfall ?? null,
              allowanceShortfall: readiness.allowance?.shortfall ?? null,
            }
          : null,
      };
    })
    .sort((left, right) => {
      if (left.viableForPrep !== right.viableForPrep) return left.viableForPrep ? -1 : 1;
      if (left.txReady !== right.txReady) return left.txReady ? -1 : 1;
      if (left.blockerCount !== right.blockerCount) return left.blockerCount - right.blockerCount;
      const leftPrepUsd = Number.isFinite(left.prepFundingUsd) ? left.prepFundingUsd : Number.POSITIVE_INFINITY;
      const rightPrepUsd = Number.isFinite(right.prepFundingUsd) ? right.prepFundingUsd : Number.POSITIVE_INFINITY;
      if (leftPrepUsd !== rightPrepUsd) return leftPrepUsd - rightPrepUsd;
      const leftInputUsd = Number.isFinite(left.inputUsd) ? left.inputUsd : Number.POSITIVE_INFINITY;
      const rightInputUsd = Number.isFinite(right.inputUsd) ? right.inputUsd : Number.POSITIVE_INFINITY;
      if (leftInputUsd !== rightInputUsd) return leftInputUsd - rightInputUsd;
      return left.routeKey.localeCompare(right.routeKey) || String(left.amount).localeCompare(String(right.amount));
    });

  return {
    address,
    candidateCount: candidates.length,
    viableCount: candidates.filter((item) => item.viableForPrep).length,
    txReadyCount: candidates.filter((item) => item.txReady).length,
    topCandidates: candidates.slice(0, options.limit || 10),
    candidates,
  };
}
