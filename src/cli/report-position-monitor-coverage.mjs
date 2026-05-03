// report-position-monitor-coverage — past-7d position-monitor tick coverage.

import { readFileSync, existsSync } from "node:fs";

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export function buildMonitorCoverage({
  auditPath = "logs/position-monitor-audit.jsonl",
  expectedIntervalSec = 300,
  now = new Date(),
  days = 7,
} = {}) {
  const records = readJsonl(auditPath);
  const cutoffMs = new Date(now).getTime() - days * 86400 * 1000;
  const recent = records.filter((r) => r?.ts && new Date(r.ts).getTime() >= cutoffMs);
  const expectedTicks = Math.floor((days * 86400) / expectedIntervalSec);
  const coverage = expectedTicks > 0 ? recent.length / expectedTicks : 0;
  const totalActions = recent.reduce((acc, r) => acc + (Number(r.count) || 0), 0);
  let recommendation = "hold";
  if (coverage < 0.3) recommendation = "increase_interval";
  else if (coverage > 0.8 && totalActions / Math.max(1, recent.length) > 5) recommendation = "decrease_interval";
  return {
    generatedAt: new Date(now).toISOString(),
    days,
    expectedIntervalSec,
    expectedTicks,
    actualTicks: recent.length,
    coverage,
    totalActions,
    recommendation,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(buildMonitorCoverage(), null, 2) + "\n");
}
