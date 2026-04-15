#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationTruthfulnessGate } from "../strategy/destination-truthfulness-gate.mjs";

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
  const scoring = await readJson(join(config.dataDir, "destination-scoring-inputs.json"));
  const report = buildDestinationTruthfulnessGate({ scoring });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-truthfulness-gates.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`chains=${report.summary.chainCount}`);
  console.log(`strategies=${report.summary.strategyCount}`);
  console.log(`readyForVenueScoring=${report.summary.readyForVenueScoringCount}`);
  console.log(`researchOnly=${report.summary.researchOnlyCount}`);
  console.log(`blocked=${report.summary.blockedCount}`);
  console.log(`observeOnly=${report.summary.observeOnlyCount}`);
  console.log(`transportOnly=${report.summary.transportOnlyCount}`);
  console.log(`thesisReviewRequired=${report.summary.thesisReviewRequiredCount}`);
  console.log(`manualReviewOnly=${report.summary.manualReviewOnlyCount}`);
  console.log("");
  console.log("Top gate-ready candidates:");
  for (const item of report.summary.topGateReadyCandidates) {
    console.log(`- ${item.chain}: ${item.label} (${item.score})`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
