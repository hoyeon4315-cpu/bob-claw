// src/cli/dashboard-stage-explain.mjs
// Explain current stage and blockers with source data points

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

export function readDashboardStatus() {
  try {
    const path = join(process.cwd(), "dashboard/public/dashboard-status.json");
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return null;
  }
}

export async function loadDashboardForStageExplain({
  snapshotOnly = false,
  snapshotReader = readDashboardStatus,
  buildDashboardContext = buildCurrentDashboardContext,
} = {}) {
  if (!snapshotOnly) {
    try {
      const current = await buildDashboardContext({ syncStageAudit: false });
      if (current?.dashboardStatus) return current.dashboardStatus;
      if (current?.overall?.lanePolicy) return current;
    } catch {
      // Fall back to the last written snapshot when live context assembly fails.
    }
  }
  return snapshotReader();
}

export function explainCurrentStage(dashboard) {
  if (!dashboard || !dashboard.overall || !dashboard.overall.lanePolicy) {
    return {
      stage: "unknown",
      blockers: ["dashboard-status.json missing or malformed"],
      explanation:
        "Unable to determine stage without dashboard snapshot.",
    };
  }

  const stage = dashboard.overall.lanePolicy.stage || "A";
  const blockers = dashboard.overall.lanePolicy.stageBlockers || [];
  const evidence = dashboard.overall.lanePolicy.stageEvidence || {};

  return {
    stage,
    blockers,
    evidence,
    explanation:
      stage === "C"
        ? "Stage C: Aggressive live execution enabled. All readiness blockers resolved."
        : stage === "B"
          ? "Stage B: Shadow execution enabled. Refresh and transient monitoring in progress."
          : "Stage A: Dry-run only. Core execution paths not yet validated.",
  };
}

async function main() {
  const snapshotOnly = process.argv.slice(2).includes("--snapshot-only");
  const dashboard = await loadDashboardForStageExplain({ snapshotOnly });
  if (!dashboard) {
    console.error("Error: dashboard-status.json not found");
    process.exit(1);
  }

  const explanation = explainCurrentStage(dashboard);
  console.log(JSON.stringify(explanation, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
