#!/usr/bin/env node
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { runAsyncSettlementWatcher } from "../executor/ingestor/execution-receipt-ingest.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  return {
    json: argv.includes("--json"),
    write: argv.includes("--write"),
    dataDir: config.dataDir,
  };
}

async function main() {
  const args = parseArgs();
  const store = new JsonlStore(args.dataDir);
  const result = await runAsyncSettlementWatcher({
    dataDir: args.dataDir,
    store: args.write ? store : null,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`pendingCount=${result.pendingCount}`);
    console.log(`processedCount=${result.processedCount}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
