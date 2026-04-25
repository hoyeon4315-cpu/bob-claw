#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildBtcOnlyE2eDryRun } from "../strategy/btc-only-e2e-dry-run.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildLiveOpsHandoff } from "../strategy/live-ops-handoff.mjs";
import { buildTinyLiveCanaryRollout } from "../strategy/tiny-live-canary-rollout.mjs";

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
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const btcOnlyE2eDryRun = buildBtcOnlyE2eDryRun({
    reviewPackage: context.reviewPackage,
    preliveValidation: context.dashboardStatus?.prelive?.validation,
    connectedRefresh: context.dashboardStatus?.prelive?.connectedRefresh,
    currentRoutePrelivePass: context.dashboardStatus?.prelive?.currentRoutePrelivePass,
    operationalJudgmentReview: context.dashboardStatus?.prelive?.operationalJudgmentReview,
  });
  const tinyLiveCanaryRollout = buildTinyLiveCanaryRollout({
    reviewPackage: context.reviewPackage,
    preliveValidation: context.dashboardStatus?.prelive?.validation,
    currentRoutePrelivePass: context.dashboardStatus?.prelive?.currentRoutePrelivePass,
    operationalJudgmentReview: context.dashboardStatus?.prelive?.operationalJudgmentReview,
  });
  const report = buildLiveOpsHandoff({
    strategySnapshot: context.strategySnapshot,
    reviewPackage: context.reviewPackage,
    preliveValidation: context.dashboardStatus?.prelive?.validation,
    connectedRefresh: context.dashboardStatus?.prelive?.connectedRefresh,
    currentRoutePrelivePass: context.dashboardStatus?.prelive?.currentRoutePrelivePass,
    protocolMarketWatchers: context.artifacts?.protocolMarketWatchers || context.artifacts?.protocolMarketWatchers,
    btcOnlyE2eDryRun,
    tinyLiveCanaryRollout,
    operationalJudgmentReview: context.dashboardStatus?.prelive?.operationalJudgmentReview,
  });
  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "live-ops-handoff.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`liveTrading=${report.summary.liveTrading || "n/a"}`);
  console.log(`preliveStage=${report.summary.preliveStage || "n/a"}`);
  console.log(
    `primaryLane=${report.primaryLiveLane?.label || report.summary.primaryLaneLabel || report.summary.candidateLabel || report.summary.candidateId || "n/a"} priority=${report.primaryLiveLane?.priority || "primary"} status=${report.primaryLiveLane?.status || report.summary.primaryLaneStatus || "n/a"}`,
  );
  console.log(
    `exactRouteLane=${report.blockedExactRouteLane?.status || report.summary.exactRouteLaneStatus || "n/a"} priority=${report.blockedExactRouteLane?.priority || report.summary.exactRouteLanePriority || "secondary"} blocker=${report.blockedExactRouteLane?.blockerReasons?.join(",") || report.summary.exactRouteLaneBlockedStageId || "none"}`,
  );
  console.log(`watcherBlocked=${report.summary.watcherBlockedCount ?? 0}`);
  console.log(`e2eBlocked=${report.summary.e2eBlockedCount ?? 0}`);
  console.log(`nextAction=${report.summary.nextAction || "n/a"}`);
  if (report.receiptIngestionGuide?.sampleCommand) {
    console.log(`receiptGuideCommand=${report.receiptIngestionGuide.sampleCommand}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
