#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildCapitalForensicsReport } from "../audit/capital-forensics.mjs";

function parseArgs(argv = []) {
  const out = {
    json: argv.includes("--json"),
    baselineUsd: null,
  };
  for (const arg of argv) {
    if (arg.startsWith("--baseline-usd=")) {
      const value = Number(arg.slice("--baseline-usd=".length));
      if (Number.isFinite(value)) out.baselineUsd = value;
    }
  }
  return out;
}

function fmtUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [inventoryRecords, receiptRecords, inboundEvents] = await Promise.all([
    readJsonl(config.dataDir, "whole-wallet-inventory"),
    readJsonl(config.dataDir, "receipt-reconciliations"),
    readJsonl(`${config.dataDir}/treasury`, "inbound-events"),
  ]);
  const report = buildCapitalForensicsReport({
    inventoryRecords,
    receiptRecords,
    inboundEvents,
    baselineUsd: args.baselineUsd,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`currentNav=${fmtUsd(report.current?.totalUsd)} observedAt=${report.current?.observedAt || "n/a"} confidence=${report.confidence.currentNav}`);
  console.log(`walletUsd=${fmtUsd(report.current?.walletUsd)} protocolUsd=${fmtUsd(report.current?.protocolUsd)} coverage=${report.current?.walletCoverage || "n/a"} scanErrors=${report.current?.scanErrorCount ?? "n/a"} unknownPositiveBalances=${report.current?.unknownAssetBalanceCount ?? "n/a"}`);
  if (Number.isFinite(report.baseline.baselineUsd)) {
    console.log(`baseline=${fmtUsd(report.baseline.baselineUsd)} deltaFromCurrent=${fmtUsd(report.baseline.deltaFromCurrentUsd)}`);
  }
  console.log(`maxLocalInventory=${fmtUsd(report.history.maxLocalInventory?.totalUsd)} at=${report.history.maxLocalInventory?.observedAt || "n/a"}`);
  console.log(`excludedDoubleCountInventoryRows=${report.history.excludedDoubleCountInventoryCount}`);
  console.log(`maxExternalReference=${fmtUsd(report.history.maxExternalReference?.totalUsd)} at=${report.history.maxExternalReference?.observedAt || "n/a"} warning=${report.history.externalReferenceWarning || "none"}`);
  console.log(`receiptRecords=${report.receipts.summary.recordCount} reconciled=${report.receipts.summary.reconciledCount} failed=${report.receipts.summary.failedCount} pending=${report.receipts.summary.pendingOutputCount}`);
  console.log(`receiptRealizedNetPnl=${fmtUsd(report.receipts.summary.realizedNetPnlUsd)} receiptGas=${fmtUsd(report.receipts.summary.totalReceiptGasUsd)} failedGas=${fmtUsd(report.receipts.summary.failedGasCostUsd)}`);
  console.log("topReceiptCostKinds:");
  for (const item of report.receipts.topKinds.slice(0, 6)) {
    console.log(`- ${item.kind} count=${item.recordCount} pnl=${fmtUsd(item.realizedNetPnlUsd)} gas=${fmtUsd(item.totalReceiptGasUsd)}`);
  }
  console.log(`inboundDiffEvents=${report.inbound.eventCount} estimatedUsdEvents=${report.inbound.estimatedUsdEventCount} diffTotal=${fmtUsd(report.inbound.totalEstimatedUsd)} caveat=${report.inbound.caveat}`);
  console.log(`caveats=${report.accountingCaveats.join(",")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
