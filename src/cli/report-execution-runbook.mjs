#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

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
  const report = context.executionRunbook;

  if (args.write) {
    const outputPath = join(config.dataDir, "execution-runbook-latest.json");
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

  console.log(`currentStage=${report?.currentStageId || "n/a"}`);
  console.log(`liveTradingPolicy=${report?.liveTradingPolicy || "BLOCKED"}`);
  console.log(`completeStages=${report?.summary?.completeCount ?? 0}/${report?.summary?.stageCount ?? 0}`);
  console.log(`blockedStages=${report?.summary?.blockedCount ?? 0}`);
  console.log(`readyForManualReview=${Boolean(report?.summary?.readyForManualReview)}`);
  console.log(`nextStage=${report?.summary?.nextStageId || "n/a"} state=${report?.summary?.nextStageState || "n/a"}`);
  console.log(`nextAction=${report?.summary?.nextActionCode || "n/a"} command=${report?.summary?.nextActionCommand || "n/a"}`);
  if (report?.summary?.exactRouteForkPlanStatus || report?.summary?.exactRouteForkPlanId) {
    console.log(
      `exactRouteForkPlan=${report?.summary?.exactRouteForkPlanStatus || "n/a"} planId=${report?.summary?.exactRouteForkPlanId || "n/a"} submit=${report?.summary?.exactRouteForkSubmitCommand || "n/a"}`,
    );
  }
  for (const stage of report?.stages || []) {
    console.log(
      `stage=${stage.id} state=${stage.state} status=${stage.status || "n/a"} blockers=${stage.blockers?.join(",") || "none"}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
