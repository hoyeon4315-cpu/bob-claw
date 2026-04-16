#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildWrappedBtcLoopOosEvidence } from "../strategy/wrapped-btc-loop-oos-evidence.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return { json: flags.has("--json"), write: flags.has("--write") };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = await readJsonl(config.dataDir, "wrapped-btc-loop-dry-runs");
  const report = buildWrappedBtcLoopOosEvidence({ records });
  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "wrapped-btc-loop-oos-evidence.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`runs=${report.summary.runCount}`);
  console.log(`scenarios=${report.summary.distinctScenarioCount}`);
  console.log(`simulatedPassed=${report.summary.simulatedPassedCount}`);
  console.log(`signerBacked=${report.summary.signerBackedRunCount}`);
  console.log(`status=${report.summary.status}`);
  console.log(`nextAction=${report.summary.nextAction?.code || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
