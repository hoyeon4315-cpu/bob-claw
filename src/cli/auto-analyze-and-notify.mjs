#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendTelegramMessage } from "../notify/telegram.mjs";
import {
  getTriangleProfile,
  triangleDatasetPaths,
  triangleRouteLabels,
} from "../flash/triangle-profiles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const DATA_DIR = resolve(ROOT, "data");
const CAPITAL = 1000;
const MIN_PROFIT = 0.3;
const SCALE = CAPITAL / 250;
const TARGET_SAMPLES = 576;
const MIN_SAMPLES = 200;

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return { profile: options.profile };
}

function countLines(filePath) {
  if (!existsSync(filePath)) return 0;
  const raw = readFileSync(filePath, "utf8");
  return raw.trim().split("\n").filter(Boolean).length;
}

function loadSamples(filePath) {
  const raw = readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
  return raw.map((line) => JSON.parse(line));
}

function analyzeRoute(samples, label) {
  const data = [];
  for (const sample of samples) {
    const triangular = sample.triangular?.find((route) => route.label === label);
    if (!triangular || !triangular.ok) continue;
    const grossScaled = triangular.grossProfit * SCALE;
    const gasScaled = triangular.totalGas * 1.2;
    const netScaled = grossScaled - gasScaled;
    data.push({
      time: new Date(sample.observedAt),
      hour: new Date(sample.observedAt).getUTCHours(),
      grossProfit: grossScaled,
      gas: gasScaled,
      netProfit: netScaled,
      netPct: (netScaled / CAPITAL) * 100,
      win: netScaled >= MIN_PROFIT,
      latencyMs: triangular.totalLatencyMs,
    });
  }
  return data;
}

function computeStats(label, data) {
  if (!data.length) return null;
  const wins = data.filter((entry) => entry.win).length;
  const profits = data.map((entry) => entry.netProfit);
  const sorted = [...profits].sort((left, right) => left - right);
  const avg = profits.reduce((sum, value) => sum + value, 0) / profits.length;
  return {
    label,
    winRate: (wins / data.length) * 100,
    ev: avg,
    wins,
    total: data.length,
    avg,
    median: sorted[Math.floor(sorted.length / 2)],
    best: sorted[sorted.length - 1],
    worst: sorted[0],
  };
}

function computeHourlyDistribution(allData) {
  const buckets = {};
  for (const entry of allData) {
    if (!buckets[entry.hour]) buckets[entry.hour] = { count: 0, wins: 0, totalProfit: 0 };
    buckets[entry.hour].count += 1;
    if (entry.win) buckets[entry.hour].wins += 1;
    buckets[entry.hour].totalProfit += entry.netProfit;
  }
  return buckets;
}

function runOverfitChecklist(allData, stats) {
  const checks = [];
  const bestRoute = stats.reduce((left, right) => ((left?.winRate || 0) > (right?.winRate || 0) ? left : right), null);
  checks.push({ name: "576+ observations", ok: allData.length >= 576, detail: `${allData.length}/576` });
  checks.push({ name: "18+ hours covered", ok: new Set(allData.map((entry) => entry.hour)).size >= 18, detail: `${new Set(allData.map((entry) => entry.hour)).size}/24` });
  checks.push({
    name: "Win rate 30-95%",
    ok: Boolean(bestRoute && bestRoute.winRate > 30 && bestRoute.winRate < 95),
    detail: `best: ${bestRoute?.winRate?.toFixed(1) || 0}%`,
  });
  checks.push({ name: "EV > $0", ok: Boolean(bestRoute && bestRoute.ev > 0), detail: `$${bestRoute?.ev?.toFixed(4) || 0}` });
  checks.push({ name: `EV >= $${MIN_PROFIT}`, ok: Boolean(bestRoute && bestRoute.ev >= MIN_PROFIT), detail: `$${bestRoute?.ev?.toFixed(4) || 0}` });

  const hourCounts = {};
  for (const entry of allData) hourCounts[entry.hour] = (hourCounts[entry.hour] || 0) + 1;
  const maxHourPct = allData.length ? (Math.max(...Object.values(hourCounts)) / allData.length) * 100 : 0;
  checks.push({ name: "No hour bias (<30%)", ok: maxHourPct < 30, detail: `max: ${maxHourPct.toFixed(0)}%` });

  const sorted = [...allData].sort((left, right) => left.time - right.time);
  let maxConsec = 0;
  let consec = 0;
  for (const entry of sorted) {
    if (!entry.win) {
      consec += 1;
      maxConsec = Math.max(maxConsec, consec);
    } else {
      consec = 0;
    }
  }
  checks.push({ name: "Max consec loss <10", ok: maxConsec < 10, detail: `max: ${maxConsec}` });
  const passed = checks.filter((check) => check.ok).length;
  return { checks, passed, total: checks.length };
}

function buildProgressMessage(profile, count) {
  const pct = ((count / TARGET_SAMPLES) * 100).toFixed(0);
  return [`📊 BOB Claw Spread Report (${profile.label})`, `Samples: ${count}/${TARGET_SAMPLES} (${pct}%)`, `Status: collecting... (${MIN_SAMPLES} needed)`].join("\n");
}

function buildAnalysisMessage(profile, sampleCount, bestStat, checklist) {
  const lines = [`📊 BOB Claw Spread Report (${profile.label})`, `Samples: ${sampleCount}/${TARGET_SAMPLES}`];
  if (bestStat) {
    lines.push(`Best: ${bestStat.label}`);
    lines.push(`  EV: $${bestStat.ev.toFixed(2)} | WR: ${bestStat.winRate.toFixed(0)}% | Median: $${bestStat.median.toFixed(2)}`);
  }
  lines.push(`Overfit: ${checklist.passed}/${checklist.total} ✅`);
  if (checklist.passed === checklist.total) lines.push("Status: ✅ all checks passed");
  else if (sampleCount < TARGET_SAMPLES) lines.push("Status: collecting more data...");
  else lines.push("Status: ⚠️ some checks failed");
  return lines.join("\n");
}

function buildCanaryReadyMessage(profile, bestStat) {
  return [
    `🟢 Canary ready (${profile.label})!`,
    "7/7 overfit checks passed",
    `EV: $${bestStat.ev.toFixed(2)} | WR: ${bestStat.winRate.toFixed(0)}%`,
    `→ npm run trigger:arb -- --once --simulate --profile=${profile.id}`,
  ].join("\n");
}

async function notify(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.log("[auto-analyze] Telegram not configured, skipping notify.");
    return;
  }
  await sendTelegramMessage({ botToken, chatId, text, category: "research_analysis" });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getTriangleProfile(args.profile);
  const paths = triangleDatasetPaths(DATA_DIR, profile.id);
  const routes = triangleRouteLabels(profile.id);

  console.log(`[auto-analyze] Checking spread data for ${profile.label}...`);
  const lineCount = countLines(paths.sampleLogPath);
  console.log(`[auto-analyze] Samples: ${lineCount}/${TARGET_SAMPLES}`);

  if (lineCount < MIN_SAMPLES) {
    await notify(buildProgressMessage(profile, lineCount));
    return;
  }

  const samples = loadSamples(paths.sampleLogPath);
  const allData = [];
  const stats = [];
  for (const route of routes) {
    const data = analyzeRoute(samples, route);
    allData.push(...data);
    const routeStats = computeStats(route, data);
    if (routeStats) stats.push(routeStats);
  }
  if (!stats.length) {
    console.log("[auto-analyze] No valid route data found.");
    return;
  }

  const bestStat = stats.reduce((left, right) => (left.ev > right.ev ? left : right));
  const checklist = runOverfitChecklist(allData, stats);
  const hourly = computeHourlyDistribution(allData);

  console.log(`[auto-analyze] Best route: ${bestStat.label}`);
  console.log(`[auto-analyze] EV: $${bestStat.ev.toFixed(4)} | WR: ${bestStat.winRate.toFixed(1)}%`);
  console.log(`[auto-analyze] Overfit: ${checklist.passed}/${checklist.total}`);

  const report = {
    generatedAt: new Date().toISOString(),
    profileId: profile.id,
    profileLabel: profile.label,
    sampleCount: samples.length,
    targetSamples: TARGET_SAMPLES,
    capital: CAPITAL,
    minProfit: MIN_PROFIT,
    routes: stats,
    bestRoute: bestStat.label,
    overfit: {
      passed: checklist.passed,
      total: checklist.total,
      checks: checklist.checks,
    },
    hourlyDistribution: hourly,
  };
  writeFileSync(paths.autoReportPath, JSON.stringify(report, null, 2));
  console.log(`[auto-analyze] Report saved: ${paths.autoReportPath}`);

  await notify(buildAnalysisMessage(profile, samples.length, bestStat, checklist));
  if (checklist.passed === checklist.total) {
    await notify(buildCanaryReadyMessage(profile, bestStat));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
