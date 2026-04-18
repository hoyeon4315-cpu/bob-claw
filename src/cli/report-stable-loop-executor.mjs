#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildLaneReclassificationArtifact } from "../strategy/phase1-revalidation.mjs";
import { buildStableLoopExecutorReport } from "../strategy/stable-loop-executor.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [context, overfitAuditArtifact, varianceArtifact] = await Promise.all([
    buildCurrentDashboardContext({ dataDir: config.dataDir }),
    readJsonIfExists(join(config.dataDir, "overfit-audit-latest.json")),
    readJsonIfExists(join(config.dataDir, "gas-slippage-variance-latest.json")),
  ]);
  const laneReclassification = buildLaneReclassificationArtifact({
    strategySnapshot: context.strategySnapshot,
    dashboardStatus: context.dashboardStatus,
    varianceArtifact,
    overfitAuditArtifact,
    now: context.dashboardStatus?.generatedAt || new Date().toISOString(),
  });
  const report = buildStableLoopExecutorReport({
    crossAssetArbitrage: context.dashboardStatus?.strategy?.crossAssetArbitrage || null,
    laneReclassification,
    now: context.dashboardStatus?.generatedAt || new Date().toISOString(),
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "stable-loop-executor.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`strategy=${report.strategyId}`);
  console.log(`status=${report.status}`);
  console.log(`laneStatus=${report.laneStatus || "n/a"}`);
  console.log(
    `selectedPair=${report.selectedPair ? `${report.selectedPair.entryRouteKey} | ${report.selectedPair.exitRouteKey}` : "none"}`,
  );
  console.log(`readyForExecutorDryRun=${report.readiness.readyForExecutorDryRun}`);
  console.log(`actionCount=${report.executionPlan.actionCount}`);
  console.log(`nextAction=${report.nextAction.code} reason=${report.nextAction.reason}`);
  console.log(`blockers=${report.blockers.join(",") || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
