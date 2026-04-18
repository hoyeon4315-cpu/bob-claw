#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildRecursiveLendingLoopScaffold } from "../strategy/recursive-lending-loop-slice.mjs";
import { buildDeterministicStrategyCandidates } from "../strategy/deterministic-strategy-candidates.mjs";

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
  const [strategyResearchBoard, secondaryStrategyScaffolds, recursiveWrappedBtcLoop, recursiveStablecoinLoop] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "strategy-research-board.json")),
    readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
  ]);
  const report = buildDeterministicStrategyCandidates({
    strategyResearchBoard,
    secondaryStrategyScaffolds,
    recursiveWrappedBtcLoop:
      recursiveWrappedBtcLoop ||
      buildRecursiveLendingLoopScaffold({
        strategyId: "recursive_wrapped_btc_lending_loop",
      }),
    recursiveStablecoinLoop:
      recursiveStablecoinLoop ||
      buildRecursiveLendingLoopScaffold({
        strategyId: "recursive_stablecoin_lending_loop",
      }),
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "deterministic-strategy-candidates.json");
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

  console.log(`candidateCount=${report.summary?.candidateCount ?? 0}`);
  console.log(`repoAutoBuildCount=${report.summary?.repoAutoBuildCount ?? 0}`);
  console.log(`readyForDryRunCount=${report.summary?.readyForDryRunCount ?? 0}`);
  console.log(`receiptBackedCount=${report.summary?.receiptBackedCount ?? 0}`);
  console.log(`topCandidate=${report.summary?.topCandidateId || "n/a"}`);
  console.log(`nextAction=${report.summary?.nextAction?.code || "n/a"}`);
  for (const candidate of (report.candidates || []).slice(0, 5)) {
    console.log(`${candidate.rank}. ${candidate.id} status=${candidate.status} deterministic=${candidate.deterministicStatus}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
