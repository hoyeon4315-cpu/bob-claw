#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { tokenAsset, isBtcLikeAsset, isBtcFamilyRoute } from "../assets/tokens.mjs";
import { GatewayClient, routeKey } from "../gateway/client.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { getCoinGeckoPricesUsd, priceForAssetUsd } from "../market/prices.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_USD_LADDER = [25, 50, 100, 250];
const POLICY_HAIRCUT_THRESHOLD_PCT = 0.25;

// ── Route family classification ──────────────────────────────────────────────

export function classifyRouteFamily(route) {
  const src = tokenAsset(route?.srcChain, route?.srcToken);
  const dst = tokenAsset(route?.dstChain, route?.dstToken);
  const srcBtc = isBtcLikeAsset(src);
  const dstBtc = isBtcLikeAsset(dst);
  const srcStable = src.family === "stablecoin";
  const dstStable = dst.family === "stablecoin";

  if (srcBtc && dstBtc) return "btc_wrap";
  if (srcBtc || dstBtc) return "btc_swap";
  if (srcStable || dstStable) return "stablecoin_swap";
  if (src.family === "native_or_wrapped" || dst.family === "native_or_wrapped") return "native_swap";
  return "other";
}

// ── USD → token-amount conversion ────────────────────────────────────────────

export function usdToTokenAmount(targetUsd, asset, prices) {
  const priceUsd = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  if (!Number.isInteger(asset.decimals) || asset.decimals < 0) return null;
  const tokenUnits = (targetUsd / priceUsd) * 10 ** asset.decimals;
  return BigInt(Math.round(tokenUnits)).toString();
}

// ── Quote type extraction ────────────────────────────────────────────────────

function extractQuoteType(body) {
  if (body.onramp) return "onramp";
  if (body.offramp) return "offramp";
  if (body.layerZero) return "layerZero";
  return "unknown";
}

function extractQuotePayload(body) {
  return body.onramp || body.offramp || body.layerZero || body;
}

// ── Summary statistics ───────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function buildScanSummary(ladderResults) {
  const succeeded = ladderResults.filter((r) => r.success);
  const latencies = succeeded.map((r) => r.latencyMs).sort((a, b) => a - b);
  const haircuts = succeeded.map((r) => r.netHaircutPct).filter(Number.isFinite);
  const estimatedTimes = succeeded.map((r) => r.estimatedTimeInSecs).filter(Number.isFinite);
  const bestHaircut = haircuts.length > 0 ? Math.min(...haircuts) : null;

  return {
    quotesAttempted: ladderResults.length,
    quotesSucceeded: succeeded.length,
    failureRate: ladderResults.length > 0 ? 1 - succeeded.length / ladderResults.length : null,
    bestHaircutPct: bestHaircut,
    worstHaircutPct: haircuts.length > 0 ? Math.max(...haircuts) : null,
    medianLatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    estimatedTimeInSecs: estimatedTimes.length > 0 ? Math.max(...estimatedTimes) : null,
    policyViable: Number.isFinite(bestHaircut) && bestHaircut < POLICY_HAIRCUT_THRESHOLD_PCT,
  };
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

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
    routeLimit: options["route-limit"] ? Number(options["route-limit"]) : null,
    routeKeys: options["route-key"] ? options["route-key"].split(",").map((value) => value.trim()).filter(Boolean) : null,
    family: options.family || null,
    chains: options.chains ? options.chains.split(",").map((c) => c.trim()).filter(Boolean) : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core scan logic (importable) ─────────────────────────────────────────────

export async function scanQuoteSurface(options = {}) {
  const {
    client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
    store = new JsonlStore(config.dataDir),
    prices: injectedPrices = null,
    usdLadder = DEFAULT_USD_LADDER,
    routeLimit = null,
    routeKeyFilter = null,
    familyFilter = null,
    chainsFilter = null,
    requestDelayMs = config.requestDelayMs,
    recipient = config.verifyRecipient,
    btcRecipient = config.verifyBtcRecipient,
    slippageBps = config.slippageBps,
    onProgress = null,
  } = options;

  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;

  // 1. Fetch prices
  const prices = injectedPrices || await getCoinGeckoPricesUsd();

  // 2. Fetch routes
  const routesResult = await client.getRoutes();
  const allRoutes = routesResult.body;

  // 3. Classify and filter
  let routes = allRoutes.map((route) => ({
    ...route,
    _family: classifyRouteFamily(route),
    _routeKey: routeKey(route),
  }));

  if (familyFilter) {
    routes = routes.filter((r) => r._family === familyFilter);
  }
  if (routeKeyFilter?.length) {
    const routeKeySet = new Set(routeKeyFilter);
    routes = routes.filter((r) => routeKeySet.has(r._routeKey));
  }
  if (chainsFilter && chainsFilter.length > 0) {
    const chainSet = new Set(chainsFilter);
    routes = routes.filter((r) => chainSet.has(r.srcChain) || chainSet.has(r.dstChain));
  }

  const totalRoutes = allRoutes.length;
  const filteredCount = routes.length;
  const scannedLimit = Number.isFinite(routeLimit) && routeLimit > 0 ? routeLimit : filteredCount;
  const routesToScan = routes.slice(0, scannedLimit);

  // 4. Scan each route
  const scanRecords = [];

  for (let routeIndex = 0; routeIndex < routesToScan.length; routeIndex += 1) {
    const route = routesToScan[routeIndex];
    const srcAsset = tokenAsset(route.srcChain, route.srcToken);
    const dstAsset = tokenAsset(route.dstChain, route.dstToken);
    const srcPriceUsd = priceForAssetUsd(srcAsset, prices);
    const dstPriceUsd = priceForAssetUsd(dstAsset, prices);

    const ladderResults = [];

    for (let ladderIndex = 0; ladderIndex < usdLadder.length; ladderIndex += 1) {
      const targetUsd = usdLadder[ladderIndex];
      const inputAmount = usdToTokenAmount(targetUsd, srcAsset, prices);

      if (!inputAmount) {
        ladderResults.push({
          targetUsd,
          inputAmount: null,
          outputAmount: null,
          inputUsd: null,
          outputUsd: null,
          haircutPct: null,
          nativeFeeUsd: null,
          netHaircutPct: null,
          latencyMs: null,
          estimatedTimeInSecs: null,
          success: false,
          error: "missing_price_or_decimals",
        });
        continue;
      }

      const quoteParams = {
        srcChain: route.srcChain,
        dstChain: route.dstChain,
        srcToken: route.srcToken,
        dstToken: route.dstToken,
        amount: inputAmount,
        recipient: route.dstChain === "bitcoin" ? btcRecipient : recipient,
        slippage: slippageBps,
      };
      if (route.srcChain !== "bitcoin") {
        quoteParams.sender = recipient;
      }

      try {
        const quoteResult = await client.getQuote(quoteParams);
        const quoteType = extractQuoteType(quoteResult.body);
        const quote = extractQuotePayload(quoteResult.body);

        const rawInput = BigInt(quote.inputAmount?.amount || inputAmount);
        const rawOutput = BigInt(quote.outputAmount?.amount || 0);
        const txValue = BigInt(quote.tx?.value || 0);

        const inputDecimal = Number(rawInput) / 10 ** (srcAsset.decimals || 0);
        const outputDecimal = Number(rawOutput) / 10 ** (dstAsset.decimals || 0);
        const inputUsd = Number.isFinite(srcPriceUsd) ? inputDecimal * srcPriceUsd : null;
        const outputUsd = Number.isFinite(dstPriceUsd) ? outputDecimal * dstPriceUsd : null;

        // Native fee: txValue is in wei of the source chain's native token
        let nativeFeeUsd = null;
        if (txValue > 0n) {
          const nativePrice = prices?.nativeByChain?.[route.srcChain] ?? null;
          if (Number.isFinite(nativePrice)) {
            nativeFeeUsd = (Number(txValue) / 1e18) * nativePrice;
          }
        }

        const haircutPct =
          Number.isFinite(inputUsd) && Number.isFinite(outputUsd) && inputUsd > 0
            ? (1 - outputUsd / inputUsd) * 100
            : null;

        const netHaircutPct =
          Number.isFinite(haircutPct) && Number.isFinite(nativeFeeUsd) && Number.isFinite(inputUsd) && inputUsd > 0
            ? haircutPct + (nativeFeeUsd / inputUsd) * 100
            : haircutPct;

        // Store quoteType on first success for the record-level field
        if (!route._quoteType) route._quoteType = quoteType;

        ladderResults.push({
          targetUsd,
          inputAmount: rawInput.toString(),
          outputAmount: rawOutput.toString(),
          inputUsd: inputUsd !== null ? Math.round(inputUsd * 100) / 100 : null,
          outputUsd: outputUsd !== null ? Math.round(outputUsd * 100) / 100 : null,
          haircutPct: haircutPct !== null ? Math.round(haircutPct * 100) / 100 : null,
          nativeFeeUsd: nativeFeeUsd !== null ? Math.round(nativeFeeUsd * 100) / 100 : null,
          netHaircutPct: netHaircutPct !== null ? Math.round(netHaircutPct * 100) / 100 : null,
          latencyMs: quoteResult.latencyMs,
          estimatedTimeInSecs: quote.estimatedTimeInSecs ?? null,
          success: true,
        });
      } catch (error) {
        ladderResults.push({
          targetUsd,
          inputAmount,
          outputAmount: null,
          inputUsd: null,
          outputUsd: null,
          haircutPct: null,
          nativeFeeUsd: null,
          netHaircutPct: null,
          latencyMs: null,
          estimatedTimeInSecs: null,
          success: false,
          error: error.message,
        });
      }

      // Delay between ladder steps
      const hasMoreInLadder = ladderIndex < usdLadder.length - 1;
      if (hasMoreInLadder && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }
    }

    const summary = buildScanSummary(ladderResults);
    const record = {
      schemaVersion: SCHEMA_VERSION,
      observedAt: new Date().toISOString(),
      runId,
      routeKey: route._routeKey,
      route: {
        srcChain: route.srcChain,
        dstChain: route.dstChain,
        srcToken: route.srcToken,
        dstToken: route.dstToken,
      },
      family: route._family,
      quoteType: route._quoteType || "unknown",
      amountLadder: ladderResults,
      summary,
    };

    await store.append("quote-surface-scans", record);
    scanRecords.push(record);

    if (onProgress) {
      onProgress({
        routeIndex: routeIndex + 1,
        totalRoutes: routesToScan.length,
        routeKey: route._routeKey,
        family: route._family,
        bestHaircutPct: summary.bestHaircutPct,
        policyViable: summary.policyViable,
      });
    }

    // Delay between routes
    if (routeIndex < routesToScan.length - 1 && requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  return {
    runId,
    observedAt: new Date().toISOString(),
    totalRoutes,
    filteredRoutes: filteredCount,
    scannedRoutes: routesToScan.length,
    skippedRoutes: filteredCount - routesToScan.length,
    records: scanRecords,
  };
}

// ── CLI output formatting ────────────────────────────────────────────────────

function printSummaryTable(result) {
  const now = new Date().toISOString();
  console.log(`\nQuote Surface Scan - ${now}`);
  console.log(
    `Routes: ${result.totalRoutes} total, ${result.scannedRoutes} scanned, ${result.skippedRoutes} skipped`,
  );

  const families = new Map();
  for (const record of result.records) {
    const family = record.family;
    if (!families.has(family)) {
      families.set(family, { routes: 0, succeeded: 0, attempted: 0, bestHaircut: null, policyViable: 0 });
    }
    const group = families.get(family);
    group.routes += 1;
    group.attempted += record.summary.quotesAttempted;
    group.succeeded += record.summary.quotesSucceeded;
    if (Number.isFinite(record.summary.bestHaircutPct)) {
      group.bestHaircut =
        group.bestHaircut === null
          ? record.summary.bestHaircutPct
          : Math.min(group.bestHaircut, record.summary.bestHaircutPct);
    }
    if (record.summary.policyViable) group.policyViable += 1;
  }

  const FAMILY_ORDER = ["btc_wrap", "btc_swap", "stablecoin_swap", "native_swap", "other"];
  const sortedFamilies = [...families.entries()].sort(
    (a, b) => FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0]),
  );

  console.log("");
  console.log(
    padRight("Family", 20) +
      padRight("Routes", 10) +
      padRight("Success%", 12) +
      padRight("Best Haircut", 14) +
      "Policy Viable",
  );
  console.log("─".repeat(69));

  for (const [family, group] of sortedFamilies) {
    const successPct =
      group.attempted > 0 ? `${((group.succeeded / group.attempted) * 100).toFixed(1)}%` : "n/a";
    const bestHaircut = Number.isFinite(group.bestHaircut) ? `${group.bestHaircut.toFixed(2)}%` : "n/a";
    const viable = group.policyViable > 0 ? `yes (${group.policyViable})` : "no";

    console.log(
      padRight(family, 20) +
        padRight(String(group.routes), 10) +
        padRight(successPct, 12) +
        padRight(bestHaircut, 14) +
        viable,
    );
  }

  console.log("");
}

function padRight(str, len) {
  return String(str).padEnd(len);
}

function printRouteProgress(info) {
  const haircutStr = Number.isFinite(info.bestHaircutPct)
    ? `haircut=${info.bestHaircutPct.toFixed(2)}%`
    : "haircut=n/a";
  const viableStr = info.policyViable ? "VIABLE" : "";
  console.log(
    `[${info.routeIndex}/${info.totalRoutes}] ${info.family} ${info.routeKey} ${haircutStr} ${viableStr}`.trim(),
  );
}

// ── Main entry point ─────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = await scanQuoteSurface({
    routeLimit: args.routeLimit,
    routeKeyFilter: args.routeKeys,
    familyFilter: args.family,
    chainsFilter: args.chains,
    onProgress: args.json ? null : printRouteProgress,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printSummaryTable(result);
  }
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
