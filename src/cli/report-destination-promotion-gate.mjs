#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationPromotionGate } from "../strategy/destination-promotion-gate.mjs";
import { buildDestinationEconomicsSnapshot } from "../strategy/destination-economics-snapshot.mjs";

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

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const admissionChecklist = await readJson(join(config.dataDir, "destination-admission-checklist.json"));
  const overrides = await readJson(join(config.dataDir, "destination-input-overrides.json"));
  const allowlistBoard = await readJson(join(config.dataDir, "destination-allowlist-board.json"));
  const freshnessAudit = await readJson(join(config.dataDir, "destination-evidence-freshness-audit.json"));
  const observations = await readJson(join(config.dataDir, "destination-economics-observations.json"));
  const blockers = await readJsonIfExists(join(config.dataDir, "destination-economics-blockers.json"));
  const { evidencePolicy, ledger, economics } = buildDestinationEconomicsSnapshot({
    admissionChecklist,
    overrides,
    observations,
    blockers,
  });
  const report = buildDestinationPromotionGate({ allowlistBoard, evidencePolicy, economics, freshnessAudit, ledger });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-promotion-gate.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`items=${report.summary.itemCount}`);
  console.log(`promotable=${report.summary.promotableCount}`);
  console.log(`blocked=${report.summary.blockedCount}`);
  console.log(`allocationReady=${report.summary.allocationReadyCount}`);
  console.log(`reviewOnly=${report.summary.reviewOnlyCount}`);
  console.log("");
  console.log("Top blockers:");
  for (const item of report.summary.topBlockers) {
    console.log(`- ${item.blocker}: ${item.count}`);
  }
  if ((report.summary.topAllocationBlockers || []).length > 0) {
    console.log("");
    console.log("Top allocation blockers:");
    for (const item of report.summary.topAllocationBlockers) {
      console.log(`- ${item.blocker}: ${item.count}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
