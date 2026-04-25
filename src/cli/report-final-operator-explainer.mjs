#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildFinalOperatorExplainer } from "../strategy/final-operator-explainer.mjs";

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
  const [strategySnapshot, phase3Validation, allocatorCore, protocolMarketWatchers, btcOnlyE2eDryRun, tinyLiveCanaryRollout, preliveValidation, liveOpsHandoff] =
    await Promise.all([
      readJsonIfExists(join(config.dataDir, "strategy-snapshot.json")),
      readJsonIfExists(join(config.dataDir, "phase3-strategy-validation.json")),
      readJsonIfExists(join(config.dataDir, "allocator-core.json")),
      readJsonIfExists(join(config.dataDir, "protocol-market-watchers.json")),
      readJsonIfExists(join(config.dataDir, "btc-only-e2e-dry-run.json")),
      readJsonIfExists(join(config.dataDir, "tiny-live-canary-rollout.json")),
      readJsonIfExists(join(config.dataDir, "prelive-validation.json")),
      readJsonIfExists(join(config.dataDir, "live-ops-handoff.json")),
    ]);
  const report = buildFinalOperatorExplainer({
    strategySnapshot,
    phase3Validation,
    allocatorCore,
    protocolMarketWatchers,
    btcOnlyE2eDryRun,
    tinyLiveCanaryRollout,
    preliveValidation,
    liveOpsHandoff,
  });
  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "final-operator-explainer.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(report.simpleKoreanSummary);
  console.log(
    `primaryLane=${report.laneStatus?.primaryLive?.label || "n/a"} priority=${report.laneStatus?.primaryLive?.priority || "primary"} status=${report.laneStatus?.primaryLive?.status || "n/a"}`,
  );
  console.log(
    `exactRouteLane=${report.laneStatus?.exactRoute?.status || "n/a"} priority=${report.laneStatus?.exactRoute?.priority || "secondary"} blocker=${report.laneStatus?.exactRoute?.blockerSummary || "none"}`,
  );
  console.log(`status=${report.status}`);
  console.log(`nextAction=${report.nextAction?.code || "n/a"}`);
  if (report.receiptIngestionGuide?.sampleCommand) {
    console.log(`receiptGuideCommand=${report.receiptIngestionGuide.sampleCommand}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
