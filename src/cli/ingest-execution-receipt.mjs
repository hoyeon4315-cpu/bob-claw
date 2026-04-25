#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { readTransactionByHash, readTransactionReceipt } from "../evm/transaction-read.mjs";
import { buildReceiptReconciliation } from "../ledger/receipt-reconciliation.mjs";
import { buildExecutionSubmissionEvent, buildExecutionReconciliationEvent, latestExecutionEvent } from "../execution/journal.mjs";
import { readRefillJobById } from "../executor/helpers/refill-job-store.mjs";

export function parseArgs(argv) {
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
    jobId: options["job-id"] || null,
    txHash: options["tx-hash"] || null,
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    actualOutputUnits: options["actual-output-units"] || null,
    actualOutputUsd: options["actual-output-usd"] ? Number(options["actual-output-usd"]) : null,
    outputChain: options["output-chain"] || null,
    outputToken: options["output-token"] || null,
    outputPriceUsd: options["output-price-usd"] ? Number(options["output-price-usd"]) : null,
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadRouteContext(routeKey, amount) {
  if (!routeKey || !amount) return null;
  const snapshot = await readJsonIfExists(join(config.dataDir, "gateway-scores.json"));
  return (snapshot?.scores || []).find((item) => item.routeKey === routeKey && String(item.amount) === String(amount)) || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobId) throw new Error("--job-id is required");
  if (!args.txHash) throw new Error("--tx-hash is required");

  const [jobs, events] = await Promise.all([
    readRefillJobById(config.dataDir, args.jobId),
    readJsonl(config.dataDir, "execution-journal"),
  ]);
  const job = jobs;
  if (!job) throw new Error(`Job not found: ${args.jobId}`);

  const [prices, receipt, transaction, routeContext] = await Promise.all([
    getCoinGeckoPricesUsd().catch(() => emptyPricesUsd()),
    readTransactionReceipt(job.chain, args.txHash),
    readTransactionByHash(job.chain, args.txHash),
    loadRouteContext(args.routeKey, args.amount),
  ]);

  const store = new JsonlStore(config.dataDir);
  const latest = latestExecutionEvent(events, job.jobId);
  const appended = [];
  if (!latest || latest.status !== "submitted" || latest.txHash !== args.txHash) {
    const submitted = buildExecutionSubmissionEvent({
      job,
      txHash: args.txHash,
    });
    await store.append("execution-journal", submitted);
    appended.push(submitted);
  }

  const receiptRecord = buildReceiptReconciliation({
    kind: "treasury_refill",
    chain: job.chain,
    txHash: args.txHash,
    routeContext,
    receipt,
    transaction,
    prices,
    output: {
      actualOutputUnits: args.actualOutputUnits,
      actualOutputUsd: args.actualOutputUsd,
      chain: args.outputChain,
      token: args.outputToken,
      priceUsd: args.outputPriceUsd,
    },
  });
  await store.append("receipt-reconciliations", receiptRecord);

  const reconciled = buildExecutionReconciliationEvent({
    job,
    txHash: args.txHash,
    receiptRecord,
  });
  await store.append("execution-journal", reconciled);
  appended.push(reconciled);

  const output = {
    jobId: job.jobId,
    txHash: args.txHash,
    receiptRecord,
    executionEvents: appended,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`jobId=${job.jobId}`);
  console.log(`txHash=${args.txHash}`);
  console.log(`reconciliationStatus=${receiptRecord.reconciliationStatus}`);
  console.log(`executionStatus=${reconciled.status}`);
  console.log(`actualKnownCostUsd=${Number.isFinite(receiptRecord.realized.actualKnownCostUsd) ? receiptRecord.realized.actualKnownCostUsd.toFixed(6) : "n/a"}`);
  console.log(`realizedNetPnlUsd=${Number.isFinite(receiptRecord.realized.realizedNetPnlUsd) ? receiptRecord.realized.realizedNetPnlUsd.toFixed(6) : "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
