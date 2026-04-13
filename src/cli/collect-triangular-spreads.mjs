#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  getTriangleProfile,
  triangleDatasetNames,
  trianglePermutations,
} from "../flash/triangle-profiles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");
const ODOS_API = "https://api.odos.xyz";
const SCHEMA_VERSION = 2;
const CALL_DELAY_MS = 2000;
const FLASH_FEE_PCT = 0.05;

function parseArgs(argv) {
  const flags = new Set(argv.filter((item) => item.startsWith("--") && !item.includes("=")));
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );

  return {
    interval: parseInt(options.interval || "90", 10),
    probeUsdc: parseFloat(options["probe-usdc"] || "250"),
    once: flags.has("--once"),
    json: flags.has("--json"),
    profile: options.profile,
  };
}

// Only route through proven AMMs — oracle-based DEXes give phantom quotes
const ODOS_SOURCE_WHITELIST = [
  "Uniswap V2", "Uniswap V3", "Uniswap V4",
  "Aerodrome", "Aerodrome SlipStream",
  "Curve", "Curve V2",
  "SushiSwap", "SushiSwap V3",
  "BaseSwap", "BaseSwap V3",
  "PancakeSwap V2", "PancakeSwap V3",
  "Maverick V2",
  "Balancer V2", "Balancer V3",
  "DODO", "Velodrome", "Velodrome V2",
  "WooFi", "KyberSwap", "TraderJoe",
  "AlienBase", "DackieSwap",
];

async function odosQuote(chainId, inputAddr, inputAmount, outputAddr) {
  const body = {
    chainId,
    inputTokens: [{ tokenAddress: inputAddr, amount: String(inputAmount) }],
    outputTokens: [{ tokenAddress: outputAddr, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.5,
    disableRFQs: true,
    compact: true,
    sourceWhitelist: ODOS_SOURCE_WHITELIST,
  };
  const start = Date.now();
  const response = await fetch(`${ODOS_API}/sor/quote/v3`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;
  if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, latencyMs };
  const data = await response.json();
  if (!data.outAmounts?.[0]) return { ok: false, error: "no output", latencyMs };
  return {
    ok: true,
    outAmount: data.outAmounts[0],
    gasUsd: data.gasEstimateValue ?? 0,
    impact: data.priceImpact ?? 0,
    latencyMs,
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function round6(number) {
  return Math.round(number * 1e6) / 1e6;
}

function round4(number) {
  return Math.round(number * 1e4) / 1e4;
}

function directProbeAmount(token) {
  return token.assetClass === "eth" ? 0.1 : 0.005;
}

function valueComparable(leftToken, rightToken) {
  return leftToken.assetClass === rightToken.assetClass;
}

async function collectPairwiseSpreads(profile) {
  const pairs = [];

  for (const fromToken of profile.routeTokens) {
    for (const toToken of profile.routeTokens) {
      if (fromToken.symbol === toToken.symbol) continue;
      const probeAmount = directProbeAmount(fromToken);
      const amountRaw = String(Math.round(probeAmount * 10 ** fromToken.decimals));
      try {
        const quote = await odosQuote(profile.chainId, fromToken.address, amountRaw, toToken.address);
        if (quote.ok) {
          const outAmount = parseInt(quote.outAmount, 10) / 10 ** toToken.decimals;
          const comparable = valueComparable(fromToken, toToken);
          const ratio = comparable ? outAmount / probeAmount : null;
          pairs.push({
            from: fromToken.symbol,
            to: toToken.symbol,
            fromAssetClass: fromToken.assetClass,
            toAssetClass: toToken.assetClass,
            inAmount: probeAmount,
            outAmount,
            valueComparable: comparable,
            ratio,
            spreadPct: comparable ? (ratio - 1) * 100 : null,
            gasUsd: quote.gasUsd,
            impact: quote.impact,
            latencyMs: quote.latencyMs,
            ok: true,
          });
        } else {
          pairs.push({ from: fromToken.symbol, to: toToken.symbol, ok: false, error: quote.error });
        }
      } catch (error) {
        pairs.push({ from: fromToken.symbol, to: toToken.symbol, ok: false, error: error.message });
      }
      await sleep(CALL_DELAY_MS);
    }
  }

  return pairs;
}

async function collectTriangularRoutes(profile, probeUsdc) {
  const stable = profile.stableToken;
  const probeRaw = String(Math.round(probeUsdc * 10 ** stable.decimals));
  const routes = [];

  for (const [tokenA, tokenB] of trianglePermutations(profile.id)) {
    const label = `${stable.symbol}→${tokenA.symbol}→${tokenB.symbol}→${stable.symbol}`;

    try {
      const quote1 = await odosQuote(profile.chainId, stable.address, probeRaw, tokenA.address);
      if (!quote1.ok) {
        routes.push({ label, ok: false, error: `leg1: ${quote1.error}` });
        await sleep(CALL_DELAY_MS);
        continue;
      }
      await sleep(CALL_DELAY_MS);

      const quote2 = await odosQuote(profile.chainId, tokenA.address, quote1.outAmount, tokenB.address);
      if (!quote2.ok) {
        routes.push({ label, ok: false, error: `leg2: ${quote2.error}` });
        await sleep(CALL_DELAY_MS);
        continue;
      }
      await sleep(CALL_DELAY_MS);

      const quote3 = await odosQuote(profile.chainId, tokenB.address, quote2.outAmount, stable.address);
      if (!quote3.ok) {
        routes.push({ label, ok: false, error: `leg3: ${quote3.error}` });
        await sleep(CALL_DELAY_MS);
        continue;
      }

      const endUsdc = parseInt(quote3.outAmount, 10) / 10 ** stable.decimals;
      const grossProfit = endUsdc - probeUsdc;
      const totalGas = quote1.gasUsd + quote2.gasUsd + quote3.gasUsd;
      const netProfit = grossProfit - totalGas;
      const netPct = (netProfit / probeUsdc) * 100;
      const flashFeeUsd = (probeUsdc * FLASH_FEE_PCT) / 100;
      const netAfterFlash = netProfit - flashFeeUsd;
      const netAfterFlashPct = (netAfterFlash / probeUsdc) * 100;

      routes.push({
        label,
        ok: true,
        startUsdc: probeUsdc,
        endUsdc,
        grossProfit: round6(grossProfit),
        totalGas: round6(totalGas),
        netProfit: round6(netProfit),
        netPct: round4(netPct),
        flashFeeUsd: round6(flashFeeUsd),
        netAfterFlash: round6(netAfterFlash),
        netAfterFlashPct: round4(netAfterFlashPct),
        profitable: netProfit > 0,
        profitableAfterFlash: netAfterFlash > 0,
        meetsPolicy: netAfterFlashPct >= 0.5,
        totalLatencyMs: quote1.latencyMs + quote2.latencyMs + quote3.latencyMs,
      });
    } catch (error) {
      routes.push({ label, ok: false, error: error.message });
    }

    await sleep(CALL_DELAY_MS);
  }

  return routes;
}

async function collectOneSample(profile, probeUsdc) {
  const observedAt = new Date().toISOString();
  const pairwise = await collectPairwiseSpreads(profile);
  const triangular = await collectTriangularRoutes(profile, probeUsdc);

  const profitableRoutes = triangular.filter((route) => route.ok && route.profitable);
  const policyRoutes = triangular.filter((route) => route.ok && route.meetsPolicy);
  const bestRoute = [...profitableRoutes].sort((left, right) => right.netAfterFlashPct - left.netAfterFlashPct)[0] || null;

  const okPairs = pairwise.filter((pair) => pair.ok);
  const comparablePairs = okPairs.filter((pair) => Number.isFinite(pair.spreadPct));
  const maxSpread = comparablePairs.length ? Math.max(...comparablePairs.map((pair) => Math.abs(pair.spreadPct))) : 0;
  const lbtcPremium = comparablePairs.find((pair) => pair.from === "cbBTC" && pair.to === "LBTC");

  return {
    schemaVersion: SCHEMA_VERSION,
    observedAt,
    probeUsdc,
    profileId: profile.id,
    profileLabel: profile.label,
    pairwise,
    triangular,
    summary: {
      pairCount: pairwise.length,
      pairOk: okPairs.length,
      comparablePairCount: comparablePairs.length,
      maxPairSpreadPct: round4(maxSpread),
      lbtcPremiumPct: lbtcPremium ? round4(lbtcPremium.spreadPct) : null,
      routeCount: triangular.length,
      routeOk: triangular.filter((route) => route.ok).length,
      profitable: profitableRoutes.length,
      profitableAfterFlash: triangular.filter((route) => route.ok && route.profitableAfterFlash).length,
      meetsPolicy: policyRoutes.length,
      bestRoute: bestRoute ? bestRoute.label : null,
      bestNetPct: bestRoute ? bestRoute.netAfterFlashPct : null,
      bestNetUsd: bestRoute ? bestRoute.netAfterFlash : null,
    },
  };
}

function printSample(sample) {
  const timestamp = sample.observedAt.slice(11, 19);
  const summary = sample.summary;

  console.log(`\n[${timestamp}] Triangular Spread Sample — ${sample.profileLabel}`);
  console.log(
    `  Pairs: ${summary.pairOk}/${summary.pairCount} ok · comparable: ${summary.comparablePairCount} · max spread: ${summary.maxPairSpreadPct}%`,
  );
  if (summary.lbtcPremiumPct !== null) {
    console.log(`  LBTC premium (vs cbBTC): ${summary.lbtcPremiumPct > 0 ? "+" : ""}${summary.lbtcPremiumPct}%`);
  }

  console.log(
    `  Routes: ${summary.routeOk}/${summary.routeCount} ok · profitable: ${summary.profitable} · after flash: ${summary.profitableAfterFlash} · policy: ${summary.meetsPolicy}`,
  );

  if (summary.bestRoute) {
    console.log(`  Best: ${summary.bestRoute} net=${summary.bestNetPct > 0 ? "+" : ""}${summary.bestNetPct}% ($${summary.bestNetUsd?.toFixed(4)})`);
  } else {
    console.log("  Best: none profitable");
  }

  for (const route of sample.triangular.filter((item) => item.ok && item.profitable)) {
    const flag = route.meetsPolicy ? "🟢" : route.profitableAfterFlash ? "🟡" : "⚪";
    console.log(
      `    ${flag} ${route.label.padEnd(28)} net=${route.netPct > 0 ? "+" : ""}${route.netPct.toFixed(4)}%  ` +
        `flash=${route.netAfterFlashPct > 0 ? "+" : ""}${route.netAfterFlashPct.toFixed(4)}%  $${route.netAfterFlash.toFixed(4)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getTriangleProfile(args.profile);
  const datasetNames = triangleDatasetNames(profile.id);
  const store = new JsonlStore(DATA_DIR);

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  Triangular Spread Collector — ${profile.label.padEnd(36)}║`);
  console.log(`║  Probe: $${String(args.probeUsdc).padEnd(8)} Interval: ${String(args.interval).padEnd(6)} Once: ${String(args.once).padEnd(5)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  let sampleCount = 0;

  while (true) {
    try {
      const sample = await collectOneSample(profile, args.probeUsdc);
      sampleCount += 1;

      await store.append(datasetNames.sampleLogName, sample);
      await writeFile(join(DATA_DIR, datasetNames.latestFileName), JSON.stringify({ ...sample, totalSamples: sampleCount }, null, 2));

      if (args.json) console.log(JSON.stringify(sample, null, 2));
      else printSample(sample);
    } catch (error) {
      console.error(`✗ Collection error: ${error.message}`);
      await store.append(datasetNames.sampleLogName, {
        schemaVersion: SCHEMA_VERSION,
        observedAt: new Date().toISOString(),
        profileId: profile.id,
        profileLabel: profile.label,
        ok: false,
        error: error.message,
      });
    }

    if (args.once) break;
    console.log(`  ⏳ Next sample in ${args.interval}s...`);
    await sleep(args.interval * 1000);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
