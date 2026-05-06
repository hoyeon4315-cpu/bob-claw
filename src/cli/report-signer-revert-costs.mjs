#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readTransactionReceipt } from "../evm/transaction-read.mjs";
import { emptyPricesUsd, latestPriceSnapshot, pricesFromSnapshot } from "../market/prices.mjs";
import { buildSignerRevertReceiptCostReport } from "../audit/signer-revert-receipt-costs.mjs";

function parseArgs(argv = []) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    limit: options.limit ? Number(options.limit) : Infinity,
  };
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

async function readPrices() {
  const latestJson = await readJsonIfExists(join(config.dataDir, "price-snapshot.json"));
  if (latestJson) return pricesFromSnapshot(latestJson);
  const latestJsonl = latestPriceSnapshot(await readOptionalJsonl(config.dataDir, "market-price-snapshots"));
  return latestJsonl ? pricesFromSnapshot(latestJsonl) : emptyPricesUsd();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [
    receiptRecords,
    signerAuditRecords,
    existingCostRecords,
    prices,
  ] = await Promise.all([
    readOptionalJsonl(config.dataDir, "receipt-reconciliations"),
    readOptionalJsonl("./logs", "signer-audit"),
    readOptionalJsonl(config.dataDir, "signer-revert-receipt-costs"),
    readPrices(),
  ]);

  const report = await buildSignerRevertReceiptCostReport({
    receiptRecords,
    signerAuditRecords,
    existingCostRecords,
    prices,
    limit: args.limit,
    receiptReader: (chain, txHash) => readTransactionReceipt(chain, txHash, { timeoutMs: 10_000 }),
  });

  if (args.write && report.records.length > 0) {
    const store = new JsonlStore(config.dataDir);
    for (const record of report.records) {
      await store.append("signer-revert-receipt-costs", record);
    }
    report.summary.appendedCount = report.records.length;
  } else {
    report.summary.appendedCount = 0;
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`candidates=${report.summary.candidateCount} attributed=${report.summary.attributedCount} failures=${report.summary.failureCount} existing=${report.summary.existingCostCount} appended=${report.summary.appendedCount}`);
  for (const record of report.records.slice(0, 10)) {
    console.log(`${record.chain} ${record.txHash} feeWei=${record.feeWei} costUsd=${Number.isFinite(record.estimatedUsd) ? record.estimatedUsd.toFixed(8) : "n/a"}`);
  }
  for (const failure of report.failures.slice(0, 10)) {
    console.log(`failed ${failure.chain} ${failure.txHash}: ${failure.message}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
