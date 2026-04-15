#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationResearchQueue } from "../strategy/destination-research-queue.mjs";

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
  const evidencePolicy = await readJson(join(config.dataDir, "destination-evidence-policy.json"));
  const economics = await readJson(join(config.dataDir, "destination-estimated-economics.json"));
  const report = buildDestinationResearchQueue({ workbench, evidencePolicy, economics });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-research-queue.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`queueCount=${report.summary.queueCount}`);
  console.log(`seededQueue=${report.summary.seededQueueCount}`);
  console.log("");
  console.log("Top actions:");
  for (const item of report.summary.topActions) {
    console.log(`- ${item.action}: ${item.count}`);
  }
  console.log("");
  console.log("Top queue:");
  for (const item of report.summary.topQueue) {
    console.log(`- ${item.chain}: ${item.label} [${item.nextAction} score=${item.queueScore}]`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
