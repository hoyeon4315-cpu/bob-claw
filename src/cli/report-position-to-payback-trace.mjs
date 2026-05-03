// report-position-to-payback-trace — pure-data CLI.
// Maps realized profit from exits in the requested period to payback
// disbursement records. No live state mutation.

import { readFileSync, existsSync } from "node:fs";

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export function tracePeriod({
  exitsPath = "logs/realized-pnl.jsonl",
  paybackDisbursementsPath = "logs/payback-disbursements.jsonl",
  period = null,
} = {}) {
  const exits = readJsonl(exitsPath);
  const disbursements = readJsonl(paybackDisbursementsPath);
  const filteredDisb = period ? disbursements.filter((d) => d.periodId === period) : disbursements;
  const totalPaidUsd = filteredDisb.reduce((acc, d) => acc + (Number(d.amountUsd) || 0), 0);
  const exitsByDisb = {};
  for (const d of filteredDisb) {
    exitsByDisb[d.disbursementId] = exits.filter((e) => Array.isArray(d.sourceExitIds) && d.sourceExitIds.includes(e.exitId));
  }
  return {
    period,
    disbursementsCount: filteredDisb.length,
    totalPaidUsd,
    matchedExits: Object.fromEntries(
      Object.entries(exitsByDisb).map(([k, list]) => [k, {
        count: list.length,
        netUsd: list.reduce((acc, e) => acc + (Number(e.netUsd) || 0), 0),
      }])
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const periodArg = process.argv.find((a) => a.startsWith("--period="));
  const period = periodArg ? periodArg.slice("--period=".length) : null;
  const out = tracePeriod({ period });
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
