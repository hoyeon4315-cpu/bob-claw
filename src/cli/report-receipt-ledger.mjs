#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildReceiptLedgerSummary } from "../ledger/receipt-reconciliation.mjs";

function parseArgs(argv) {
  return {
    json: new Set(argv).has("--json"),
  };
}

function formatUsd(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = await readJsonl(config.dataDir, "receipt-reconciliations");
  const summary = buildReceiptLedgerSummary(records);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`recordCount=${summary.summary.recordCount}`);
  console.log(`reconciledCount=${summary.summary.reconciledCount}`);
  console.log(`failedCount=${summary.summary.failedCount}`);
  console.log(`pendingOutputCount=${summary.summary.pendingOutputCount}`);
  console.log(`realizedNetPnlUsd=${formatUsd(summary.summary.realizedNetPnlUsd)}`);
  console.log(`medianRealizedNetPnlUsd=${formatUsd(summary.summary.medianRealizedNetPnlUsd)}`);
  console.log(`failedGasCostUsd=${formatUsd(summary.summary.failedGasCostUsd)}`);
  console.log(`medianFillDriftBps=${Number.isFinite(summary.summary.medianFillDriftBps) ? summary.summary.medianFillDriftBps.toFixed(2) : "n/a"}`);

  for (const route of summary.routes) {
    console.log(
      `${route.routeKey || "unknown"} count=${route.count} reconciled=${route.reconciledCount} failed=${route.failedCount} realizedNetPnlUsd=${formatUsd(route.realizedNetPnlUsd)}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
