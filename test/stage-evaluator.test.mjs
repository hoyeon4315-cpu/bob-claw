import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateStage } from "../src/executor/policy/stage-evaluator.mjs";

function marksSlice(overrides = {}) {
  return {
    reliability: {
      rolling24h: {
        refreshSuccessRatio: 0.98,
        transientFrequency: 0.01,
      },
      rolling7d: {
        refreshSuccessRatio: 0.99,
        transientFrequency: 0.01,
      },
      hysteresis: {
        refreshBelow90Since: null,
        refreshBelow90SustainedFor1h: false,
      },
    },
    ...overrides,
  };
}

function capitalPlan(overrides = {}) {
  return {
    unresolvedRefillRoutes: 1,
    payback: {
      reserveChain: "base",
      deliveredPeriodCountOnReserveChain: 0,
    },
    ...overrides,
  };
}

function evGateStats(overrides = {}) {
  return {
    calibrated: true,
    matchedReceiptCount: 1435,
    keyedEntryCount: 57,
    lookbackDays: 90,
    ...overrides,
  };
}

test("stage evaluator progresses monotonically from A to B to C", () => {
  const stageA = evaluateStage({
    marksSlice: marksSlice({
      reliability: {
        ...marksSlice().reliability,
        rolling24h: {
          refreshSuccessRatio: 0.92,
          transientFrequency: 0.01,
        },
      },
    }),
    capitalPlan: capitalPlan(),
    evGateStats: evGateStats(),
  });
  const stageB = evaluateStage({
    marksSlice: marksSlice(),
    capitalPlan: capitalPlan(),
    evGateStats: evGateStats(),
  });
  const stageC = evaluateStage({
    marksSlice: marksSlice(),
    capitalPlan: capitalPlan({
      unresolvedRefillRoutes: 0,
      payback: {
        reserveChain: "base",
        deliveredPeriodCountOnReserveChain: 1,
      },
    }),
    evGateStats: evGateStats(),
  });

  assert.equal(stageA.currentStage, "A");
  assert.equal(stageB.currentStage, "B");
  assert.equal(stageC.currentStage, "C");
});

test("stage evaluator demotes Stage C readiness to B when refresh stays below 0.90 for one hour", () => {
  const result = evaluateStage({
    marksSlice: marksSlice({
      reliability: {
        rolling24h: {
          refreshSuccessRatio: 0.97,
          transientFrequency: 0.01,
        },
        rolling7d: {
          refreshSuccessRatio: 0.98,
          transientFrequency: 0.01,
        },
        hysteresis: {
          refreshBelow90Since: "2026-05-04T10:00:00.000Z",
          refreshBelow90SustainedFor1h: true,
        },
      },
    }),
    capitalPlan: capitalPlan({
      unresolvedRefillRoutes: 0,
      payback: {
        reserveChain: "base",
        deliveredPeriodCountOnReserveChain: 2,
      },
    }),
    evGateStats: evGateStats(),
  });

  assert.equal(result.currentStage, "B");
  assert.equal(result.blockers.includes("stage_c_hysteresis_demoted"), true);
});
