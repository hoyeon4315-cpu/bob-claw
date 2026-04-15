#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveTokenAsset } from "../assets/erc20-metadata.mjs";
import { isBtcFamilyRoute, tokenAsset } from "../assets/tokens.mjs";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { filterTrustedExecutableDexQuotes } from "../dex/odos.mjs";
import { gasUsdFromSnapshot } from "../gas/rpc-gas.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl, latestBy } from "../lib/jsonl-read.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd, isFreshPriceSnapshot, latestPriceSnapshot, overlayObservedPricesUsd, pricesFromSnapshot } from "../market/prices.mjs";
import { scoreGatewayQuote } from "../scoring/gateway-score.mjs";
import { buildShadowOpportunityObservation, observationKey, shouldPersistShadowObservation } from "../shadow/opportunity-observation.mjs";
import { matchesRouteSelection } from "../estimator/route-filter.mjs";
import { buildFundingSourcePlan } from "../treasury/funding-source-planner.mjs";
import { buildTreasuryPlan } from "../treasury/planner.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";

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

function latestDexOutputQuoteByRouteAndAmount(dexQuotes) {
  const latest = new Map();
  for (const quote of filterTrustedExecutableDexQuotes(dexQuotes)) {
    if (quote.source !== "gateway_dst_leg" || !quote.gatewayRouteKey || !quote.gatewayAmount) continue;
    const key = selectionKey(quote.gatewayRouteKey, quote.gatewayAmount);
    const existing = latest.get(key);
    if (!existing || new Date(quote.observedAt) > new Date(existing.observedAt)) {
      latest.set(key, quote);
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
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    touchChains: options["touch-chains"]
      ? options["touch-chains"].split(",").map((item) => item.trim()).filter(Boolean)
      : [],
    dstChains: options["dst-chains"]
      ? options["dst-chains"].split(",").map((item) => item.trim()).filter(Boolean)
      : [],
    shadowRolloverMs: options["shadow-rollover-ms"] ? Number(options["shadow-rollover-ms"]) : null,
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function preferredScoreUsd(score) {
  return (
    score.effectiveSystemNetPnlUsd ??
    score.treasuryAdjustedExecutableNetEdgeUsd ??
    score.executableNetEdgeUsd ??
    score.treasuryAdjustedNetEdgeUsd ??
    score.netEdgeUsd ??
    Number.NEGATIVE_INFINITY
  );
}

function sortScores(scores) {
  return [...scores].sort(
    (a, b) => preferredScoreUsd(b) - preferredScoreUsd(a) || a.routeKey.localeCompare(b.routeKey),
  );
}

function summarizeScores(scores, maxRouteFailureRate) {
  return {
    shadowCandidates: scores.filter((score) => score.tradeReadiness === "shadow_candidate_review_only").length,
    dexBacked: scores.filter((score) => score.dex).length,
    insufficientData: scores.filter((score) => score.tradeReadiness === "insufficient_data").length,
    highFailureRate: scores.filter((score) => (score.routeStats?.failureRate ?? 0) > maxRouteFailureRate).length,
    staleGas: scores.filter((score) => score.dataGaps.includes("stale_src_gas_snapshot")).length,
    missingDecimals: scores.filter(
      (score) => score.dataGaps.includes("missing_src_token_decimals") || score.dataGaps.includes("missing_dst_token_decimals"),
    ).length,
  };
}

function selectionKey(routeKey, amount) {
  return `${routeKey}|${amount}`;
}

function mergeScores(existingScores, refreshedScores, replacedKeys) {
  const replaceSet = new Set(replacedKeys);
  return [
    ...(existingScores || []).filter((score) => !replaceSet.has(selectionKey(score.routeKey, score.amount))),
    ...refreshedScores,
  ];
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

function isDexAffectedDstRoute(quote, dstChains = []) {
  if (!quote?.route?.dstChain || !dstChains.includes(quote.route.dstChain)) return false;
  return tokenAsset(quote.route.dstChain, quote.route.dstToken).family === "wrapped_btc";
}

function isTouchedBtcFamilyRoute(quote, touchChains = []) {
  if (!quote?.route || touchChains.length === 0) return false;
  if (!isBtcFamilyRoute(quote.route)) return false;
  return touchChains.includes(quote.route.srcChain) || touchChains.includes(quote.route.dstChain);
}

function sameAddress(left, right) {
  return String(left || "").toLowerCase() !== "" && String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function latestInventoryForAddress(records, address) {
  const filtered = address ? records.filter((item) => sameAddress(item.address, address)) : records;
  return [...filtered].sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0))[0] || null;
}

function routeDemandFromQuote(quote) {
  return [
    { chain: quote.route.srcChain },
    { chain: quote.route.srcChain, token: quote.route.srcToken },
  ];
}

function routeContextFromScore(score) {
  return {
    routeKey: score.routeKey,
    amount: score.amount,
    inputUsd: score.inputUsd ?? null,
    netEdgeUsd: score.netEdgeUsd ?? null,
    executableNetEdgeUsd: score.executableNetEdgeUsd ?? null,
    knownCostUsd: score.knownCostUsd ?? null,
    routeFailureRate: score.routeStats?.failureRate ?? null,
    tradeReadiness: score.tradeReadiness ?? null,
  };
}

function buildFundingSourcePlanForQuote({ quote, score, inventory, policy }) {
  if (!inventory) return null;
  const treasuryPlan = buildTreasuryPlan({
    policy,
    inventory,
    routeDemand: routeDemandFromQuote(quote),
  });
  return buildFundingSourcePlan({
    plan: treasuryPlan,
    policy,
    routeContext: routeContextFromScore(score),
  });
}

function assetText(asset) {
  return `${asset.ticker}/${asset.decimals ?? "?"}d`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ((args.routeKey && !args.amount) || (!args.routeKey && args.amount)) {
    throw new Error("Pass both --route-key and --amount together for selective scoring");
  }
  if (args.routeKey && (args.dstChains.length > 0 || args.touchChains.length > 0)) {
    throw new Error("Use either exact route selection or chain selection, not both");
  }
  if (args.dstChains.length > 0 && args.touchChains.length > 0) {
    throw new Error("Use either --dst-chains or --touch-chains, not both");
  }
  const now = new Date().toISOString();
  const scorePath = join(config.dataDir, "gateway-scores.json");
  const allQuotes = await readJsonl(config.dataDir, "gateway-quotes");
  const failures = await readJsonl(config.dataDir, "gateway-quote-failures");
  const dexQuotes = await readJsonl(config.dataDir, "dex-quotes");
  const priceSnapshots = await readJsonl(config.dataDir, "market-price-snapshots");
  const bitcoinFeeSnapshots = await readJsonl(config.dataDir, "bitcoin-fee-snapshots");
  const gasEstimateSnapshots = await readJsonl(config.dataDir, "gateway-gas-estimates");
  const gasSnapshotRecords = await readJsonl(config.dataDir, "gas-snapshots");
  const inventoryRecords = await readJsonl(config.dataDir, "treasury-inventory");
  const shadowObservationRecords = args.write ? await readJsonl(config.dataDir, "gateway-shadow-observations") : [];
  const latestQuotes = latestByRouteAndAmount(allQuotes);
  const routeStats = routeStatsByKey(allQuotes, failures);
  const dexOutputQuotes = latestDexOutputQuoteByRouteAndAmount(dexQuotes);
  const gasEstimates = latestByRouteAndAmountMap(gasEstimateSnapshots);
  const gasSnapshots = latestBy(gasSnapshotRecords, (snapshot) => snapshot.chain);
  const bitcoinFee = bitcoinFeeSnapshots.at(-1) || null;
  const latestObservedPrices = latestPriceSnapshot(priceSnapshots);
  const useObservedPrices = latestObservedPrices && isFreshPriceSnapshot(latestObservedPrices, { now });
  const livePrices = useObservedPrices ? null : await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const basePrices = useObservedPrices ? pricesFromSnapshot(latestObservedPrices) : livePrices;
  const prices = overlayObservedPricesUsd(basePrices, {
    gasSnapshots: gasSnapshotRecords,
    bitcoinFeeSnapshots,
  });
  const resolved = await resolveOperationalAddress({ dataDir: config.dataDir });
  const latestInventory = latestInventoryForAddress(inventoryRecords, resolved.address);
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const tokenCache = new Map();
  const maxRouteFailureRate = 0.1;
  const selective = Boolean((args.routeKey && args.amount) || args.dstChains.length > 0 || args.touchChains.length > 0);
  const previousSnapshot = selective && args.write ? await readJsonIfExists(scorePath) : null;
  const selectionFilters = {
    routeKey: args.routeKey,
    amount: args.amount,
    touchChains: args.touchChains,
    dstChains: args.dstChains,
  };
  const quotes = selective
    ? latestQuotes
        .filter((quote) => matchesRouteSelection(quote, selectionFilters))
        .filter((quote) => {
          if (args.dstChains.length > 0) return isDexAffectedDstRoute(quote, args.dstChains);
          if (args.touchChains.length > 0) return isTouchedBtcFamilyRoute(quote, args.touchChains);
          return true;
        })
    : latestQuotes;

  if (args.routeKey && args.amount && quotes.length === 0) {
    throw new Error(`No latest quote found for route ${args.routeKey} amount=${args.amount}`);
  }

  async function resolveCached(chain, token) {
    const key = `${chain}:${String(token).toLowerCase()}`;
    if (!tokenCache.has(key)) {
      tokenCache.set(key, resolveTokenAsset(chain, token));
    }
    return tokenCache.get(key);
  }

  const refreshedScores = [];
  const refreshedShadowObservations = [];
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
    const scoreBaseOptions = {
      srcAsset,
      dstAsset,
      executionGasUsd,
      executionGasSource: exactGas ? "eth_estimateGas" : snapshot ? "fallback_gas_units" : null,
      allowEthereumL1Routes: config.approveEthereumL1Routes,
      gasObservedAt: exactGas?.observedAt || snapshot?.observedAt || null,
      routeStats: routeStats.get(quote.routeKey),
      dexOutputQuote: dexOutputQuotes.get(selectionKey(quote.routeKey, quote.amount)),
      bitcoinFee,
      requireExactExecutionGas: true,
      maxRouteFailureRate,
      gasBufferMultiplier: 2,
      maxGasSnapshotAgeMinutes: 30,
      now,
    };
    const preliminaryScore =
      scoreGatewayQuote(quote, prices, {
        ...scoreBaseOptions,
      });
    const fundingSourcePlan = buildFundingSourcePlanForQuote({
      quote,
      score: preliminaryScore,
      inventory: latestInventory,
      policy,
    });
    const score = scoreGatewayQuote(quote, prices, {
      ...scoreBaseOptions,
      executionRefillExpectedCostUsd: fundingSourcePlan?.summary?.executionRefillExpectedCostUsd ?? null,
      reserveReplenishmentExpectedCostUsd: fundingSourcePlan?.summary?.reserveReplenishmentExpectedCostUsd ?? null,
      expectedFailureCostUsd: fundingSourcePlan?.summary?.expectedFailureCostUsd ?? null,
      capitalFragmentationDragUsd: fundingSourcePlan?.summary?.capitalFragmentationDragUsd ?? null,
      effectiveSystemNetPnlUsd: fundingSourcePlan?.summary?.effectiveSystemNetPnlUsd ?? null,
    });
    refreshedScores.push(score);
    refreshedShadowObservations.push(
      buildShadowOpportunityObservation({
        score,
        fundingSourcePlan,
        now,
        priceObservedAt: useObservedPrices ? latestObservedPrices?.observedAt || null : now,
        inventoryObservedAt: latestInventory?.observedAt || null,
      }),
    );
  }

  const scores = sortScores(
    selective && previousSnapshot
      ? mergeScores(
          previousSnapshot.scores || [],
          refreshedScores,
          quotes.map((quote) => selectionKey(quote.routeKey, quote.amount)),
        )
      : refreshedScores,
  );

  const result = {
    schemaVersion: 1,
    generatedAt: now,
    priceObservedAt: useObservedPrices ? latestObservedPrices.observedAt : now,
    priceSource: useObservedPrices ? latestObservedPrices.source || "snapshot" : "live_fetch",
    btcUsd: prices.btc,
    scoredQuotes: scores.length,
    summary: summarizeScores(scores, maxRouteFailureRate),
    scores,
  };

  if (args.write) {
    await writeFile(scorePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    const store = new JsonlStore(config.dataDir);
    const latestShadowByKey = new Map([...latestBy(shadowObservationRecords, observationKey).entries()]);
    let appendedShadowObservations = 0;
    for (const observation of refreshedShadowObservations) {
      const previousObservation = latestShadowByKey.get(observationKey(observation)) || null;
      const decision = shouldPersistShadowObservation(previousObservation, observation, {
        maxUnchangedAgeMs: Number.isFinite(args.shadowRolloverMs) ? args.shadowRolloverMs : undefined,
      });
      if (!decision.shouldPersist) continue;
      await store.append("gateway-shadow-observations", observation);
      latestShadowByKey.set(observationKey(observation), observation);
      appendedShadowObservations += 1;
    }
    result.shadowObservationAppends = appendedShadowObservations;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`btcUsd=${prices.btc}`);
  console.log(`scoredQuotes=${scores.length}`);
  if (selective) {
    if (args.routeKey) {
      console.log(`selection routeKey=${args.routeKey} amount=${args.amount} refreshed=${refreshedScores.length}`);
    } else if (args.touchChains.length > 0) {
      console.log(`selection touchChains=${args.touchChains.join(",")} refreshed=${refreshedScores.length}`);
    } else {
      console.log(`selection dstChains=${args.dstChains.join(",")} refreshed=${refreshedScores.length}`);
    }
  }
  if (args.write) {
    console.log(`shadowObservations=${result.shadowObservationAppends ?? refreshedShadowObservations.length}`);
  }
  console.log(
    `summary shadowCandidates=${result.summary.shadowCandidates} insufficientData=${result.summary.insufficientData} highFailureRate=${result.summary.highFailureRate} staleGas=${result.summary.staleGas} missingDecimals=${result.summary.missingDecimals}`,
  );

  for (const score of selective ? refreshedScores : scores) {
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
        `refillCost=${formatUsd(score.treasuryExecutionRefillCostUsd)}`,
        `netEdge=${formatUsd(score.netEdgeUsd)}`,
        `execNet=${formatUsd(score.executableNetEdgeUsd)}`,
        `treasuryNet=${formatUsd(score.treasuryAdjustedNetEdgeUsd)}`,
        `treasuryExecNet=${formatUsd(score.treasuryAdjustedExecutableNetEdgeUsd)}`,
        `failureDrag=${formatUsd(score.expectedFailureCostUsd)}`,
        `fragmentationDrag=${formatUsd(score.capitalFragmentationDragUsd)}`,
        `systemNet=${formatUsd(score.effectiveSystemNetPnlUsd)}`,
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
