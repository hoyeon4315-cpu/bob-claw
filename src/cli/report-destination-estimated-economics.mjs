#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
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
  const observations = await readJson(join(config.dataDir, "destination-economics-observations.json"));
  const blockers = await readJsonIfExists(join(config.dataDir, "destination-economics-blockers.json"));
  const { economics: report } = buildDestinationEconomicsSnapshot({ admissionChecklist, overrides, observations, blockers });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-estimated-economics.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`items=${report.summary.itemCount}`);
  console.log(`estimated=${report.summary.estimatedCount}`);
  console.log(`blocked=${report.summary.blockedCount}`);
  console.log(`missingInputs=${report.summary.missingInputsCount}`);
  console.log(`activeBudgetPolicyPass=${report.summary.activeBudgetPolicyPassCount}`);
  console.log(`planningBudgetPolicyPass=${report.summary.planningBudgetPolicyPassCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
