import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClDashboardHealthSlice,
  calculateCLPositionStatus,
} from "../src/strategy/aerodrome-cl-manager.mjs";

test("calculateCLPositionStatus exposes time-in-range and fees-vs-IL health", () => {
  const status = calculateCLPositionStatus({
    entryEthBtcRatio: 0.05,
    currentEthBtcRatio: 0.053,
    rangeWidthPct: 0.10,
    capitalUsd: 100,
    accumulatedFeesUsd: 0.4,
    daysHeld: 3,
    timeInRangePct24h: 0.72,
    ilExceedsFeesHours: 2,
  });

  assert.equal(status.inRange, true);
  assert.equal(status.timeInRangePct24h, 0.72);
  assert.equal(status.ilExceedsFeesHours, 2);
  assert.equal(status.feesVsIlRatio > 0, true);
  assert.equal(Object.hasOwn(status, "ilExceedsFees"), true);
});

test("buildClDashboardHealthSlice returns dashboard-ready CL metrics", () => {
  const status = calculateCLPositionStatus({
    entryEthBtcRatio: 0.05,
    currentEthBtcRatio: 0.06,
    rangeWidthPct: 0.10,
    capitalUsd: 100,
    accumulatedFeesUsd: 0.1,
    daysHeld: 14,
    timeInRangePct24h: 0.55,
    ilExceedsFeesHours: 6,
  });
  const slice = buildClDashboardHealthSlice(status, {
    observedAt: "2026-05-08T00:00:00.000Z",
    strategyId: "aerodrome-cl-base",
  });

  assert.equal(slice.strategyId, "aerodrome-cl-base");
  assert.equal(slice.observedAt, "2026-05-08T00:00:00.000Z");
  assert.equal(slice.timeInRangePct24h, 0.55);
  assert.equal(slice.impermanentLossUsd, status.ilUsd);
  assert.equal(slice.accumulatedFeesUsd, 0.1);
  assert.equal(slice.feesVsIlRatio, status.feesVsIlRatio);
  assert.equal(slice.ilExceedsFeesHours, 6);
  assert.equal(slice.healthStatus, "review");
});
