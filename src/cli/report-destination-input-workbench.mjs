#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationInputWorkbench } from "../strategy/destination-input-workbench.mjs";

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
  const report = buildDestinationInputWorkbench({ admissionChecklist, overrides });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-input-workbench.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`workItems=${report.summary.workItemCount}`);
  console.log(`seeded=${report.summary.seededCount}`);
  console.log(`empty=${report.summary.emptyCount}`);
  console.log("");
  console.log("Top work items:");
  for (const item of report.summary.topWorkItems) {
    console.log(
      `- ${item.chain}: ${item.label} [missing=${item.missingFieldCount} score=${item.score} override=${item.overrideStatus}]`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
