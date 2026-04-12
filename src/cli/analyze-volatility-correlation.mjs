#!/usr/bin/env node

/**
 * Volatility-Spread Correlation Analyzer
 *
 * Reads dex-spread-samples.jsonl and analyzes the relationship between
 * BTC price volatility and LBTC/cbBTC spread.
 *
 * Usage:
 *   node src/cli/analyze-volatility-correlation.mjs [--min-samples=50]
 */

import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = join(ROOT, "data");

function parseArgs(argv) {
  const kv = Object.fromEntries(
    argv.filter(a => a.includes("=")).map(a => a.split("="))
  );
  return {
    minSamples: parseInt(kv["--min-samples"] || "20", 10),
  };
}

async function loadSamples() {
  try {
    const raw = await readFile(join(DATA_DIR, "dex-spread-samples.jsonl"), "utf8");
    return raw.trim().split("\n").map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function computeStats(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, min: 0, max: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  return {
    mean,
    std: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    median: n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)],
  };
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b) / n;
  const my = y.reduce((a, b) => a + b) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const samples = await loadSamples();

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Volatility-Spread Correlation Analysis           ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  if (samples.length < args.minSamples) {
    console.log(`  ⚠ Only ${samples.length} samples (need ${args.minSamples}). Collecting more data...`);
    console.log(`  Run: npm run collect:dex-spreads -- --interval=90`);
    console.log();
  }

  // Filter samples with BTC data
  const withBtc = samples.filter(s => s.btcChange24hPct != null && s.lbtcPremiumPct != null);
  const withoutBtc = samples.filter(s => s.btcChange24hPct == null && s.lbtcPremiumPct != null);

  console.log(`  Total samples: ${samples.length}`);
  console.log(`  With BTC price: ${withBtc.length}`);
  console.log(`  Without BTC price: ${withoutBtc.length}`);
  console.log();

  // Overall LBTC premium stats
  const premiums = samples.filter(s => s.lbtcPremiumPct != null).map(s => s.lbtcPremiumPct);
  const spreads = samples.filter(s => s.spreadPct != null).map(s => s.spreadPct);
  const premStats = computeStats(premiums);
  const spreadStats = computeStats(spreads);

  console.log(`  ── LBTC Premium Stats ──`);
  console.log(`     Mean: ${premStats.mean.toFixed(4)}%  Std: ${premStats.std.toFixed(4)}%`);
  console.log(`     Min: ${premStats.min.toFixed(4)}%  Max: ${premStats.max.toFixed(4)}%  Median: ${premStats.median.toFixed(4)}%`);
  console.log();
  console.log(`  ── Cross-Chain Spread Stats ──`);
  console.log(`     Mean: ${spreadStats.mean.toFixed(4)}%  Std: ${spreadStats.std.toFixed(4)}%`);
  console.log(`     Min: ${spreadStats.min.toFixed(4)}%  Max: ${spreadStats.max.toFixed(4)}%`);
  console.log();

  if (withBtc.length >= 3) {
    const btcChanges = withBtc.map(s => Math.abs(s.btcChange24hPct));
    const lbtcPremiums = withBtc.map(s => s.lbtcPremiumPct);
    const crossSpreads = withBtc.map(s => s.spreadPct);

    const corrLbtc = pearsonCorrelation(btcChanges, lbtcPremiums);
    const corrSpread = pearsonCorrelation(btcChanges, crossSpreads);

    console.log(`  ── Correlation (|BTC 24h change| vs ...) ──`);
    console.log(`     LBTC premium: r = ${corrLbtc?.toFixed(4) || "N/A"}`);
    console.log(`     Cross-chain spread: r = ${corrSpread?.toFixed(4) || "N/A"}`);
    console.log();

    // Bucket by volatility regime
    const calm = withBtc.filter(s => Math.abs(s.btcChange24hPct) < 2);
    const moderate = withBtc.filter(s => Math.abs(s.btcChange24hPct) >= 2 && Math.abs(s.btcChange24hPct) < 4);
    const volatile = withBtc.filter(s => Math.abs(s.btcChange24hPct) >= 4);

    console.log(`  ── Spread by Volatility Regime ──`);
    console.log(`     Calm (<2%):     ${calm.length} samples → LBTC prem: ${calm.length ? computeStats(calm.map(s => s.lbtcPremiumPct)).mean.toFixed(4) : "N/A"}%`);
    console.log(`     Moderate (2-4%): ${moderate.length} samples → LBTC prem: ${moderate.length ? computeStats(moderate.map(s => s.lbtcPremiumPct)).mean.toFixed(4) : "N/A"}%`);
    console.log(`     Volatile (4%+): ${volatile.length} samples → LBTC prem: ${volatile.length ? computeStats(volatile.map(s => s.lbtcPremiumPct)).mean.toFixed(4) : "N/A"}%`);
    console.log();

    // Go/No-Go assessment
    console.log(`  ── GO/NO-GO ASSESSMENT ──`);
    if (volatile.length === 0) {
      console.log(`     ⏳ INCONCLUSIVE — No volatile (4%+) samples yet.`);
      console.log(`     Need BTC 3-4%+ daily move to test hypothesis.`);
      console.log(`     BTC has ~4 such events per month. Keep collecting.`);
    } else {
      const volPrem = computeStats(volatile.map(s => s.lbtcPremiumPct));
      if (volPrem.mean >= 0.40) {
        console.log(`     🟢 PROMISING — Volatile regime LBTC premium: ${volPrem.mean.toFixed(3)}%`);
        if (volPrem.mean >= 0.50) {
          console.log(`     ✅ ABOVE 0.50% THRESHOLD — Strategy may be viable!`);
        } else {
          console.log(`     ⚠ Close but below 0.50% — need more data points.`);
        }
      } else {
        console.log(`     🔴 NEGATIVE — Volatile regime LBTC premium: ${volPrem.mean.toFixed(3)}%`);
        console.log(`     Spread does NOT widen enough during volatility.`);
        console.log(`     Strategy H may not be viable.`);
      }
    }
  } else {
    console.log(`  ⚠ Need 3+ samples with BTC data for correlation.`);
    console.log(`    Restart collector (v3 adds BTC price automatically).`);
  }

  // Time range
  const first = samples[0]?.observedAt;
  const last = samples[samples.length - 1]?.observedAt;
  if (first && last) {
    const hours = (new Date(last) - new Date(first)) / 3600000;
    console.log(`\n  ── Data Range ──`);
    console.log(`     ${first} → ${last}`);
    console.log(`     Duration: ${hours.toFixed(1)} hours (${(hours/24).toFixed(1)} days)`);
  }

  console.log();
}

main().catch(err => { console.error(err); process.exit(1); });
