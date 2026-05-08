#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildStrategyReceiptDistribution } from "../strategy/strategy-receipt-distribution.mjs";

function parseArgs(argv) {
  const out = { json: false, write: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--write") { out.write = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

async function readJsonlSafe(path) {
  const dir = dirname(path);
  const name = basename(path, extname(path));
  return readJsonl(dir, name).catch(() => []);
}

async function main() {
  const args = parseArgs(process.argv);
  const auditPath = resolve(args.audit || "logs/signer-audit.jsonl");
  const outPath = resolve(args.out || "data/strategy-receipt-distribution.json");
  const report = buildStrategyReceiptDistribution({
    records: await readJsonlSafe(auditPath),
    now: args.now || new Date().toISOString(),
    expectedStrategies: listStrategyCaps()
      .filter((strategy) => strategy.autoExecute === true)
      .map((strategy) => strategy.strategyId),
  });

  if (args.write) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`receiptCount90d=${report.summary.receiptCount90d}`);
  console.log(`topConcentratedStrategyId=${report.summary.topConcentratedStrategyId || "none"}`);
  console.log(`concentrationWarningCount=${report.summary.concentrationWarningCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
