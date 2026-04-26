#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationEconomicsLedger } from "../strategy/destination-economics-ledger.mjs";

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
  const observations = await readJson(join(config.dataDir, "destination-economics-observations.json"));
  const workbench = await readJson(join(config.dataDir, "destination-input-workbench.json"));
  const evidencePolicy = await readJsonIfExists(join(config.dataDir, "destination-evidence-policy.json"));
  const blockers = await readJsonIfExists(join(config.dataDir, "destination-economics-blockers.json"));
  const report = buildDestinationEconomicsLedger({ observations, workbench, blockers, evidencePolicy });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-economics-ledger.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`items=${report.summary.itemCount}`);
  console.log(`fullCoverage=${report.summary.fullCoverageCount}`);
  console.log(`partialCoverage=${report.summary.partialCoverageCount}`);
  console.log(`zeroCoverage=${report.summary.zeroCoverageCount}`);
  console.log(`blocked=${report.summary.blockedCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
