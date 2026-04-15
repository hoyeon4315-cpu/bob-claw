#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationScoringInputs } from "../strategy/destination-scoring.mjs";

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
  const registry = await readJson(join(config.dataDir, "destination-strategy-registry.json"));
  const nativeBtcSurface = await readJson(join(config.dataDir, "native-btc-opportunity-surface.json"));
  const report = buildDestinationScoringInputs({ registry, nativeBtcSurface });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-scoring-inputs.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`chains=${report.summary.chainCount}`);
  console.log(`scoredStrategies=${report.summary.scoredStrategyCount}`);
  console.log(`deploymentCandidates=${report.summary.deploymentCandidateCount}`);
  console.log(`observeOnlyResearch=${report.summary.observeOnlyResearchCount}`);
  console.log(`blockedResearch=${report.summary.blockedResearchCount}`);
  console.log("");
  console.log("Top transport rails:");
  for (const item of report.summary.topTransportRails) {
    console.log(`- ${item.chain}: ${item.label} (${item.score})`);
  }
  console.log("");
  console.log("Top observe-only research:");
  for (const item of report.summary.topObserveOnlyResearch) {
    console.log(`- ${item.chain}: ${item.label} (${item.score})`);
  }
  console.log("");
  console.log("Top deployment candidates:");
  for (const item of report.summary.topDeploymentCandidates) {
    console.log(`- ${item.chain}: ${item.label} (${item.score})`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
