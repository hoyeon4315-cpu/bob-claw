#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildBtcOnlyE2eDryRun } from "../strategy/btc-only-e2e-dry-run.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

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
  const report = buildBtcOnlyE2eDryRun({
    reviewPackage: context.reviewPackage,
    preliveValidation: context.dashboardStatus?.prelive?.validation,
    connectedRefresh: context.dashboardStatus?.prelive?.connectedRefresh,
    currentRoutePrelivePass: context.dashboardStatus?.prelive?.currentRoutePrelivePass,
    operationalJudgmentReview: context.dashboardStatus?.prelive?.operationalJudgmentReview,
  });
  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "btc-only-e2e-dry-run.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`stages=${report.summary.stageCount}`);
  console.log(`lane=${report.lane?.label || "BTC exact-route lane"} priority=${report.lane?.priority || report.summary.lanePriority || "secondary"} status=${report.lane?.status || report.summary.laneStatus || "n/a"}`);
  console.log(`blocked=${report.summary.blockedCount}`);
  console.log(`runs=${report.summary.runCount}`);
  console.log(`topStuck=${report.summary.topStuckPointId || "n/a"}`);
  console.log(`nextAction=${report.summary.nextAction?.code || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
