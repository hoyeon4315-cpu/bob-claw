#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { buildEvCostModel } from "../executor/policy/ev-gate.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";

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
    lookbackDays: options["lookback-days"] ? Number(options["lookback-days"]) : undefined,
    out: options.out ? resolve(options.out) : resolve(join(config.dataDir, "policy", "ev-cost-model.json")),
    now: options.now || new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [receiptRecords, auditRecords] = await Promise.all([
    readJsonl(config.dataDir, "receipt-reconciliations"),
    readSignerAuditLog(),
  ]);
  const model = buildEvCostModel({
    receiptRecords,
    auditRecords,
    now: args.now,
    policy: args.lookbackDays ? { lookbackDays: args.lookbackDays } : undefined,
  });
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(model, null, 2)}\n`, "utf8");

  if (args.json) {
    console.log(JSON.stringify({ path: args.out, summary: model.summary, entries: model.entries.length }, null, 2));
    return;
  }

  console.log(`path=${args.out}`);
  console.log(`entries=${model.entries.length}`);
  console.log(`matchedReceipts=${model.summary.matchedReceiptCount}`);
  console.log(`consideredReceipts=${model.summary.consideredReceiptCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
