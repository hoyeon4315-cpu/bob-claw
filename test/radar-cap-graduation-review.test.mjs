import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarCapGraduationReview } from "../src/strategy/radar/cap-graduation-review.mjs";

function realizedRecord(overrides = {}) {
  return {
    runId: overrides.runId || "run_1",
    candidateId: overrides.candidateId || "candidate_1",
    strategyId: overrides.strategyId || "wrapped-btc-loop-base-moonwell",
    familyKey: overrides.familyKey || "wrapped_btc_direct_lending",
    campaignWindowId: overrides.campaignWindowId || overrides.candidateId || "window_1",
    exitReceipts: [{ txHash: `0xexit${overrides.runId || "1"}` }],
    lifecycle: { strategyRealized: true, paybackDelivered: false },
    netRealizedPnlUsd: Object.hasOwn(overrides, "netRealizedPnlUsd") ? overrides.netRealizedPnlUsd : 2.5,
    netRealizedPnlSats: Object.hasOwn(overrides, "netRealizedPnlSats") ? overrides.netRealizedPnlSats : "-500",
    settledAt: overrides.settledAt || "2026-05-01T00:00:00.000Z",
  };
}

test("buildRadarCapGraduationReview recommends a committed cap raise after repeated positive realized PnL", () => {
  const review = buildRadarCapGraduationReview({
    realizationRecords: [
      realizedRecord({ runId: "run_1", candidateId: "candidate_a", campaignWindowId: "window_a", netRealizedPnlUsd: 2.5 }),
      realizedRecord({ runId: "run_2", candidateId: "candidate_b", campaignWindowId: "window_b", netRealizedPnlUsd: 1.25 }),
    ],
    now: "2026-05-01T12:00:00.000Z",
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(review.candidates.length, 1);
  assert.equal(review.candidates[0].strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(review.candidates[0].eligible, true);
  assert.equal(review.candidates[0].currentTinyLivePerTxUsd, 25);
  assert.equal(review.candidates[0].suggestedNextTinyLivePerTxUsd, 50);
  assert.equal(review.candidates[0].requiresCommittedDiff, true);
  assert.equal(review.candidates[0].autoRaise, false);
});

test("buildRadarCapGraduationReview blocks cap raise when only BTC-relative sats are negative without USD PnL", () => {
  const review = buildRadarCapGraduationReview({
    realizationRecords: [
      realizedRecord({ runId: "run_1", candidateId: "candidate_a", campaignWindowId: "window_a", netRealizedPnlUsd: undefined, netRealizedPnlSats: "-5" }),
      realizedRecord({ runId: "run_2", candidateId: "candidate_b", campaignWindowId: "window_b", netRealizedPnlUsd: undefined, netRealizedPnlSats: "-7" }),
    ],
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(review.candidates[0].eligible, false);
  assert.ok(review.candidates[0].blockers.includes("positive_realized_pnl_count_below_2"));
});

test("buildRadarCapGraduationReview trips radar loss lock blocker on 24h realized loss", () => {
  const review = buildRadarCapGraduationReview({
    realizationRecords: [
      realizedRecord({
        runId: "run_loss",
        candidateId: "candidate_loss",
        campaignWindowId: "window_loss",
        netRealizedPnlUsd: -26,
        netRealizedPnlSats: "-2600",
        settledAt: "2026-05-01T11:00:00.000Z",
      }),
    ],
    now: "2026-05-01T12:00:00.000Z",
    policy: { realizedDailyLossLockUsd: 25 },
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(review.lossLock.tripped, true);
  assert.equal(review.candidates[0].eligible, false);
  assert.ok(review.candidates[0].blockers.includes("radar_loss_lock_threshold_breached"));
});
