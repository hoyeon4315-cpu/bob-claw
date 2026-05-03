// Codex budget lock — separate from $DEV_LOCK to honour AGENTS.md
// (no autonomous toggling of dev-lock or kill-switch).
//
// Behaviour:
//   - Tally daily usage from logs/codex-audit.jsonl (UTC date).
//   - If usage >= cap, write a "budget-lock" sentinel file
//     (data/codex/budget-lock.json) and refuse further calls.
//   - Auto-clear when UTC date rolls over and usage <= 0.
//   - All toggles are recorded in logs/codex-budget-lock-audit.jsonl.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { CODEX_DAILY_HARD_CAP_USD, CODEX_BUDGET_LOCK_PATH } from "../config/codex-budget.mjs";

const AUDIT_PATH_ENV = "CODEX_BUDGET_LOCK_AUDIT";
const CODEX_AUDIT_PATH_ENV = "CODEX_AUDIT_LOG";
function auditPath() { return process.env[AUDIT_PATH_ENV] || "logs/codex-budget-lock-audit.jsonl"; }
function codexAuditPath() { return process.env[CODEX_AUDIT_PATH_ENV] || "logs/codex-audit.jsonl"; }
function lockPath() { return process.env.CODEX_BUDGET_LOCK_PATH || CODEX_BUDGET_LOCK_PATH; }

function utcDate(ts = new Date()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function readJsonOrNull(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function writeJson(path, value) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function appendAudit(record) {
  try {
    const p = auditPath();
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(record) + "\n");
  } catch {
    // intentional: never crash caller on audit failure
  }
}

export function tallyDailyUsageUsd({ now = new Date(), auditPath: ap = codexAuditPath() } = {}) {
  if (!existsSync(ap)) return 0;
  const today = utcDate(now);
  const lines = readFileSync(ap, "utf8").split(/\n/).filter(Boolean);
  let total = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj?.ts) continue;
      if (utcDate(obj.ts) !== today) continue;
      total += Number(obj.costUsd) || 0;
    } catch {
      // skip
    }
  }
  return total;
}

export function readBudgetLock(path = lockPath()) {
  return readJsonOrNull(path);
}

export function isBudgetLocked({ now = new Date(), path = lockPath() } = {}) {
  const lock = readJsonOrNull(path);
  if (!lock || !lock.activeUntilDate) return false;
  return utcDate(now) <= lock.activeUntilDate;
}

export function setBudgetLock({
  reason,
  capUsd = CODEX_DAILY_HARD_CAP_USD,
  usageUsd,
  now = new Date(),
  path = lockPath(),
} = {}) {
  const today = utcDate(now);
  const value = {
    activatedAt: new Date(now).toISOString(),
    activeUntilDate: today,
    capUsd,
    usageUsd,
    reason,
  };
  writeJson(path, value);
  appendAudit({ ts: value.activatedAt, action: "set", reason, capUsd, usageUsd });
  return value;
}

export function clearBudgetLock({ reason = "auto_daily_rollover", now = new Date(), path = lockPath() } = {}) {
  if (!existsSync(path)) return null;
  const before = readJsonOrNull(path);
  writeJson(path, { clearedAt: new Date(now).toISOString(), previous: before, reason });
  appendAudit({ ts: new Date(now).toISOString(), action: "clear", reason });
  return before;
}

export async function budgetGate({ now = new Date(), capUsd = CODEX_DAILY_HARD_CAP_USD, path = lockPath(), auditPath: ap = codexAuditPath() } = {}) {
  if (isBudgetLocked({ now, path })) {
    return { ok: false, reason: "budget_locked", capUsd };
  }
  const usage = tallyDailyUsageUsd({ now, auditPath: ap });
  if (usage >= capUsd) {
    setBudgetLock({ reason: "daily_cap_reached", capUsd, usageUsd: usage, now, path });
    return { ok: false, reason: "daily_cap_reached", capUsd, usageUsd: usage };
  }
  return { ok: true, capUsd, usageUsd: usage };
}
