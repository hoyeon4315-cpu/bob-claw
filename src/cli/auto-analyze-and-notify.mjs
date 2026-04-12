#!/usr/bin/env node
/**
 * auto-analyze-and-notify.mjs
 *
 * Periodic script: counts spread samples, runs overfit analysis when >= 200,
 * sends Telegram summary, and writes report JSON.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { sendTelegramMessage } from "../notify/telegram.mjs";

// Load .env file manually (no dotenv dependency)
const __root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(__root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, "../../data/triangular-spread-samples.jsonl");
const REPORT_FILE = resolve(__dirname, "../../data/spread-analysis-report.json");

const CAPITAL = 1000;
const MIN_PROFIT = 0.30;
const SCALE = CAPITAL / 250;
const TARGET_SAMPLES = 576;
const MIN_SAMPLES = 200;

const ROUTES = [
  "USDC→LBTC→cbBTC→USDC",
  "USDC→LBTC→tBTC→USDC",
  "USDC→cbBTC→LBTC→USDC",
  "USDC→cbBTC→tBTC→USDC",
  "USDC→tBTC→LBTC→USDC",
  "USDC→tBTC→cbBTC→USDC",
];

// ── helpers ──────────────────────────────────────────────────────────

function countLines(filePath) {
  if (!existsSync(filePath)) return 0;
  const raw = readFileSync(filePath, "utf8");
  return raw.trim().split("\n").filter(Boolean).length;
}

function loadSamples() {
  const raw = readFileSync(DATA_FILE, "utf8").trim().split("\n");
  return raw.filter(Boolean).map(line => JSON.parse(line));
}

function analyzeRoute(samples, label) {
  const data = [];
  for (const s of samples) {
    const tri = s.triangular?.find(t => t.label === label);
    if (!tri || !tri.ok) continue;
    const grossScaled = tri.grossProfit * SCALE;
    const gasScaled = tri.totalGas * 1.2;
    const netScaled = grossScaled - gasScaled;
    data.push({
      time: new Date(s.observedAt),
      hour: new Date(s.observedAt).getUTCHours(),
      grossProfit: grossScaled,
      gas: gasScaled,
      netProfit: netScaled,
      netPct: (netScaled / CAPITAL) * 100,
      win: netScaled >= MIN_PROFIT,
      latencyMs: tri.totalLatencyMs,
    });
  }
  return data;
}

function computeStats(label, data) {
  if (data.length === 0) return null;
  const wins = data.filter(d => d.win).length;
  const winRate = wins / data.length * 100;
  const profits = data.map(d => d.netProfit);
  const avg = profits.reduce((a, b) => a + b, 0) / profits.length;
  const sorted = [...profits].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const best = sorted[sorted.length - 1];
  const worst = sorted[0];
  return { label, winRate, ev: avg, wins, total: data.length, avg, median, best, worst };
}

function computeHourlyDistribution(allData) {
  const buckets = {};
  for (const d of allData) {
    if (!buckets[d.hour]) buckets[d.hour] = { count: 0, wins: 0, totalProfit: 0 };
    buckets[d.hour].count++;
    if (d.win) buckets[d.hour].wins++;
    buckets[d.hour].totalProfit += d.netProfit;
  }
  return buckets;
}

function runOverfitChecklist(allData, stats) {
  const checks = [];

  // 1. Sample count
  const n = allData.length;
  checks.push({ name: "576+ samples", ok: n >= 576, detail: `${n}/576` });

  // 2. Time coverage
  const hours = new Set(allData.map(d => d.hour));
  checks.push({ name: "18+ hours covered", ok: hours.size >= 18, detail: `${hours.size}/24` });

  // 3. Win rate reasonable
  const bestRoute = stats.reduce((a, b) => (a?.winRate || 0) > (b?.winRate || 0) ? a : b, null);
  const wrOk = bestRoute && bestRoute.winRate > 30 && bestRoute.winRate < 95;
  checks.push({ name: "Win rate 30-95%", ok: wrOk, detail: `best: ${bestRoute?.winRate?.toFixed(1) || 0}%` });

  // 4. EV positive
  const evOk = bestRoute && bestRoute.ev > 0;
  checks.push({ name: "EV > $0", ok: evOk, detail: `$${bestRoute?.ev?.toFixed(4) || 0}` });

  // 5. EV >= min profit
  const evMinOk = bestRoute && bestRoute.ev >= MIN_PROFIT;
  checks.push({ name: `EV >= $${MIN_PROFIT}`, ok: evMinOk, detail: `$${bestRoute?.ev?.toFixed(4) || 0}` });

  // 6. No single-hour bias
  const hourBuckets = {};
  for (const d of allData) {
    hourBuckets[d.hour] = (hourBuckets[d.hour] || 0) + 1;
  }
  const maxHourPct = Math.max(...Object.values(hourBuckets)) / allData.length * 100;
  checks.push({ name: "No hour bias (<30%)", ok: maxHourPct < 30, detail: `max: ${maxHourPct.toFixed(0)}%` });

  // 7. Consecutive losses
  const sorted = [...allData].sort((a, b) => a.time - b.time);
  let maxConsec = 0, consec = 0;
  for (const d of sorted) {
    if (!d.win) { consec++; maxConsec = Math.max(maxConsec, consec); }
    else { consec = 0; }
  }
  checks.push({ name: "Max consec loss <10", ok: maxConsec < 10, detail: `max: ${maxConsec}` });

  const passed = checks.filter(c => c.ok).length;
  return { checks, passed, total: checks.length };
}

// ── telegram formatting ──────────────────────────────────────────────

function buildProgressMessage(count) {
  const pct = (count / TARGET_SAMPLES * 100).toFixed(0);
  return [
    `📊 BOB Claw Spread Report`,
    `Samples: ${count}/${TARGET_SAMPLES} (${pct}%)`,
    `Status: 수집 중... (${MIN_SAMPLES}개 필요)`,
  ].join("\n");
}

function buildAnalysisMessage(sampleCount, bestStat, checklist) {
  const lines = [
    `📊 BOB Claw Spread Report`,
    `Samples: ${sampleCount}/${TARGET_SAMPLES}`,
  ];
  if (bestStat) {
    lines.push(`Best: ${bestStat.label}`);
    lines.push(`  EV: $${bestStat.ev.toFixed(2)} | WR: ${bestStat.winRate.toFixed(0)}% | Median: $${bestStat.median.toFixed(2)}`);
  }
  lines.push(`Overfit: ${checklist.passed}/${checklist.total} ✅`);

  if (checklist.passed === checklist.total) {
    lines.push(`Status: ✅ 모든 체크 통과`);
  } else if (sampleCount < TARGET_SAMPLES) {
    lines.push(`Status: 수집 계속 중...`);
  } else {
    lines.push(`Status: ⚠️ 일부 체크 미통과`);
  }
  return lines.join("\n");
}

function buildCanaryReadyMessage(bestStat) {
  return [
    `🟢 Canary 준비 완료!`,
    `7/7 과적합 체크 통과`,
    `EV: $${bestStat.ev.toFixed(2)} | WR: ${bestStat.winRate.toFixed(0)}%`,
    `→ npm run trigger:arb --once --simulate`,
  ].join("\n");
}

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("[auto-analyze] Checking spread data...");

  const lineCount = countLines(DATA_FILE);
  console.log(`[auto-analyze] Samples: ${lineCount}/${TARGET_SAMPLES}`);

  if (lineCount < MIN_SAMPLES) {
    console.log(`[auto-analyze] Not enough samples (need ${MIN_SAMPLES}). Progress: ${lineCount}/${TARGET_SAMPLES}`);
    const msg = buildProgressMessage(lineCount);
    await notify(msg);
    return;
  }

  // Full analysis
  console.log(`[auto-analyze] Running full analysis (${lineCount} samples)...`);
  const samples = loadSamples();

  const allData = [];
  const stats = [];
  for (const route of ROUTES) {
    const data = analyzeRoute(samples, route);
    allData.push(...data);
    const s = computeStats(route, data);
    if (s) stats.push(s);
  }

  if (stats.length === 0) {
    console.log("[auto-analyze] No valid route data found.");
    return;
  }

  const bestStat = stats.reduce((a, b) => a.ev > b.ev ? a : b);
  const checklist = runOverfitChecklist(allData, stats);
  const hourly = computeHourlyDistribution(allData);

  // Console summary
  console.log(`[auto-analyze] Best route: ${bestStat.label}`);
  console.log(`[auto-analyze] EV: $${bestStat.ev.toFixed(4)} | WR: ${bestStat.winRate.toFixed(1)}%`);
  console.log(`[auto-analyze] Overfit: ${checklist.passed}/${checklist.total}`);
  for (const c of checklist.checks) {
    console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}: ${c.detail}`);
  }

  // Save report
  const report = {
    generatedAt: new Date().toISOString(),
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
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`[auto-analyze] Report saved: ${REPORT_FILE}`);

  // Telegram notification
  const msg = buildAnalysisMessage(samples.length, bestStat, checklist);
  await notify(msg);

  // Special canary-ready alert
  if (checklist.passed === checklist.total) {
    const canaryMsg = buildCanaryReadyMessage(bestStat);
    await notify(canaryMsg);
  }
}

async function notify(text) {
  console.log(`[auto-analyze] Telegram:\n${text}\n`);
  try {
    const result = await sendTelegramMessage({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      text,
    });
    if (result.skipped) {
      console.log("[auto-analyze] Telegram not configured — skipped.");
    } else if (result.sent) {
      console.log("[auto-analyze] Telegram sent.");
    }
  } catch (err) {
    console.error("[auto-analyze] Telegram error:", err.message);
  }
}

main().catch(err => {
  console.error("[auto-analyze] Fatal:", err);
  process.exit(1);
});
