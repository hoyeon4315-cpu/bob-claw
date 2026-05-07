#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationAdmissionChecklist } from "../strategy/destination-admission-checklist.mjs";

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
  const venueTemplate = await readJson(join(config.dataDir, "destination-venue-template.json"));
  const overrides = await readJson(join(config.dataDir, "destination-input-overrides.json"));
  const report = buildDestinationAdmissionChecklist({ venueTemplate, overrides });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-admission-checklist.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`chains=${report.summary.chainCount}`);
  console.log(`templates=${report.summary.templateCount}`);
  console.log(`readyForPolicyReview=${report.summary.readyForPolicyReviewCount}`);
  console.log(`incomplete=${report.summary.incompleteCount}`);
  console.log("");
  console.log("Top missing fields:");
  for (const item of report.summary.topMissingFields) {
    console.log(`- ${item.field}: ${item.count}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
