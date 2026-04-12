#!/usr/bin/env node
/**
 * analyze-spread-overfit.mjs
 * 
 * Analyzes triangular spread data for overfitting risk.
 * Rescales from $250 probe to $1,000 capital + 0% flash loan.
 * Outputs: win rate, EV, time-of-day patterns, overfit checklist.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, "../../data/triangular-spread-samples.jsonl");

const CAPITAL = Number(process.argv.find(a => a.startsWith("--capital="))?.split("=")[1] || 1000);
const MIN_PROFIT = Number(process.argv.find(a => a.startsWith("--min-profit="))?.split("=")[1] || 0.30);
const SCALE = CAPITAL / 250; // probe was $250

function loadSamples() {
  const raw = readFileSync(DATA_FILE, "utf8").trim().split("\n");
  return raw.map(line => JSON.parse(line));
}

function analyzeRoute(samples, label) {
  const data = [];
  for (const s of samples) {
    const tri = s.triangular?.find(t => t.label === label);
    if (!tri || !tri.ok) continue;

    // Rescale to $CAPITAL with 0% flash fee
    const grossScaled = tri.grossProfit * SCALE;
    const gasScaled = tri.totalGas * 1.2; // gas doesn't scale with capital, add 20% margin
    const netScaled = grossScaled - gasScaled;
    const netPctScaled = (netScaled / CAPITAL) * 100;

    data.push({
      time: new Date(s.observedAt),
      hour: new Date(s.observedAt).getUTCHours(),
      grossProfit: grossScaled,
      gas: gasScaled,
      netProfit: netScaled,
      netPct: netPctScaled,
      win: netScaled >= MIN_PROFIT,
      latencyMs: tri.totalLatencyMs,
    });
  }
  return data;
}

function printStats(label, data) {
  if (data.length === 0) { console.log(`  ${label}: no data`); return; }

  const wins = data.filter(d => d.win).length;
  const winRate = (wins / data.length * 100).toFixed(1);
  const profits = data.map(d => d.netProfit);
  const avg = profits.reduce((a, b) => a + b, 0) / profits.length;
  const max = Math.max(...profits);
  const min = Math.min(...profits);
  const median = [...profits].sort((a, b) => a - b)[Math.floor(profits.length / 2)];
  const positiveAvg = profits.filter(p => p > 0).length > 0
    ? profits.filter(p => p > 0).reduce((a, b) => a + b, 0) / profits.filter(p => p > 0).length
    : 0;
  const ev = avg; // expected value per trade

  console.log(`\n  📊 ${label}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Samples:    ${data.length}`);
  console.log(`  Win rate:   ${winRate}% (${wins}/${data.length}) [threshold: $${MIN_PROFIT}]`);
  console.log(`  EV/trade:   $${ev.toFixed(4)}`);
  console.log(`  Avg profit: $${avg.toFixed(4)}`);
  console.log(`  Median:     $${median.toFixed(4)}`);
  console.log(`  Best:       $${max.toFixed(4)}`);
  console.log(`  Worst:      $${min.toFixed(4)}`);
  console.log(`  Avg (wins): $${positiveAvg.toFixed(4)}`);
  console.log(`  Avg gas:    $${(data.reduce((a, d) => a + d.gas, 0) / data.length).toFixed(4)}`);
  console.log(`  Avg latency: ${(data.reduce((a, d) => a + d.latencyMs, 0) / data.length / 1000).toFixed(1)}s`);

  return { label, winRate: parseFloat(winRate), ev, wins, total: data.length, avg, max, min, median };
}

function printHourlyDistribution(allData) {
  console.log("\n  ⏰ Hourly Distribution (UTC)");
  console.log("  ─────────────────────────────────────────");
  const hourBuckets = {};
  for (const d of allData) {
    if (!hourBuckets[d.hour]) hourBuckets[d.hour] = { count: 0, wins: 0, totalProfit: 0 };
    hourBuckets[d.hour].count++;
    if (d.win) hourBuckets[d.hour].wins++;
    hourBuckets[d.hour].totalProfit += d.netProfit;
  }

  const hours = Object.keys(hourBuckets).sort((a, b) => a - b);
  for (const h of hours) {
    const b = hourBuckets[h];
    const wr = (b.wins / b.count * 100).toFixed(0);
    const avg = (b.totalProfit / b.count).toFixed(2);
    const bar = "█".repeat(b.count);
    console.log(`  ${String(h).padStart(2, "0")}:00  ${bar.padEnd(20)} n=${b.count} wr=${wr}% avg=$${avg}`);
  }
}

function printOverfitChecklist(allData, stats) {
  console.log("\n═══════════════════════════════════════════");
  console.log("  🔍 OVERFIT PREVENTION CHECKLIST");
  console.log("═══════════════════════════════════════════");

  const checks = [];

  // 1. Sample count
  const n = allData.length;
  const sampleOk = n >= 576;
  checks.push({ name: "576+ samples", ok: sampleOk, detail: `${n}/576 (${(n / 576 * 100).toFixed(0)}%)` });

  // 2. Time coverage
  const hours = new Set(allData.map(d => d.hour));
  const hourOk = hours.size >= 18; // at least 18/24 hours covered
  checks.push({ name: "18+ hours covered", ok: hourOk, detail: `${hours.size}/24 hours` });

  // 3. Win rate reasonable (not too high = suspicious, not too low = unprofitable)
  const bestRoute = stats.reduce((a, b) => (a?.winRate || 0) > (b?.winRate || 0) ? a : b);
  const wrOk = bestRoute && bestRoute.winRate > 30 && bestRoute.winRate < 95;
  checks.push({ name: "Win rate 30-95%", ok: wrOk, detail: `best: ${bestRoute?.winRate || 0}%` });

  // 4. EV positive
  const evOk = bestRoute && bestRoute.ev > 0;
  checks.push({ name: "EV > $0", ok: evOk, detail: `best EV: $${bestRoute?.ev?.toFixed(4) || 0}` });

  // 5. EV > min profit threshold
  const evMinOk = bestRoute && bestRoute.ev >= MIN_PROFIT;
  checks.push({ name: `EV >= $${MIN_PROFIT}`, ok: evMinOk, detail: `best EV: $${bestRoute?.ev?.toFixed(4) || 0}` });

  // 6. No single-hour bias
  const hourBuckets = {};
  for (const d of allData) {
    if (!hourBuckets[d.hour]) hourBuckets[d.hour] = 0;
    hourBuckets[d.hour]++;
  }
  const maxHourPct = Math.max(...Object.values(hourBuckets)) / allData.length * 100;
  const biasOk = maxHourPct < 30; // no single hour > 30% of data
  checks.push({ name: "No hour bias (<30%)", ok: biasOk, detail: `max hour: ${maxHourPct.toFixed(0)}%` });

  // 7. Consecutive losses check
  const sortedByTime = [...allData].sort((a, b) => a.time - b.time);
  let maxConsecLoss = 0, consecLoss = 0;
  for (const d of sortedByTime) {
    if (!d.win) { consecLoss++; maxConsecLoss = Math.max(maxConsecLoss, consecLoss); }
    else { consecLoss = 0; }
  }
  const consecOk = maxConsecLoss < 10;
  checks.push({ name: "Max consec loss <10", ok: consecOk, detail: `max: ${maxConsecLoss}` });

  // Print results
  let passCount = 0;
  for (const c of checks) {
    const icon = c.ok ? "✅" : "❌";
    console.log(`  ${icon} ${c.name.padEnd(25)} ${c.detail}`);
    if (c.ok) passCount++;
  }

  console.log(`\n  Result: ${passCount}/${checks.length} passed`);
  if (passCount === checks.length) {
    console.log("  🟢 READY FOR CANARY DEPLOYMENT");
  } else if (passCount >= checks.length - 2) {
    console.log("  🟡 CLOSE — need more data or minor adjustments");
  } else {
    console.log("  🔴 NOT READY — collect more data before live trading");
  }
}

// Main
console.log("╔══════════════════════════════════════════╗");
console.log("║  BOB Claw — Spread Overfit Analysis      ║");
console.log("╚══════════════════════════════════════════╝");
console.log(`  Capital: $${CAPITAL} | Flash fee: 0% | Min profit: $${MIN_PROFIT}`);
console.log(`  Data: ${DATA_FILE}`);

const samples = loadSamples();
console.log(`  Loaded: ${samples.length} samples`);

const routes = [
  "USDC→LBTC→cbBTC→USDC",
  "USDC→LBTC→tBTC→USDC",
  "USDC→cbBTC→LBTC→USDC",
  "USDC→cbBTC→tBTC→USDC",
  "USDC→tBTC→LBTC→USDC",
  "USDC→tBTC→cbBTC→USDC",
];

const allData = [];
const stats = [];
for (const route of routes) {
  const data = analyzeRoute(samples, route);
  allData.push(...data);
  const s = printStats(route, data);
  if (s) stats.push(s);
}

// Overall
console.log("\n═══════════════════════════════════════════");
console.log("  📈 OVERALL SUMMARY");
console.log("═══════════════════════════════════════════");
const totalWins = allData.filter(d => d.win).length;
const totalAvg = allData.length > 0 ? allData.reduce((a, d) => a + d.netProfit, 0) / allData.length : 0;
console.log(`  Total observations: ${allData.length} (${samples.length} samples × ${routes.length} routes)`);
console.log(`  Overall win rate: ${(totalWins / allData.length * 100).toFixed(1)}% (${totalWins}/${allData.length})`);
console.log(`  Overall EV: $${totalAvg.toFixed(4)}`);

if (stats.length > 0) {
  const bestStat = stats.reduce((a, b) => a.ev > b.ev ? a : b);
  console.log(`  Best route: ${bestStat.label} (EV=$${bestStat.ev.toFixed(4)}, WR=${bestStat.winRate}%)`);
}

printHourlyDistribution(allData);
printOverfitChecklist(allData, stats);
