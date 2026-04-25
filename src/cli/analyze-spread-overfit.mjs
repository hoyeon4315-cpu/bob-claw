#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTriangleProfile,
  triangleDatasetPaths,
  triangleRouteLabels,
} from "../flash/triangle-profiles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = resolve(ROOT, "data");

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    capital: Number(options.capital || 1000),
    minProfit: Number(options["min-profit"] || 0.3),
    profile: options.profile,
  };
}

function loadSamples(dataFile) {
  const raw = readFileSync(dataFile, "utf8").trim().split("\n").filter(Boolean);
  return raw.map((line) => JSON.parse(line));
}

function analyzeRoute(samples, label, scale, capital, minProfit) {
  const data = [];
  for (const sample of samples) {
    const triangular = sample.triangular?.find((route) => route.label === label);
    if (!triangular || !triangular.ok) continue;

    const grossScaled = triangular.grossProfit * scale;
    const gasScaled = triangular.totalGas * 1.2;
    const netScaled = grossScaled - gasScaled;
    data.push({
      time: new Date(sample.observedAt),
      hour: new Date(sample.observedAt).getUTCHours(),
      grossProfit: grossScaled,
      gas: gasScaled,
      netProfit: netScaled,
      netPct: (netScaled / capital) * 100,
      win: netScaled >= minProfit,
      latencyMs: triangular.totalLatencyMs,
    });
  }
  return data;
}

function summarizeStats(label, data, minProfit) {
  if (!data.length) return null;
  const wins = data.filter((entry) => entry.win).length;
  const profits = data.map((entry) => entry.netProfit);
  const sorted = [...profits].sort((left, right) => left - right);
  const avg = profits.reduce((sum, value) => sum + value, 0) / profits.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const positiveProfits = profits.filter((profit) => profit > 0);
  const positiveAvg = positiveProfits.length ? positiveProfits.reduce((sum, value) => sum + value, 0) / positiveProfits.length : 0;
  const stats = {
    label,
    sampleCount: data.length,
    winRate: Number(((wins / data.length) * 100).toFixed(1)),
    ev: avg,
    avg,
    median,
    max: Math.max(...profits),
    min: Math.min(...profits),
    positiveAvg,
    avgGas: data.reduce((sum, entry) => sum + entry.gas, 0) / data.length,
    avgLatencySec: data.reduce((sum, entry) => sum + entry.latencyMs, 0) / data.length / 1000,
    minProfit,
  };
  return stats;
}

function hourlyDistribution(allData) {
  const buckets = {};
  for (const entry of allData) {
    if (!buckets[entry.hour]) buckets[entry.hour] = { count: 0, wins: 0, totalProfit: 0 };
    buckets[entry.hour].count += 1;
    if (entry.win) buckets[entry.hour].wins += 1;
    buckets[entry.hour].totalProfit += entry.netProfit;
  }
  return buckets;
}

function buildOverfitChecklist(allData, stats, minProfit) {
  const checks = [];
  const sampleOk = allData.length >= 576;
  checks.push({ name: "576+ observations", ok: sampleOk, detail: `${allData.length}/576` });

  const hours = new Set(allData.map((entry) => entry.hour));
  checks.push({ name: "18+ hours covered", ok: hours.size >= 18, detail: `${hours.size}/24 hours` });

  const bestRoute = stats.reduce((left, right) => ((left?.winRate || 0) > (right?.winRate || 0) ? left : right), null);
  const winRateOk = bestRoute && bestRoute.winRate > 30 && bestRoute.winRate < 95;
  checks.push({ name: "Win rate 30-95%", ok: winRateOk, detail: `best: ${bestRoute?.winRate || 0}%` });

  const evOk = bestRoute && bestRoute.ev > 0;
  checks.push({ name: "EV > $0", ok: evOk, detail: `best EV: $${bestRoute?.ev?.toFixed(4) || 0}` });

  const evMinOk = bestRoute && bestRoute.ev >= minProfit;
  checks.push({ name: `EV >= $${minProfit}`, ok: evMinOk, detail: `best EV: $${bestRoute?.ev?.toFixed(4) || 0}` });

  const hourBuckets = {};
  for (const entry of allData) {
    hourBuckets[entry.hour] = (hourBuckets[entry.hour] || 0) + 1;
  }
  const maxHourPct = allData.length ? (Math.max(...Object.values(hourBuckets)) / allData.length) * 100 : 0;
  checks.push({ name: "No hour bias (<30%)", ok: maxHourPct < 30, detail: `max hour: ${maxHourPct.toFixed(0)}%` });

  const sorted = [...allData].sort((left, right) => left.time - right.time);
  let maxConsecLoss = 0;
  let consecLoss = 0;
  for (const entry of sorted) {
    if (!entry.win) {
      consecLoss += 1;
      maxConsecLoss = Math.max(maxConsecLoss, consecLoss);
    } else {
      consecLoss = 0;
    }
  }
  checks.push({ name: "Max consec loss <10", ok: maxConsecLoss < 10, detail: `max: ${maxConsecLoss}` });
  return checks;
}

function printStats(stats) {
  if (!stats) return;
  console.log(`\n  📊 ${stats.label}`);
  console.log("  ─────────────────────────────────────────");
  console.log(`  Samples:    ${stats.sampleCount}`);
  console.log(`  Win rate:   ${stats.winRate}% [threshold: $${stats.minProfit}]`);
  console.log(`  EV/trade:   $${stats.ev.toFixed(4)}`);
  console.log(`  Avg profit: $${stats.avg.toFixed(4)}`);
  console.log(`  Median:     $${stats.median.toFixed(4)}`);
  console.log(`  Best:       $${stats.max.toFixed(4)}`);
  console.log(`  Worst:      $${stats.min.toFixed(4)}`);
  console.log(`  Avg (wins): $${stats.positiveAvg.toFixed(4)}`);
  console.log(`  Avg gas:    $${stats.avgGas.toFixed(4)}`);
  console.log(`  Avg latency: ${stats.avgLatencySec.toFixed(1)}s`);
}

function printHourlyDistribution(buckets) {
  console.log("\n  ⏰ Hourly Distribution (UTC)");
  console.log("  ─────────────────────────────────────────");
  const maxCount = Math.max(...Object.values(buckets).map((bucket) => bucket.count));
  const maxBarWidth = 20;
  for (const hour of Object.keys(buckets).sort((left, right) => Number(left) - Number(right))) {
    const bucket = buckets[hour];
    const wr = ((bucket.wins / bucket.count) * 100).toFixed(0);
    const avg = (bucket.totalProfit / bucket.count).toFixed(2);
    const barLength = maxCount > 0 ? Math.max(1, Math.round((bucket.count / maxCount) * maxBarWidth)) : 0;
    console.log(`  ${String(hour).padStart(2, "0")}:00  ${"█".repeat(barLength).padEnd(maxBarWidth)} n=${bucket.count} wr=${wr}% avg=$${avg}`);
  }
}

function printChecklist(checks) {
  console.log("\n═══════════════════════════════════════════");
  console.log("  🔍 OVERFIT PREVENTION CHECKLIST");
  console.log("═══════════════════════════════════════════");
  let passCount = 0;
  for (const check of checks) {
    console.log(`  ${check.ok ? "✅" : "❌"} ${check.name.padEnd(25)} ${check.detail}`);
    if (check.ok) passCount += 1;
  }
  console.log(`\n  Result: ${passCount}/${checks.length} passed`);
  if (passCount === checks.length) console.log("  🟢 READY FOR CANARY DEPLOYMENT");
  else if (passCount >= checks.length - 2) console.log("  🟡 CLOSE — need more data or minor adjustments");
  else console.log("  🔴 NOT READY — collect more data before live trading");
  return passCount;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getTriangleProfile(args.profile);
  const paths = triangleDatasetPaths(DATA_DIR, profile.id);
  const routes = triangleRouteLabels(profile.id);
  const scale = args.capital / 250;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  BOB Claw — Spread Overfit Analysis      ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Profile: ${profile.label} (${profile.id})`);
  console.log(`  Capital: $${args.capital} | Flash fee: 0% | Min profit: $${args.minProfit}`);
  console.log(`  Data: ${paths.sampleLogPath}`);

  const samples = loadSamples(paths.sampleLogPath);
  console.log(`  Loaded: ${samples.length} samples`);

  const allData = [];
  const stats = [];
  for (const route of routes) {
    const routeData = analyzeRoute(samples, route, scale, args.capital, args.minProfit);
    allData.push(...routeData);
    const routeStats = summarizeStats(route, routeData, args.minProfit);
    printStats(routeStats);
    if (routeStats) stats.push(routeStats);
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  📈 OVERALL SUMMARY");
  console.log("═══════════════════════════════════════════");
  const totalWins = allData.filter((entry) => entry.win).length;
  const overallEv = allData.length ? allData.reduce((sum, entry) => sum + entry.netProfit, 0) / allData.length : 0;
  console.log(`  Total observations: ${allData.length} (${samples.length} samples × ${routes.length} routes)`);
  console.log(`  Overall win rate: ${allData.length ? ((totalWins / allData.length) * 100).toFixed(1) : "0.0"}% (${totalWins}/${allData.length})`);
  console.log(`  Overall EV: $${overallEv.toFixed(4)}`);

  const bestStat = stats.length ? stats.reduce((left, right) => (left.ev > right.ev ? left : right)) : null;
  if (bestStat) {
    console.log(`  Best route: ${bestStat.label} (EV=$${bestStat.ev.toFixed(4)}, WR=${bestStat.winRate}%)`);
  }

  const hourly = hourlyDistribution(allData);
  if (Object.keys(hourly).length) printHourlyDistribution(hourly);
  const checks = buildOverfitChecklist(allData, stats, args.minProfit);
  const passed = printChecklist(checks);

  const report = {
    generatedAt: new Date().toISOString(),
    profileId: profile.id,
    profileLabel: profile.label,
    capital: args.capital,
    minProfit: args.minProfit,
    sampleCount: samples.length,
    routeCount: routes.length,
    observationCount: allData.length,
    overallEv,
    bestRoute: bestStat ? { label: bestStat.label, ev: bestStat.ev, winRate: bestStat.winRate } : null,
    routeStats: stats,
    hourlyDistribution: hourly,
    overfit: {
      passed,
      total: checks.length,
      checks,
    },
  };
  writeFileSync(paths.overfitReportPath, JSON.stringify(report, null, 2));
}

main();
