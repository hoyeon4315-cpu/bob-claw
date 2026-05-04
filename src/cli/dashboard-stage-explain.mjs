// src/cli/dashboard-stage-explain.mjs
// Explain current stage and blockers with source data points

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readDashboardStatus() {
  try {
    const path = join(process.cwd(), "dashboard/public/dashboard-status.json");
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return null;
  }
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
  const blockers = dashboard.overall.lanePolicy.blockers || [];
  const evidence = dashboard.overall.lanePolicy.evidence || {};

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
  const dashboard = readDashboardStatus();
  if (!dashboard) {
    console.error("Error: dashboard-status.json not found");
    process.exit(1);
  }

  const explanation = explainCurrentStage(dashboard);
  console.log(JSON.stringify(explanation, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { explainCurrentStage };
