#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildTransactionLedger, buildTransactionLedgerNav } from "../audit/transaction-ledger.mjs";
import { emptyPricesUsd, latestPriceSnapshot, pricesFromSnapshot } from "../market/prices.mjs";

function parseArgs(argv = []) {
  const out = {
    json: argv.includes("--json"),
    baselineUsd: null,
    limit: 20,
  };
  for (const arg of argv) {
    if (arg.startsWith("--baseline-usd=")) {
      const value = Number(arg.slice("--baseline-usd=".length));
      if (Number.isFinite(value)) out.baselineUsd = value;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isInteger(value) && value >= 0) out.limit = value;
    }
  }
  return out;
}

function fmtUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : "n/a";
}

function shortHash(value) {
  if (!value) return "n/a";
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

async function readOptionalJsonl(dir, name) {
  return readJsonl(dir, name).catch(() => []);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readLedgerPrices(dataDir = config.dataDir) {
  const latestJson = await readJsonIfExists(join(dataDir, "price-snapshot.json"));
  if (latestJson) return pricesFromSnapshot(latestJson);
  const latestJsonl = latestPriceSnapshot(await readOptionalJsonl(dataDir, "market-price-snapshots"));
  return latestJsonl ? pricesFromSnapshot(latestJsonl) : emptyPricesUsd();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [
    inventoryRecords,
    receiptRecords,
    signerAuditRecords,
    gatewayOfframpRecords,
    inboundEvents,
    transferAttributionRecords,
    signerRevertCostRecords,
    prices,
  ] = await Promise.all([
    readOptionalJsonl(config.dataDir, "whole-wallet-inventory"),
    readOptionalJsonl(config.dataDir, "receipt-reconciliations"),
    readOptionalJsonl("./logs", "signer-audit"),
    readOptionalJsonl(config.dataDir, "gateway-btc-offramp-executions"),
    readOptionalJsonl(`${config.dataDir}/treasury`, "inbound-events"),
    readOptionalJsonl(`${config.dataDir}/treasury`, "inbound-transfer-attributions"),
    readOptionalJsonl(config.dataDir, "signer-revert-receipt-costs"),
    readLedgerPrices(config.dataDir),
  ]);
  const currentNav = buildTransactionLedgerNav({ inventoryRecords });
  const ledger = buildTransactionLedger({
    receiptRecords,
    signerAuditRecords,
    gatewayOfframpRecords,
    inboundEvents,
    transferAttributionRecords,
    signerRevertCostRecords,
    prices,
    currentNav,
    baselineUsd: args.baselineUsd,
  });

  if (args.json) {
    console.log(JSON.stringify(ledger, null, 2));
    return;
  }

  console.log(`currentNav=${fmtUsd(ledger.currentNav?.totalUsd)} confidence=${ledger.currentNav?.confidence || "n/a"} observedAt=${ledger.currentNav?.observedAt || "n/a"}`);
  if (ledger.currentNav?.externalReferenceWarning) {
    console.log(`navWarning=${ledger.currentNav.externalReferenceWarning} maxExternalReference=${fmtUsd(ledger.currentNav.maxExternalReference?.totalUsd)}`);
  }
  if (Number.isFinite(ledger.currentNav?.excludedDoubleCountInventoryCount)) {
    console.log(`excludedDoubleCountInventoryRows=${ledger.currentNav.excludedDoubleCountInventoryCount}`);
  }
  if (Number.isFinite(ledger.baseline.baselineUsd)) {
    console.log(`baseline=${fmtUsd(ledger.baseline.baselineUsd)} deltaFromCurrent=${fmtUsd(ledger.baseline.deltaFromCurrentUsd)}`);
  }
  console.log(`rows=${ledger.summary.rowCount} receipts=${ledger.summary.receiptRowCount} inboundDiffs=${ledger.summary.inboundRowCount} offramps=${ledger.summary.gatewayOfframpRowCount} quantifiedReverts=${ledger.summary.quantifiedRevertCount} unquantifiedReverts=${ledger.summary.unquantifiedRevertCount}`);
  console.log(`inboundAttributed=${ledger.summary.attributedInboundCount} attributedUsd=${fmtUsd(ledger.summary.attributedInboundUsd)} inboundUnattributed=${ledger.summary.unattributedInboundCount} unattributedUsd=${fmtUsd(ledger.summary.unattributedInboundUsd)}`);
  console.log(`reconciledRealizedNetPnl=${fmtUsd(ledger.summary.reconciledRealizedNetPnlUsd)} recordedNetIncludingFailed=${fmtUsd(ledger.summary.recordedNetPnlUsd)} totalCost=${fmtUsd(ledger.summary.totalCostUsd)} receiptGas=${fmtUsd(ledger.summary.receiptGasUsd)} inboundDiff=${fmtUsd(ledger.summary.inboundDiffUsd)}`);
  console.log("categories:");
  for (const item of ledger.categories) {
    console.log(`- ${item.category} rows=${item.rowCount} cost=${fmtUsd(item.costUsd)} pnl=${fmtUsd(item.realizedNetPnlUsd)} gas=${fmtUsd(item.receiptGasUsd)} inbound=${fmtUsd(item.inboundDiffUsd)}`);
  }
  const costly = ledger.rows
    .filter((row) => Number.isFinite(row.costUsd) && row.costUsd > 0)
    .sort((left, right) => right.costUsd - left.costUsd)
    .slice(0, args.limit);
  if (costly.length > 0) {
    console.log(`topCostRows limit=${args.limit}:`);
    for (const row of costly) {
      console.log(`- ${row.observedAt || "n/a"} ${row.chain || "n/a"} ${row.category} ${row.kind || "n/a"} cost=${fmtUsd(row.costUsd)} gas=${fmtUsd(row.receiptGasUsd)} tx=${shortHash(row.txHash)}`);
    }
  }
  console.log(`caveats=${ledger.caveats.join(",")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
