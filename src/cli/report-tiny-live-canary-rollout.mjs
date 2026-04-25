#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
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
  const report = buildTinyLiveCanaryRollout({
    reviewPackage: context.reviewPackage,
    preliveValidation: context.dashboardStatus?.prelive?.validation,
    currentRoutePrelivePass: context.dashboardStatus?.prelive?.currentRoutePrelivePass,
    operationalJudgmentReview: context.dashboardStatus?.prelive?.operationalJudgmentReview,
  });
  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "tiny-live-canary-rollout.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`status=${report.summary.status || "n/a"}`);
  console.log(`decision=${report.summary.decision || "n/a"}`);
  console.log(`blockers=${report.summary.blockerCount ?? 0}`);
  console.log(`topBlocked=${report.summary.topBlockedRequirementCode || "n/a"}`);
  console.log(`nextAction=${report.summary.nextAction?.code || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
