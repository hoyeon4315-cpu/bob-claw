#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationAllowlistBoard } from "../strategy/destination-allowlist-board.mjs";

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
  const workbench = await readJson(join(config.dataDir, "destination-input-workbench.json"));
  const researchQueue = await readJson(join(config.dataDir, "destination-research-queue.json"));
  let overrides = null;
  try {
    overrides = await readJson(join(config.dataDir, "destination-input-overrides.json"));
  } catch { /* no overrides file */ }
  const overrideMap = new Map();
  if (overrides?.entries) {
    for (const entry of overrides.entries) {
      if (entry.templateId) overrideMap.set(entry.templateId, entry.values || {});
    }
  }
  if (overrideMap.size > 0) {
    for (const item of (workbench.workItems || [])) {
      const overrideValues = overrideMap.get(item.templateId);
      if (overrideValues) {
        item.values = { ...(item.values || {}), ...overrideValues };
      }
    }
  }
  const report = buildDestinationAllowlistBoard({ workbench, researchQueue });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-allowlist-board.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`items=${report.summary.itemCount}`);
  console.log(`candidateCount=${report.summary.candidateCount}`);
  console.log(`contractPolicyReview=${report.summary.contractPolicyReviewCount}`);
  console.log(`blockedByRisk=${report.summary.blockedByRiskCount}`);
  console.log(`observeOnly=${report.summary.observeOnlyCount}`);
  console.log("");
  console.log("Top review targets:");
  for (const item of report.summary.topReviewTargets) {
    console.log(`- ${item.chain}: ${item.label} (${item.score})`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
