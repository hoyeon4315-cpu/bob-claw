#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildAllocatorCore } from "../strategy/allocator-core.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [strategySnapshot, phase3Validation, wrappedBtcLendingLoopSlice, recursiveWrappedBtcLoop, recursiveStablecoinLoop, secondaryStrategyScaffolds] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "strategy-snapshot.json")),
    readJsonIfExists(join(config.dataDir, "phase3-strategy-validation.json")),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json")),
  ]);
  const report = buildAllocatorCore({
    strategySnapshot,
    phase3Validation,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    secondaryStrategyScaffolds,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "allocator-core.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`candidates=${report.summary.candidateCount}`);
  console.log(`activeAllocations=${report.summary.activeAllocationCount}`);
  console.log(`planningCandidates=${report.summary.planningCandidateCount}`);
  console.log(`topPlanning=${report.summary.topPlanningCandidateId || "n/a"}`);
  console.log(`nextAction=${report.summary.nextAction?.code || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
