#!/usr/bin/env node

/**
 * Triangular Spread Collector — monitors LBTC/cbBTC/tBTC spreads on Base.
 *
 * Collects pairwise DEX spreads between Base BTC derivatives at regular
 * intervals to build a time-series of when triangular arb opportunities
 * appear and at what magnitudes.
 *
 * Usage:
 *   node src/cli/collect-triangular-spreads.mjs                      # continuous, 90s
 *   node src/cli/collect-triangular-spreads.mjs --interval=300       # 5-min intervals
 *   node src/cli/collect-triangular-spreads.mjs --once               # single snapshot
 *   node src/cli/collect-triangular-spreads.mjs --once --json        # JSON output
 *
 * Outputs:
 *   data/triangular-spread-samples.jsonl   — append-only time series
 *   data/triangular-spread-latest.json     — latest snapshot + summary
 */

import { writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");
const ODOS_API = "https://api.odos.xyz";
const SCHEMA_VERSION = 1;
const CALL_DELAY_MS = 2000;

const BASE_CHAIN_ID = 8453;
const USDC = { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 };
const BASE_BTC_TOKENS = [
  { symbol: "LBTC",  address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8 },
  { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
  { symbol: "tBTC",  address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18 },
];

// Flash loan fee on Aave V3
const FLASH_FEE_PCT = 0.05;

function parseArgs(argv) {
  const flags = new Set(argv.filter(a => a.startsWith("--") && !a.includes("=")));
  const options = Object.fromEntries(
    argv.filter(a => a.startsWith("--") && a.includes("=")).map(a => {
      const [key, ...rest] = a.slice(2).split("=");
      return [key, rest.join("=")];
    })
  );
  return {
    interval: parseInt(options.interval || "90", 10),
    probeUsdc: parseFloat(options["probe-usdc"] || "250"),
    once: flags.has("--once"),
    json: flags.has("--json"),
  };
}

async function odosQuote(inputAddr, inputAmount, outputAddr) {
  const body = {
    chainId: BASE_CHAIN_ID,
    inputTokens: [{ tokenAddress: inputAddr, amount: String(inputAmount) }],
    outputTokens: [{ tokenAddress: outputAddr, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.5,
    disableRFQs: true,
    compact: true,
  };
  const start = Date.now();
  const r = await fetch(`${ODOS_API}/sor/quote/v3`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, latencyMs };
  const data = await r.json();
  if (!data.outAmounts?.[0]) return { ok: false, error: "no output", latencyMs };
  return {
    ok: true,
    outAmount: data.outAmounts[0],
    gasUsd: data.gasEstimateValue ?? 0,
    impact: data.priceImpact ?? 0,
    latencyMs,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function collectPairwiseSpreads() {
  const pairs = [];

  for (let i = 0; i < BASE_BTC_TOKENS.length; i++) {
    for (let j = 0; j < BASE_BTC_TOKENS.length; j++) {
      if (i === j) continue;
      const a = BASE_BTC_TOKENS[i];
      const b = BASE_BTC_TOKENS[j];

      // Quote A→B with a small BTC amount (0.005 BTC ≈ $355)
      const amountRaw = String(Math.round(0.005 * 10 ** a.decimals));
      try {
        const q = await odosQuote(a.address, amountRaw, b.address);
        if (q.ok) {
          const outNormalized = parseInt(q.outAmount) / 10 ** b.decimals;
          const inNormalized = 0.005;
          const ratio = outNormalized / inNormalized;
          pairs.push({
            from: a.symbol, to: b.symbol,
            inAmount: inNormalized, outAmount: outNormalized,
            ratio, spreadPct: (ratio - 1) * 100,
            gasUsd: q.gasUsd, impact: q.impact, latencyMs: q.latencyMs,
            ok: true,
          });
        } else {
          pairs.push({ from: a.symbol, to: b.symbol, ok: false, error: q.error });
        }
      } catch (err) {
        pairs.push({ from: a.symbol, to: b.symbol, ok: false, error: err.message });
      }
      await sleep(CALL_DELAY_MS);
    }
  }
  return pairs;
}

async function collectTriangularRoutes(probeUsdc) {
  const probeRaw = String(Math.round(probeUsdc * 10 ** USDC.decimals));
  const routes = [];

  // All 6 permutations: USDC → A → B → USDC
  for (let i = 0; i < BASE_BTC_TOKENS.length; i++) {
    for (let j = 0; j < BASE_BTC_TOKENS.length; j++) {
      if (i === j) continue;
      const a = BASE_BTC_TOKENS[i];
      const b = BASE_BTC_TOKENS[j];
      const label = `USDC→${a.symbol}→${b.symbol}→USDC`;

      try {
        // Leg 1: USDC → A
        const q1 = await odosQuote(USDC.address, probeRaw, a.address);
        if (!q1.ok) { routes.push({ label, ok: false, error: `leg1: ${q1.error}` }); await sleep(CALL_DELAY_MS); continue; }
        await sleep(CALL_DELAY_MS);

        // Leg 2: A → B
        const q2 = await odosQuote(a.address, q1.outAmount, b.address);
        if (!q2.ok) { routes.push({ label, ok: false, error: `leg2: ${q2.error}` }); await sleep(CALL_DELAY_MS); continue; }
        await sleep(CALL_DELAY_MS);

        // Leg 3: B → USDC
        const q3 = await odosQuote(b.address, q2.outAmount, USDC.address);
        if (!q3.ok) { routes.push({ label, ok: false, error: `leg3: ${q3.error}` }); await sleep(CALL_DELAY_MS); continue; }

        const endUsdc = parseInt(q3.outAmount) / 10 ** USDC.decimals;
        const grossProfit = endUsdc - probeUsdc;
        const totalGas = q1.gasUsd + q2.gasUsd + q3.gasUsd;
        const netProfit = grossProfit - totalGas;
        const netPct = (netProfit / probeUsdc) * 100;
        const flashFeeUsd = probeUsdc * FLASH_FEE_PCT / 100;
        const netAfterFlash = netProfit - flashFeeUsd;
        const netAfterFlashPct = (netAfterFlash / probeUsdc) * 100;

        routes.push({
          label, ok: true,
          startUsdc: probeUsdc, endUsdc,
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
          totalLatencyMs: q1.latencyMs + q2.latencyMs + q3.latencyMs,
        });
      } catch (err) {
        routes.push({ label, ok: false, error: err.message });
      }
      await sleep(CALL_DELAY_MS);
    }
  }
  return routes;
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }
function round4(n) { return Math.round(n * 1e4) / 1e4; }

async function collectOneSample(probeUsdc) {
  const ts = new Date().toISOString();

  // Phase 1: Pairwise spreads (fast — 6 quotes)
  const pairwise = await collectPairwiseSpreads();

  // Phase 2: Full triangular routes (slower — 18 quotes)
  const triangular = await collectTriangularRoutes(probeUsdc);

  const profitableRoutes = triangular.filter(r => r.ok && r.profitable);
  const policyRoutes = triangular.filter(r => r.ok && r.meetsPolicy);
  const bestRoute = profitableRoutes.sort((a, b) => b.netAfterFlashPct - a.netAfterFlashPct)[0] || null;

  // Pairwise spread summary
  const okPairs = pairwise.filter(p => p.ok);
  const maxSpread = okPairs.length ? Math.max(...okPairs.map(p => Math.abs(p.spreadPct))) : 0;
  const lbtcPremium = okPairs.find(p => p.from === "cbBTC" && p.to === "LBTC");

  return {
    schemaVersion: SCHEMA_VERSION,
    observedAt: ts,
    probeUsdc,
    pairwise,
    triangular,
    summary: {
      pairCount: pairwise.length,
      pairOk: okPairs.length,
      maxPairSpreadPct: round4(maxSpread),
      lbtcPremiumPct: lbtcPremium ? round4(lbtcPremium.spreadPct) : null,
      routeCount: triangular.length,
      routeOk: triangular.filter(r => r.ok).length,
      profitable: profitableRoutes.length,
      profitableAfterFlash: triangular.filter(r => r.ok && r.profitableAfterFlash).length,
      meetsPolicy: policyRoutes.length,
      bestRoute: bestRoute ? bestRoute.label : null,
      bestNetPct: bestRoute ? bestRoute.netAfterFlashPct : null,
      bestNetUsd: bestRoute ? bestRoute.netAfterFlash : null,
    },
  };
}

function printSample(sample) {
  const ts = sample.observedAt.slice(11, 19);
  const s = sample.summary;

  console.log(`\n[${ts}] Triangular Spread Sample`);
  console.log(`  Pairs: ${s.pairOk}/${s.pairCount} ok · max spread: ${s.maxPairSpreadPct}%`);
  if (s.lbtcPremiumPct !== null) console.log(`  LBTC premium (vs cbBTC): ${s.lbtcPremiumPct > 0 ? "+" : ""}${s.lbtcPremiumPct}%`);

  console.log(`  Routes: ${s.routeOk}/${s.routeCount} ok · profitable: ${s.profitable} · after flash: ${s.profitableAfterFlash} · policy: ${s.meetsPolicy}`);

  if (s.bestRoute) {
    console.log(`  Best: ${s.bestRoute} net=${s.bestNetPct > 0 ? "+" : ""}${s.bestNetPct}% ($${s.bestNetUsd?.toFixed(4)})`);
  } else {
    console.log(`  Best: none profitable`);
  }

  // Print all profitable routes
  for (const r of sample.triangular.filter(r => r.ok && r.profitable)) {
    const flag = r.meetsPolicy ? "🟢" : r.profitableAfterFlash ? "🟡" : "⚪";
    console.log(`    ${flag} ${r.label.padEnd(28)} net=${r.netPct > 0 ? "+" : ""}${r.netPct.toFixed(4)}%  flash=${r.netAfterFlashPct > 0 ? "+" : ""}${r.netAfterFlashPct.toFixed(4)}%  $${r.netAfterFlash.toFixed(4)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new JsonlStore(DATA_DIR);

  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║  Triangular Spread Collector — Base LBTC/cbBTC/tBTC ║`);
  console.log(`║  Probe: $${args.probeUsdc} | Interval: ${args.interval}s | Once: ${args.once}  ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);

  let sampleCount = 0;

  while (true) {
    try {
      const sample = await collectOneSample(args.probeUsdc);
      sampleCount++;

      // Persist
      await store.append("triangular-spread-samples", sample);
      await writeFile(
        join(DATA_DIR, "triangular-spread-latest.json"),
        JSON.stringify({ ...sample, totalSamples: sampleCount }, null, 2)
      );

      if (args.json) {
        console.log(JSON.stringify(sample, null, 2));
      } else {
        printSample(sample);
      }

    } catch (err) {
      console.error(`✗ Collection error: ${err.message}`);
      await store.append("triangular-spread-samples", {
        schemaVersion: SCHEMA_VERSION,
        observedAt: new Date().toISOString(),
        ok: false,
        error: err.message,
      });
    }

    if (args.once) break;
    console.log(`  ⏳ Next sample in ${args.interval}s...`);
    await sleep(args.interval * 1000);
  }
}

main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
