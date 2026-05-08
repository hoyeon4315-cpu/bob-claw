#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildDestinationAllocationPlanner } from "../strategy/destination-allocation-planner.mjs";
import { buildChainScoreLedger } from "../strategy/chain-score-ledger.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [promotionGate, economics, signerAuditRecords] = await Promise.all([
    readJson(join(config.dataDir, "destination-promotion-gate.json")),
    readJson(join(config.dataDir, "destination-estimated-economics.json")),
    readJsonl("logs", "signer-audit").catch(() => []),
  ]);
  const chainScoreLedger = buildChainScoreLedger({
    records: signerAuditRecords,
    now: new Date().toISOString(),
  });
  const report = buildDestinationAllocationPlanner({ promotionGate, economics, chainScoreLedger });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-allocation-plan.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`promotable=${report.summary.promotableCount}`);
  console.log(`allocationReady=${report.summary.allocationReadyCount}`);
  console.log(`reviewOnly=${report.summary.reviewOnlyCount}`);
  console.log(`activeAllocationCount=${report.summary.activeAllocationCount}`);
  console.log(`planningAllocationCount=${report.summary.planningAllocationCount}`);
  console.log(`activeBudgetRemainingUsd=${report.summary.activeBudgetRemainingUsd}`);
  console.log(`planningBudgetRemainingUsd=${report.summary.planningBudgetRemainingUsd}`);
  console.log("");
  console.log("Top blockers:");
  for (const item of report.summary.blockedSummary) {
    console.log(`- ${item.blocker}: ${item.count}`);
  }
  if ((report.summary.allocationBlockedSummary || []).length > 0) {
    console.log("");
    console.log("Allocation blockers:");
    for (const item of report.summary.allocationBlockedSummary) {
      console.log(`- ${item.blocker}: ${item.count}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
