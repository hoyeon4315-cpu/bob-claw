#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { readTransactionByHash, readTransactionReceipt } from "../evm/transaction-read.mjs";
import { buildReceiptReconciliation } from "../ledger/receipt-reconciliation.mjs";

function parseArgs(argv) {
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
    chain: options.chain || null,
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
  if (!args.chain) throw new Error("--chain is required");
  if (!args.txHash) throw new Error("--tx-hash is required");

  const [prices, receipt, transaction, routeContext] = await Promise.all([
    getCoinGeckoPricesUsd().catch(() => emptyPricesUsd()),
    readTransactionReceipt(args.chain, args.txHash),
    readTransactionByHash(args.chain, args.txHash),
    loadRouteContext(args.routeKey, args.amount),
  ]);

  const record = buildReceiptReconciliation({
    chain: args.chain,
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

  const store = new JsonlStore(config.dataDir);
  await store.append("receipt-reconciliations", record);

  if (args.json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  console.log(`reconciliationStatus=${record.reconciliationStatus}`);
  console.log(`chain=${record.chain}`);
  console.log(`txHash=${record.txHash}`);
  if (record.routeContext?.routeKey) {
    console.log(`routeKey=${record.routeContext.routeKey}`);
  }
  console.log(`receiptGasUsd=${Number.isFinite(record.realized.receiptGasUsd) ? record.realized.receiptGasUsd.toFixed(6) : "n/a"}`);
  console.log(`actualKnownCostUsd=${Number.isFinite(record.realized.actualKnownCostUsd) ? record.realized.actualKnownCostUsd.toFixed(6) : "n/a"}`);
  console.log(`realizedNetPnlUsd=${Number.isFinite(record.realized.realizedNetPnlUsd) ? record.realized.realizedNetPnlUsd.toFixed(6) : "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
