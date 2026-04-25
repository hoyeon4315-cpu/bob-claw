import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStableLoopExecutorReport } from "../src/strategy/stable-loop-executor.mjs";

test("stable loop executor report builds a deterministic command sequence for the best paired loop", () => {
  const report = buildStableLoopExecutorReport({
    crossAssetArbitrage: {
      matchedLoopCount: 3,
      closedLoopCount: 2,
      profitableClosedLoopCount: 1,
      amountLadderPairCount: 1,
      bestAmountLadderPair: {
        entryRouteKey: "base:0xusdc->base:0xcbbtc",
        exitRouteKey: "base:0xcbbtc->base:0xusdc",
        entryAmountLevelCount: 2,
        exitAmountLevelCount: 2,
        observedPairCount: 3,
        exactMatchCount: 2,
        positiveLoopCount: 1,
        closestAmountGapPct: 0.004,
        blockerCounts: [{ blocker: "non_positive_loop_net_edge", count: 1 }],
      },
      bestLoop: {
        entryRouteKey: "base:0xusdc->base:0xcbbtc",
        exitRouteKey: "base:0xcbbtc->base:0xusdc",
        entryAmount: "250",
        exitAmount: "250",
        amountGapPct: 0.004,
        exactAmountMatch: true,
        closedLoop: true,
        loopNetEdgeUsd: 0.24,
        blockers: [],
      },
    },
    laneReclassification: {
      lanes: [
        {
          id: "stablecoin_entry_exit_loops",
          statusNew: "measured_overfit_blocked",
          passesOverfitGate: false,
          netPnlMeasuredUsd: 0.24,
          gasSlippageVarianceUsd: 0.11,
        },
      ],
    },
    now: "2026-04-16T20:00:00.000Z",
  });

  assert.equal(report.status, "candidate_for_validation");
  assert.equal(report.readiness.readyForExecutorDryRun, true);
  assert.equal(report.executionPlan.actionCount, 5);
  assert.equal(report.executionPlan.commandChain.length >= 3, true);
  assert.equal(report.nextAction.code, "refresh_stable_loop_quotes");
  assert.equal(report.blockers.includes("overfit_gate_blocked"), true);
});

test("stable loop executor report stays blocked when no paired amount ladder exists", () => {
  const report = buildStableLoopExecutorReport({
    crossAssetArbitrage: {
      matchedLoopCount: 0,
      closedLoopCount: 0,
      profitableClosedLoopCount: 0,
      amountLadderPairCount: 0,
      bestAmountLadderPair: null,
      bestLoop: null,
      closestLoop: null,
    },
    laneReclassification: {
      lanes: [
        {
          id: "stablecoin_entry_exit_loops",
          statusNew: "unobserved",
          passesOverfitGate: null,
        },
      ],
    },
    now: "2026-04-16T20:01:00.000Z",
  });

  assert.equal(report.status, "coverage_missing");
  assert.equal(report.readiness.readyForExecutorDryRun, false);
  assert.equal(report.executionPlan.actionCount, 0);
  assert.equal(report.nextAction.code, "collect_stable_loop_coverage");
  assert.equal(report.blockers.includes("stable_loop_amount_ladder_missing"), true);
});
