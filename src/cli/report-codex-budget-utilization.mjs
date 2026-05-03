// report-codex-budget-utilization — past-7d Codex spend vs cap.
// Recommends interval adjustments WITHOUT applying them.

import { readFileSync, existsSync } from "node:fs";
import { CODEX_DAILY_HARD_CAP_USD } from "../config/codex-budget.mjs";

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function utcDate(ts) { return new Date(ts).toISOString().slice(0, 10); }

export function buildUtilizationReport({
  auditPath = "logs/codex-audit.jsonl",
  capUsd = CODEX_DAILY_HARD_CAP_USD,
  now = new Date(),
  days = 7,
} = {}) {
  const records = readJsonl(auditPath);
  const cutoff = new Date(now).getTime() - days * 86400 * 1000;
  const byDay = new Map();
  for (const r of records) {
    if (!r?.ts) continue;
    if (new Date(r.ts).getTime() < cutoff) continue;
    const day = utcDate(r.ts);
    byDay.set(day, (byDay.get(day) || 0) + (Number(r.costUsd) || 0));
  }
  const entries = [...byDay.entries()].sort();
  const avg = entries.length ? entries.reduce((a, [, v]) => a + v, 0) / entries.length : 0;
  const utilization = capUsd > 0 ? avg / capUsd : 0;
  let recommendation = "hold";
  if (utilization < 0.3) recommendation = "increase_interval";
  else if (utilization > 0.8) recommendation = "decrease_interval";
  return {
    generatedAt: new Date(now).toISOString(),
    capUsd,
    days,
    perDay: Object.fromEntries(entries),
    avgDailyUsd: avg,
    utilization,
    recommendation,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(buildUtilizationReport(), null, 2) + "\n");
}
