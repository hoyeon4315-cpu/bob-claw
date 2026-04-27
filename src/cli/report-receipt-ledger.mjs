#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildReceiptLedgerSummary } from "../ledger/receipt-reconciliation.mjs";
import {
  filterRecordsByReportingPnlBaseline,
  readReportingPnlBaseline,
  summarizeReportingPnlBaseline,
} from "../status/reporting-pnl-baseline.mjs";

function parseArgs(argv) {
  return {
    json: new Set(argv).has("--json"),
    allTime: new Set(argv).has("--all-time"),
  };
}

function formatUsd(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = await readJsonl(config.dataDir, "receipt-reconciliations");
  const reportingPnlBaseline = await readReportingPnlBaseline({ dataDir: config.dataDir });
  const scopedRecords = args.allTime
    ? records
    : filterRecordsByReportingPnlBaseline(records, reportingPnlBaseline);
  const payload = {
    ...buildReceiptLedgerSummary(scopedRecords),
    reportingPnlBaseline: summarizeReportingPnlBaseline(reportingPnlBaseline, {
      applied: !args.allTime,
    }),
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const summary = payload;
  if (summary.reportingPnlBaseline.active) {
    console.log(
      `reportingPnlBaseline=${summary.reportingPnlBaseline.anchoredAt} applied=${summary.reportingPnlBaseline.applied}`,
    );
  }

  console.log(`recordCount=${summary.summary.recordCount}`);
  console.log(`reconciledCount=${summary.summary.reconciledCount}`);
  console.log(`failedCount=${summary.summary.failedCount}`);
  console.log(`pendingOutputCount=${summary.summary.pendingOutputCount}`);
  console.log(`realizedNetPnlUsd=${formatUsd(summary.summary.realizedNetPnlUsd)}`);
  console.log(`medianRealizedNetPnlUsd=${formatUsd(summary.summary.medianRealizedNetPnlUsd)}`);
  console.log(`totalEstimatedNetPnlUsd=${formatUsd(summary.summary.totalEstimatedNetPnlUsd)}`);
  console.log(`medianEstimatedNetPnlUsd=${formatUsd(summary.summary.medianEstimatedNetPnlUsd)}`);
  console.log(`totalNetDriftUsd=${formatUsd(summary.summary.totalNetDriftUsd)}`);
  console.log(`medianNetDriftUsd=${formatUsd(summary.summary.medianNetDriftUsd)}`);
  console.log(`failedGasCostUsd=${formatUsd(summary.summary.failedGasCostUsd)}`);
  console.log(`totalExecutionGasDriftUsd=${formatUsd(summary.summary.totalExecutionGasDriftUsd)}`);
  console.log(`medianExecutionGasDriftUsd=${formatUsd(summary.summary.medianExecutionGasDriftUsd)}`);
  console.log(`medianOutputDriftUsd=${formatUsd(summary.summary.medianOutputDriftUsd)}`);
  console.log(`medianFillDriftBps=${Number.isFinite(summary.summary.medianFillDriftBps) ? summary.summary.medianFillDriftBps.toFixed(2) : "n/a"}`);
  console.log(`estimatedPositiveRealizedNegativeCount=${summary.summary.estimatedPositiveRealizedNegativeCount}`);

  for (const route of summary.routes) {
    console.log(
      `${route.routeKey || "unknown"} count=${route.count} reconciled=${route.reconciledCount} failed=${route.failedCount} realizedNetPnlUsd=${formatUsd(route.realizedNetPnlUsd)} estimatedNetPnlUsd=${formatUsd(route.totalEstimatedNetPnlUsd)} netDriftUsd=${formatUsd(route.totalNetDriftUsd)} gasDriftUsd=${formatUsd(route.totalExecutionGasDriftUsd)} estPosRealNeg=${route.estimatedPositiveRealizedNegativeCount}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
