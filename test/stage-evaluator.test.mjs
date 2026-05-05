import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateStage } from "../src/executor/policy/stage-evaluator.mjs";

function marksSlice(overrides = {}) {
  return {
    reliability: {
      rolling1h: {
        refreshSuccessRatio: 1,
        transientFrequency: 0,
      },
      rolling3h: {
        refreshSuccessRatio: 0.98,
        transientFrequency: 0,
      },
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
      recovery24h: {
        stageB: {
          successesNeeded: 0,
          earliestRecoveryAt: "2026-05-05T00:00:00.000Z",
        },
        hysteresis: {
          successesNeeded: 0,
          earliestRecoveryAt: "2026-05-05T00:00:00.000Z",
        },
      },
    },
    ...overrides,
  };
}

function capitalPlan(overrides = {}) {
  return {
    unresolvedRefillRoutes: 1,
    payback: {
      scheduler: {
        status: "carry",
        reason: "planned_payback_below_minimum",
        minimumPaybackProgress: {
          minPaybackSats: 50_000,
          grossTargetBeforeCostsSats: 120,
          satsToMinimumPayback: 49_880,
        },
      },
      carry: {
        pendingSats: 601,
        progressToMinimumRatio: 0.0024,
      },
      expansionGate: {
        reserveChain: "base",
        deliveredPeriodCountOnReserveChain: 0,
      },
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
        scheduler: {
          status: "ready",
          reason: null,
        },
        expansionGate: {
          reserveChain: "base",
          deliveredPeriodCountOnReserveChain: 1,
        },
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
        scheduler: {
          status: "delivered",
          reason: null,
        },
        expansionGate: {
          reserveChain: "base",
          deliveredPeriodCountOnReserveChain: 2,
        },
      },
    }),
    evGateStats: evGateStats(),
  });

  assert.equal(result.currentStage, "B");
  assert.equal(result.blockers.includes("stage_c_hysteresis_demoted"), true);
});

test("stage evaluator surfaces payback carry evidence for missing delivered periods", () => {
  const result = evaluateStage({
    marksSlice: marksSlice(),
    capitalPlan: capitalPlan(),
    evGateStats: evGateStats(),
  });

  assert.equal(result.evidence.reserveChain, "base");
  assert.equal(result.evidence.deliveredPeriodCountOnReserveChain, 0);
  assert.equal(result.evidence.paybackStatus, "carry");
  assert.equal(result.evidence.paybackReason, "planned_payback_below_minimum");
  assert.equal(result.evidence.paybackPendingSats, 601);
  assert.equal(result.evidence.paybackProgressToMinimumRatio, 0.0024);
  assert.equal(result.evidence.paybackReceiptProof.ready, false);
  assert.equal(result.evidence.paybackReceiptProof.blocker, "receipt_proven_payback_period_missing");
  assert.equal(result.evidence.paybackReceiptProof.minPaybackSats, 50_000);
  assert.equal(result.evidence.paybackReceiptProof.grossTargetBeforeCostsSats, 120);
  assert.equal(result.evidence.paybackReceiptProof.satsToMinimumPayback, 49_880);
  assert.equal(result.evidence.refreshSuccessRatio1h, 1);
  assert.equal(result.evidence.refreshSuccessRatio3h, 0.98);
  assert.equal(result.evidence.transientFrequency1h, 0);
  assert.equal(result.evidence.transientFrequency3h, 0);
  assert.equal(result.evidence.refresh24hStageBSuccessesNeeded, 0);
  assert.equal(result.evidence.refresh24hStageBEarliestRecoveryAt, "2026-05-05T00:00:00.000Z");
  assert.equal(result.evidence.refresh24hHysteresisSuccessesNeeded, 0);
  assert.equal(result.evidence.refresh24hHysteresisEarliestRecoveryAt, "2026-05-05T00:00:00.000Z");
});
