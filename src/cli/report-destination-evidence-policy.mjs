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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const admissionChecklist = await readJson(join(config.dataDir, "destination-admission-checklist.json"));
  const overrides = await readJson(join(config.dataDir, "destination-input-overrides.json"));
  const { evidencePolicy: report } = buildDestinationEconomicsSnapshot({ admissionChecklist, overrides });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-evidence-policy.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`policyItems=${report.summary.policyItemCount}`);
  console.log(`inputsSeeded=${report.summary.inputsSeededCount}`);
  console.log(`inputsMissing=${report.summary.inputsMissingCount}`);
  console.log("");
  console.log("Strictest families:");
  for (const item of report.summary.strictestFamilies) {
    console.log(`- ${item.chain}: ${item.familyId} [checks=${item.checks} freshnessHours=${item.freshnessHours}]`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
