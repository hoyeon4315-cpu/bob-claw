import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildDefaultRiskPolicy } from "./policy.mjs";

const DATA_DIR = config.dataDir || "./data";
const SESSION_NAME = "canary-session";
const EMERGENCY_STOP_FILE = "emergency-stop.json";

const policy = buildDefaultRiskPolicy();

// ── Helpers ────────────────────────────────────────────────────────

function todayDateStr(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function filterToday(records, now = new Date()) {
  const today = todayDateStr(now);
  return records.filter((r) => r.timestamp?.startsWith(today));
}

function countConsecutiveFailures(records) {
  let count = 0;
  const sorted = [...records].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
  );
  for (const r of sorted) {
    if (r.outcome === "fail") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

async function readEmergencyStop() {
  try {
    const raw = await readFile(join(DATA_DIR, EMERGENCY_STOP_FILE), "utf8");
    const data = JSON.parse(raw);
    return data.stopped === true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

// ── Exports ────────────────────────────────────────────────────────

/**
 * Pre-trade safety check.
 * Returns { allowed, reason, dailyPnl, consecFails }.
 */
export async function canaryCheck({ mode = "canary", tradeProfit = 0, dryRun = true } = {}) {
  // Emergency stop overrides everything
  if (await readEmergencyStop()) {
    return { allowed: false, reason: "emergency_stop_active", dailyPnl: 0, consecFails: 0 };
  }

  const records = await readJsonl(DATA_DIR, SESSION_NAME);
  const todayRecords = filterToday(records);

  const dailyPnl = todayRecords.reduce((sum, r) => sum + (r.profit ?? 0), 0);
  const consecFails = countConsecutiveFailures(records);

  const dailyLimit = mode === "canary"
    ? policy.canaryDailyLossCapUsd
    : policy.normalDailyLossCapUsd;

  // Max consecutive failures
  if (consecFails >= policy.maxConsecutiveFailures) {
    return { allowed: false, reason: "max_consecutive_failures", dailyPnl, consecFails };
  }

  // Daily loss cap (check if adding this trade would breach it)
  if (dailyPnl <= -dailyLimit) {
    return { allowed: false, reason: "daily_loss_cap_reached", dailyPnl, consecFails };
  }

  // Per-trade minimum profit (skip for dry-run logging)
  if (!dryRun && tradeProfit < policy.minNetProfitUsd) {
    return { allowed: false, reason: "below_min_profit", dailyPnl, consecFails };
  }

  return { allowed: true, reason: "ok", dailyPnl, consecFails };
}

/**
 * Record a trade result to the canary session log.
 */
export async function recordTradeResult({ profit, route, txHash = null, dryRun = true } = {}) {
  const store = new JsonlStore(DATA_DIR);
  const outcome = profit >= 0 ? "success" : "fail";
  await store.append(SESSION_NAME, {
    timestamp: new Date().toISOString(),
    route: route || "unknown",
    profit: profit ?? 0,
    outcome,
    txHash,
    dryRun,
  });
}

/**
 * Return current canary status summary.
 */
export async function getCanaryStatus() {
  const stopped = await readEmergencyStop();
  const records = await readJsonl(DATA_DIR, SESSION_NAME);
  const todayRecords = filterToday(records);

  const dailyPnl = todayRecords.reduce((sum, r) => sum + (r.profit ?? 0), 0);
  const consecFails = countConsecutiveFailures(records);
  const tradesTotal = todayRecords.length;

  // Infer mode from recent activity — default to canary
  const mode = "canary";
  const dailyLimit = mode === "canary"
    ? policy.canaryDailyLossCapUsd
    : policy.normalDailyLossCapUsd;

  return {
    mode,
    dailyPnl,
    dailyLimit,
    consecFails,
    tradesTotal,
    stopped,
  };
}
