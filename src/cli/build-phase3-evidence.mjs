import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildPhase3Evidence } from "../strategy/phase3-evidence-builder.mjs";

const DEFAULT_RECEIPT_STORES = Object.freeze([
  "receipt-reconciliations",
  "prelive-fork-receipts",
  "wrapped-btc-loop-dry-runs",
  "recursive_wrapped_btc_lending_loop-dry-runs",
  "stablecoin-lending-loop-dry-runs",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    strategy: null,
    json: false,
    write: false,
    receiptStores: [],
  };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg === "--write") args.write = true;
    else if (arg.startsWith("--strategy=")) args.strategy = arg.slice("--strategy=".length);
    else if (arg.startsWith("--receipt-store=")) args.receiptStores.push(arg.slice("--receipt-store=".length));
  }
  return args;
}

async function readReceiptStores(dataDir, names) {
  const records = [];
  for (const name of names) {
    const storeRecords = await readJsonl(dataDir, name).catch(() => []);
    for (const record of storeRecords) {
      records.push({
        ...record,
        receiptSource: name,
      });
    }
  }
  return records;
}

async function main() {
  const args = parseArgs();
  if (!args.strategy) {
    throw new Error("--strategy=<strategyId> is required");
  }
  const storeNames = args.receiptStores.length ? args.receiptStores : DEFAULT_RECEIPT_STORES;
  const [signerAuditRecords, receiptRecords] = await Promise.all([
    readSignerAuditLog({ rootDir: process.cwd() }),
    readReceiptStores(config.dataDir, storeNames),
  ]);
  const evidence = buildPhase3Evidence({
    strategyId: args.strategy,
    signerAuditRecords,
    receiptRecords,
  });
  let writeResult = null;
  if (args.write) {
    const outputPath = join(config.dataDir, "phase3-evidence", `${args.strategy}.json`);
    writeResult = await writeTextIfChanged(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  const output = {
    ...evidence,
    write: writeResult,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`${args.strategy}: ${output.autoPromotion.passed ? "passed" : "blocked"}`);
    if (output.autoPromotion.blockers.length) {
      console.log(`blockers: ${output.autoPromotion.blockers.join(", ")}`);
    }
    if (writeResult) console.log(`wrote: ${writeResult.path}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
