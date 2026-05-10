#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  buildCapitalAuditBackfillRecords,
  loadCapitalAuditBackfillInputs,
} from "../executor/capital/capital-audit-backfill.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputs = await loadCapitalAuditBackfillInputs({ dataDir: config.dataDir });
  const records = buildCapitalAuditBackfillRecords(inputs);
  if (args.write && records.length > 0) {
    const store = new JsonlStore(config.dataDir);
    for (const record of records) {
      await store.append("capital-audit-pairs", record);
    }
  }

  const output = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    write: args.write,
    backfillCount: records.length,
    byStrategy: records.reduce((acc, record) => {
      acc[record.strategyId] = (acc[record.strategyId] || 0) + 1;
      return acc;
    }, {}),
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`backfillCount=${output.backfillCount}`);
  console.log(`write=${output.write}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
