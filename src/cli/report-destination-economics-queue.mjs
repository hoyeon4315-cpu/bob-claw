#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationEconomicsQueueSnapshot } from "../strategy/destination-economics-snapshot.mjs";

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
  const observations = await readJson(join(config.dataDir, "destination-economics-observations.json"));
  const blockers = await readJsonIfExists(join(config.dataDir, "destination-economics-blockers.json"));
  const { economicsQueue: report } = buildDestinationEconomicsQueueSnapshot({
    admissionChecklist,
    overrides,
    observations,
    blockers,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-economics-queue.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`queueCount=${report.summary.queueCount}`);
  console.log("");
  console.log("Top missing fields:");
  for (const item of report.summary.topMissingFields) {
    console.log(`- ${item.field}: ${item.count}`);
  }
  console.log("");
  console.log("Top queue:");
  for (const item of report.summary.topQueue) {
    console.log(`- ${item.chain}: ${item.label} [${item.missingEconomicFields.length} fields] (${item.priorityScore})`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
