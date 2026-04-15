#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationVenueTemplate } from "../strategy/destination-venue-template.mjs";

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
  const gates = await readJson(join(config.dataDir, "destination-truthfulness-gates.json"));
  const report = buildDestinationVenueTemplate({ gates });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-venue-template.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`chains=${report.summary.chainCount}`);
  console.log(`templates=${report.summary.templateCount}`);
  console.log(`readyForVenueScoringTemplates=${report.summary.readyForVenueScoringTemplates}`);
  console.log(`researchOnlyTemplates=${report.summary.researchOnlyTemplates}`);
  console.log("");
  console.log("Top template targets:");
  for (const item of report.summary.topTemplateTargets) {
    console.log(`- ${item.chain}: ${item.label} [${item.gateStatus}] (${item.score})`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
