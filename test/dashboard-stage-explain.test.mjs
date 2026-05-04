import assert from "node:assert/strict";
import { test } from "node:test";
import { explainCurrentStage, loadDashboardForStageExplain } from "../src/cli/dashboard-stage-explain.mjs";

test("dashboard stage explain reads stage blockers and evidence from lanePolicy", () => {
  const explanation = explainCurrentStage({
    overall: {
      lanePolicy: {
        stage: "B",
        stageBlockers: ["refill_routes_unresolved"],
        stageEvidence: {
          unresolvedRefillRoutes: 7,
        },
      },
    },
  });

  assert.equal(explanation.stage, "B");
  assert.deepEqual(explanation.blockers, ["refill_routes_unresolved"]);
  assert.deepEqual(explanation.evidence, { unresolvedRefillRoutes: 7 });
});

test("dashboard stage explain prefers live dashboard context over stale snapshot", async () => {
  const dashboard = await loadDashboardForStageExplain({
    snapshotReader: () => ({
      overall: {
        lanePolicy: {
          stage: "B",
          stageBlockers: ["stale_snapshot"],
        },
      },
    }),
    buildDashboardContext: async () => ({
      overall: {
        lanePolicy: {
          stage: "C",
          stageBlockers: [],
          stageEvidence: { deliveredPeriodCountOnReserveChain: 1 },
        },
      },
    }),
  });

  assert.equal(dashboard.overall.lanePolicy.stage, "C");
});

test("dashboard stage explain falls back to snapshot when live context fails", async () => {
  const dashboard = await loadDashboardForStageExplain({
    snapshotReader: () => ({
      overall: {
        lanePolicy: {
          stage: "B",
          stageBlockers: ["snapshot_fallback"],
        },
      },
    }),
    buildDashboardContext: async () => {
      throw new Error("live build failed");
    },
  });

  assert.equal(dashboard.overall.lanePolicy.stage, "B");
  assert.deepEqual(dashboard.overall.lanePolicy.stageBlockers, ["snapshot_fallback"]);
});
