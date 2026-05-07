import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WBTC_OFT_TOKEN } from "../../assets/tokens.mjs";
import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../../config/gateway-destinations.mjs";

function normalizeChain(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

function observedAtMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : -1;
}

function normalizeJsonlRecord(line) {
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readJsonl(path) {
  try {
    const text = await readFile(path, "utf8");
    return text.split("\n").map(normalizeJsonlRecord).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function routeMatches(record, { srcChain, dstChain, srcToken = WBTC_OFT_TOKEN, dstToken = WBTC_OFT_TOKEN }) {
  const route = record?.route || {};
  return (
    normalizeChain(route.srcChain) === normalizeChain(srcChain) &&
    normalizeChain(route.dstChain) === normalizeChain(dstChain) &&
    normalizeToken(route.srcToken) === normalizeToken(srcToken) &&
    normalizeToken(route.dstToken) === normalizeToken(dstToken)
  );
}

function latestRecord(records = [], predicate = () => true) {
  let winner = null;
  let winnerMs = -1;
  for (const record of records) {
    if (!predicate(record)) continue;
    const ms = observedAtMs(record.observedAt || record.timestamp || record.generatedAt);
    if (ms >= winnerMs) {
      winner = record;
      winnerMs = ms;
    }
  }
  return winner;
}

function latestValidQuote(quotes = [], route) {
  return latestRecord(
    quotes,
    (quote) =>
      routeMatches(quote, route) &&
      Number.isFinite(Number(quote.grossOutputRatio)) &&
      Number(quote.grossOutputRatio) > 0,
  );
}

function latestFailure(failures = [], route) {
  return latestRecord(failures, (failure) => routeMatches(failure, route));
}

function quoteEvidence(quote) {
  if (!quote) return null;
  return {
    status: "quote_found",
    observedAt: quote.observedAt || null,
    routeKey: quote.routeKey || null,
    amount: quote.amount || null,
    outputAmount: quote.outputAmount || null,
    fees: quote.fees || null,
    executionFees: quote.executionFees || null,
    txValueWei: quote.txValueWei || null,
    txDataBytes: Number.isFinite(quote.txDataBytes) ? quote.txDataBytes : null,
    estimatedTimeInSecs: Number.isFinite(quote.estimatedTimeInSecs) ? quote.estimatedTimeInSecs : null,
    feeRatio: Number.isFinite(quote.feeRatio) ? quote.feeRatio : null,
    grossOutputRatio: Number.isFinite(quote.grossOutputRatio) ? quote.grossOutputRatio : null,
    quoteType: quote.quoteType || null,
  };
}

function failureEvidence(failure) {
  if (!failure) return null;
  return {
    status: "failure_found",
    observedAt: failure.observedAt || null,
    routeKey: failure.routeKey || null,
    amount: failure.amount || null,
    errorName: failure.error?.name || null,
    errorMessage: failure.error?.message || null,
    statusCode: failure.error?.details?.status || null,
  };
}

function routeEvidence({ quote, failure, notRequired = false }) {
  if (notRequired) return { status: "not_required" };
  const quoteProof = quoteEvidence(quote);
  if (quoteProof) return quoteProof;
  const failureProof = failureEvidence(failure);
  if (failureProof) return failureProof;
  return { status: "missing_quote_proof" };
}

function rowStatus({ toBob, bobToBitcoin, currentPreview = null }) {
  if (currentPreview?.status === "preview" && currentPreview?.executionEligible === false) {
    return "cost_preview_available";
  }
  if (toBob.status === "quote_found" && bobToBitcoin.status === "quote_found") return "quote_proven";
  if (toBob.status === "not_required" && bobToBitcoin.status === "quote_found") return "quote_proven";
  if (toBob.status === "failure_found" || bobToBitcoin.status === "failure_found") return "quote_blocked";
  return "missing_quote_proof";
}

function statusCounts(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  return counts;
}

export function buildPaybackQuoteProofMatrix({
  gatewayQuotes = [],
  gatewayFailures = [],
  preMinimumCompositePreview = null,
  compositePreview = null,
  reserveChain = "base",
  officialChains = OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  now = new Date().toISOString(),
} = {}) {
  const bobToBitcoinRoute = {
    srcChain: "bob",
    dstChain: "bitcoin",
    srcToken: WBTC_OFT_TOKEN,
    dstToken: "0x0000000000000000000000000000000000000000",
  };
  const bobToBitcoinQuote = latestValidQuote(gatewayQuotes, bobToBitcoinRoute);
  const bobToBitcoinFailure = latestFailure(gatewayFailures, bobToBitcoinRoute);
  const currentPreview = preMinimumCompositePreview || compositePreview || null;
  const rows = officialChains.map((chain) => {
    const toBobRoute = {
      srcChain: chain,
      dstChain: "bob",
      srcToken: WBTC_OFT_TOKEN,
      dstToken: WBTC_OFT_TOKEN,
    };
    const toBobQuote = chain === "bob" ? null : latestValidQuote(gatewayQuotes, toBobRoute);
    const toBobFailure = chain === "bob" ? null : latestFailure(gatewayFailures, toBobRoute);
    const toBob = routeEvidence({ quote: toBobQuote, failure: toBobFailure, notRequired: chain === "bob" });
    const bobToBitcoin = routeEvidence({ quote: bobToBitcoinQuote, failure: bobToBitcoinFailure });
    const isCurrentReserveChain = normalizeChain(chain) === normalizeChain(reserveChain);
    const currentRoutePreview = isCurrentReserveChain ? currentPreview : null;
    return {
      chain,
      isCurrentReserveChain,
      status: rowStatus({ toBob, bobToBitcoin, currentPreview: currentRoutePreview }),
      executionEligible: false,
      intentEligible: false,
      route: {
        toBob: chain === "bob" ? null : toBobRoute,
        bobToBitcoin: bobToBitcoinRoute,
      },
      evidence: {
        toBob,
        bobToBitcoin,
        currentRoutePreview: currentRoutePreview
          ? {
              status: currentRoutePreview.status || null,
              reason: currentRoutePreview.reason || null,
              previewInputSats: currentRoutePreview.previewInputSats ?? null,
              estimatedOfframpCostSats: currentRoutePreview.estimatedOfframpCostSats ?? null,
              satsToMinimumAfterCosts: currentRoutePreview.satsToMinimumAfterCosts ?? null,
              executionEligible: currentRoutePreview.executionEligible === true,
              intentEligible: currentRoutePreview.intentEligible === true,
            }
          : null,
      },
    };
  });
  return {
    schemaVersion: 1,
    observedAt: now,
    kind: "payback_quote_proof_matrix",
    readOnly: true,
    executionEligible: false,
    intentEligible: false,
    reserveChain,
    officialChainCount: officialChains.length,
    statusCounts: statusCounts(rows),
    rows,
  };
}

export async function buildPaybackQuoteProofMatrixFromFiles({
  dataDir,
  gatewayQuotesPath = null,
  gatewayFailuresPath = null,
  ...options
} = {}) {
  if (!dataDir) throw new Error("dataDir is required");
  const quotesPath = gatewayQuotesPath || join(dataDir, "gateway-quotes.jsonl");
  const failuresPath = gatewayFailuresPath || join(dataDir, "gateway-quote-failures.jsonl");
  const [gatewayQuotes, gatewayFailures] = await Promise.all([
    readJsonl(quotesPath),
    readJsonl(failuresPath),
  ]);
  return buildPaybackQuoteProofMatrix({
    ...options,
    gatewayQuotes,
    gatewayFailures,
  });
}
