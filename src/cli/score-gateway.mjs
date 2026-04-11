#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveTokenAsset } from "../assets/erc20-metadata.mjs";
import { config } from "../config/env.mjs";
import { gasUsdFromSnapshot } from "../gas/rpc-gas.mjs";
import { readJsonl, latestBy } from "../lib/jsonl-read.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd, overlayObservedPricesUsd } from "../market/prices.mjs";
import { scoreGatewayQuote } from "../scoring/gateway-score.mjs";

function latestByRouteAndAmount(quotes) {
  const latest = new Map();
  for (const quote of quotes) {
    if (!quote.quoteType || !quote.routeKey || !quote.inputAmount || !quote.outputAmount) continue;
    const key = `${quote.routeKey}|${quote.amount}`;
    const existing = latest.get(key);
    if (!existing || new Date(quote.observedAt) > new Date(existing.observedAt)) {
      latest.set(key, quote);
    }
  }
  return [...latest.values()];
}

function routeStatsByKey(quotes, failures) {
  const stats = new Map();
  const touch = (routeKey) => {
    if (!stats.has(routeKey)) {
      stats.set(routeKey, { routeKey, quoteCount: 0, failureCount: 0, failureRate: 0 });
    }
    return stats.get(routeKey);
  };

  for (const quote of quotes) {
    if (!quote.routeKey) continue;
    touch(quote.routeKey).quoteCount += 1;
  }
  for (const failure of failures) {
    if (!failure.routeKey) continue;
    touch(failure.routeKey).failureCount += 1;
  }
  for (const item of stats.values()) {
    const total = item.quoteCount + item.failureCount;
    item.failureRate = total > 0 ? item.failureCount / total : 0;
  }
  return stats;
}

function latestDexOutputQuoteByRoute(dexQuotes) {
  const latest = new Map();
  for (const quote of dexQuotes) {
    if (quote.source !== "gateway_dst_leg" || !quote.gatewayRouteKey) continue;
    const existing = latest.get(quote.gatewayRouteKey);
    if (!existing || new Date(quote.observedAt) > new Date(existing.observedAt)) {
      latest.set(quote.gatewayRouteKey, quote);
    }
  }
  return latest;
}

function latestByRouteAndAmountMap(items) {
  const latest = new Map();
  for (const item of items) {
    if (!item.routeKey || !item.amount) continue;
    const key = `${item.routeKey}|${item.amount}`;
    const existing = latest.get(key);
    if (!existing || new Date(item.observedAt) > new Date(existing.observedAt)) {
      latest.set(key, item);
    }
  }
  return latest;
}

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 4 : 6)}`;
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(4)}%`;
}

function formatMinutes(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)}m`;
}

function assetText(asset) {
  return `${asset.ticker}/${asset.decimals ?? "?"}d`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date().toISOString();
  const allQuotes = await readJsonl(config.dataDir, "gateway-quotes");
  const failures = await readJsonl(config.dataDir, "gateway-quote-failures");
  const dexQuotes = await readJsonl(config.dataDir, "dex-quotes");
  const bitcoinFeeSnapshots = await readJsonl(config.dataDir, "bitcoin-fee-snapshots");
  const gasEstimateSnapshots = await readJsonl(config.dataDir, "gateway-gas-estimates");
  const gasSnapshotRecords = await readJsonl(config.dataDir, "gas-snapshots");
  const quotes = latestByRouteAndAmount(allQuotes);
  const routeStats = routeStatsByKey(allQuotes, failures);
  const dexOutputQuotes = latestDexOutputQuoteByRoute(dexQuotes);
  const gasEstimates = latestByRouteAndAmountMap(gasEstimateSnapshots);
  const gasSnapshots = latestBy(gasSnapshotRecords, (snapshot) => snapshot.chain);
  const bitcoinFee = bitcoinFeeSnapshots.at(-1) || null;
  const livePrices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const prices = overlayObservedPricesUsd(livePrices, {
    gasSnapshots: gasSnapshotRecords,
    bitcoinFeeSnapshots,
  });
  const tokenCache = new Map();
  const maxRouteFailureRate = 0.1;

  async function resolveCached(chain, token) {
    const key = `${chain}:${String(token).toLowerCase()}`;
    if (!tokenCache.has(key)) {
      tokenCache.set(key, resolveTokenAsset(chain, token));
    }
    return tokenCache.get(key);
  }

  const scores = [];
  for (const quote of quotes) {
    const snapshot = gasSnapshots.get(quote.route.srcChain);
    const [srcAsset, dstAsset] = await Promise.all([
      resolveCached(quote.route.srcChain, quote.route.srcToken),
      resolveCached(quote.route.dstChain, quote.route.dstToken),
    ]);
    const exactGas = gasEstimates.get(`${quote.routeKey}|${quote.amount}`) || null;
    const executionGasUsd = Number.isFinite(exactGas?.estimatedGasUsd)
      ? exactGas.estimatedGasUsd
      : snapshot
        ? gasUsdFromSnapshot(snapshot, prices.nativeByChain[quote.route.srcChain])
        : null;
    scores.push(
      scoreGatewayQuote(quote, prices, {
        srcAsset,
        dstAsset,
        executionGasUsd,
        executionGasSource: exactGas ? "eth_estimateGas" : snapshot ? "fallback_gas_units" : null,
        gasObservedAt: exactGas?.observedAt || snapshot?.observedAt || null,
        routeStats: routeStats.get(quote.routeKey),
        dexOutputQuote: dexOutputQuotes.get(quote.routeKey),
        bitcoinFee,
        requireExactExecutionGas: true,
        maxRouteFailureRate,
        gasBufferMultiplier: 2,
        maxGasSnapshotAgeMinutes: 30,
        now,
      }),
    );
  }

  scores.sort((a, b) => (b.netEdgeUsd ?? -Infinity) - (a.netEdgeUsd ?? -Infinity) || a.routeKey.localeCompare(b.routeKey));

  const result = {
    schemaVersion: 1,
    generatedAt: now,
    priceObservedAt: now,
    btcUsd: prices.btc,
    scoredQuotes: scores.length,
    summary: {
      shadowCandidates: scores.filter((score) => score.tradeReadiness === "shadow_candidate_review_only").length,
      dexBacked: scores.filter((score) => score.dex).length,
      insufficientData: scores.filter((score) => score.tradeReadiness === "insufficient_data").length,
      highFailureRate: scores.filter((score) => (score.routeStats?.failureRate ?? 0) > maxRouteFailureRate).length,
      staleGas: scores.filter((score) => score.dataGaps.includes("stale_src_gas_snapshot")).length,
      missingDecimals: scores.filter(
        (score) => score.dataGaps.includes("missing_src_token_decimals") || score.dataGaps.includes("missing_dst_token_decimals"),
      ).length,
    },
    scores,
  };

  if (args.write) {
    const path = join(config.dataDir, "gateway-scores.json");
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`btcUsd=${prices.btc}`);
  console.log(`scoredQuotes=${scores.length}`);
  console.log(
    `summary shadowCandidates=${result.summary.shadowCandidates} insufficientData=${result.summary.insufficientData} highFailureRate=${result.summary.highFailureRate} staleGas=${result.summary.staleGas} missingDecimals=${result.summary.missingDecimals}`,
  );

  for (const score of scores) {
    console.log(
      [
        `${score.srcChain}->${score.dstChain}`,
        `type=${score.quoteType}`,
        `asset=${assetText(score.srcAsset)}->${assetText(score.dstAsset)}`,
        `amount=${score.amount}`,
        `input=${formatUsd(score.inputUsd)}`,
        `output=${formatUsd(score.outputUsd)}`,
        `tokenDelta=${formatUsd(score.tokenDeltaUsd)}`,
        `nativeCost=${formatUsd(score.nativeCostUsd)}`,
        `execGas=${formatUsd(score.executionGasUsd)}`,
        `execGasSource=${score.executionGasSource || "none"}`,
        `btcFee=${formatUsd(score.bitcoinFeeUsd)}`,
        `gasBuffer=${formatUsd(score.gasShockBufferUsd)}`,
        `knownCost=${formatUsd(score.knownCostUsd)}`,
        `netEdge=${formatUsd(score.netEdgeUsd)}`,
        `execNet=${formatUsd(score.executableNetEdgeUsd)}`,
        `edge=${formatPct(score.netEdgePct)}`,
        `execEdge=${formatPct(score.executableNetEdgePct)}`,
        `failRate=${formatPct(score.routeStats?.failureRate)}`,
        `dex=${score.dex ? `${score.dex.provider}:${formatUsd(score.dex.netOutputValueUsd)}` : "none"}`,
        `breakEven=${formatPct(score.breakEvenPct)}`,
        `gasAge=${formatMinutes(score.gasSnapshotAgeMinutes)}`,
        `eta=${score.estimatedTimeInSecs ?? "n/a"}s`,
        `readiness=${score.tradeReadiness}`,
        `gaps=${score.dataGaps.join("|") || "none"}`,
      ].join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
