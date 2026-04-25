#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildLendingLoopResearchEntries } from "../strategy/lending-loop-research.mjs";
import { buildStrategyResearchBoard } from "../strategy/strategy-research-board.mjs";

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
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const [
    nativeBtcOpportunitySurface,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoopDryRun,
  ] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "native-btc-opportunity-surface.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-dry-run-latest.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-dry-run-latest.json")),
  ]);
  const report = buildStrategyResearchBoard({
    laneReclassification: context.artifacts?.laneReclassification || null,
    nativeBtcOpportunitySurface,
    lendingLoopResearchEntries: buildLendingLoopResearchEntries(),
    recursiveLoopSurfaces: {
      recursive_wrapped_btc_lending_loop: {
        scaffold: recursiveWrappedBtcLoop,
        dryRunSummary: recursiveWrappedBtcLoopDryRun,
      },
      recursive_stablecoin_lending_loop: {
        scaffold: recursiveStablecoinLoop,
        dryRunSummary: recursiveStablecoinLoopDryRun,
      },
    },
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "strategy-research-board.json");
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

  const top = report.summary?.topCandidateId || "n/a";
  const topNew = report.summary?.topNewCandidateId || "n/a";
  const nextAction = report.summary?.nextAction?.code || "n/a";
  const nextNewAction = report.summary?.nextNewAction?.code || "n/a";
  console.log(`candidateCount=${report.summary?.candidateCount ?? 0}`);
  console.log(`newCandidateCount=${report.summary?.newCandidateCount ?? 0}`);
  console.log(`topCandidate=${top}`);
  console.log(`topNewCandidate=${topNew}`);
  console.log(`nextAction=${nextAction}`);
  console.log(`nextNewAction=${nextNewAction}`);
  for (const candidate of (report.candidates ?? []).slice(0, 5)) {
    console.log(`${candidate.rank}. ${candidate.id} status=${candidate.status}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
