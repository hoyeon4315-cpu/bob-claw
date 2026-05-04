// src/cli/dashboard-stage-explain.mjs
// Explain current stage and blockers with source data points

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildAllChainAutopilotDashboardSlice, resolveAllChainAutopilotReport } from "../status/all-chain-autopilot-slice.mjs";
import { buildProtocolPositionMarksSlice } from "../status/protocol-position-marks-slice.mjs";
import { buildPaybackDashboardSlice } from "../executor/payback/dashboard.mjs";
import { evaluateStage } from "../executor/policy/stage-evaluator.mjs";
import { activeProtocolPositions } from "../treasury/protocol-position-ledger.mjs";

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
  buildDashboardContext = null,
} = {}) {
  if (!snapshotOnly) {
    try {
      const current = buildDashboardContext
        ? await buildDashboardContext({ syncStageAudit: false })
        : await buildStageExplainDashboard();
      if (current?.dashboardStatus) return current.dashboardStatus;
      if (current?.overall?.lanePolicy) return current;
    } catch {
      // Fall back to the last written snapshot when live context assembly fails.
    }
  }
  return snapshotReader();
}

export async function buildStageExplainDashboard({
  dataDir = config.dataDir,
  logsDir = join(dataDir, "..", "logs"),
  now = new Date().toISOString(),
} = {}) {
  const [
    allChainAutopilotLatest,
    allChainAutopilotLatestCompleted,
    evCostModel,
    merklPositionEvents,
    protocolPositionMarks,
  ] = await Promise.all([
    readJsonIfExists(join(dataDir, "all-chain-autopilot-latest.json")),
    readJsonIfExists(join(dataDir, "all-chain-autopilot-latest-completed.json")),
    readJsonIfExists(join(dataDir, "policy", "ev-cost-model.json")),
    readJsonl(dataDir, "merkl-portfolio-positions"),
    readJsonl(dataDir, "protocol-position-marks"),
  ]);

  const activeMerklProtocolPositions = activeProtocolPositions(merklPositionEvents);
  const marksSlice = buildProtocolPositionMarksSlice(protocolPositionMarks, {
    generatedAt: now,
    activePositionIds: activeMerklProtocolPositions.map((position) => position.positionId),
  });
  const allChainAutopilotReport = resolveAllChainAutopilotReport(
    allChainAutopilotLatest,
    allChainAutopilotLatestCompleted,
  );
  const allChainAutopilot = buildAllChainAutopilotDashboardSlice(allChainAutopilotReport);
  const payback = await buildPaybackDashboardSlice({
    dataDir,
    logsDir,
    now,
    writeProposedPatch: false,
  });
  const stageEvaluation = evCostModel
    ? evaluateStage({
        marksSlice,
        capitalPlan: {
          unresolvedRefillRoutes: allChainAutopilot?.refill?.unresolvedCount ?? 0,
          payback,
        },
        evGateStats: {
          calibrated:
            (evCostModel?.summary?.matchedReceiptCount ?? 0) > 0 &&
            (evCostModel?.summary?.keyedEntryCount ?? 0) > 0,
          matchedReceiptCount: evCostModel?.summary?.matchedReceiptCount ?? 0,
          keyedEntryCount: evCostModel?.summary?.keyedEntryCount ?? 0,
          lookbackDays: evCostModel?.lookbackDays ?? null,
        },
      })
    : null;

  return {
    generatedAt: now,
    overall: {
      lanePolicy: {
        stage: stageEvaluation?.currentStage || null,
        stageBlockers: stageEvaluation?.blockers || [],
        stageEvidence: stageEvaluation?.evidence || {},
      },
    },
  };
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
