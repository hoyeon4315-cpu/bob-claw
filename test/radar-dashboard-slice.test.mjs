import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarDashboardSlice } from "../src/status/radar-slice.mjs";

test("buildRadarDashboardSlice exposes public-safe stage counts and guardrails", () => {
  const slice = buildRadarDashboardSlice({
    board: {
      generatedAt: "2026-04-30T15:00:00.000Z",
      summary: {
        observedCount: 3,
        strategyEpisodeCount: 2,
        portablePacketCount: 1,
        executableCount: 0,
        strategyRealizedCount: 1,
        positiveRealizedPnlCount: 1,
        paybackDeliveredCount: 0,
        totalNetRealizedPnlUsd: 2.5,
        totalNetRealizedPnlSats: "42",
      },
      blockerCounts: {
        radar_policy_thresholds_unresolved: 2,
        non_gateway_manual_bridge: 1,
      },
      observations: [{ obsId: "obs_1", rawEventPayloadHash: "sha256:hidden" }],
    },
    capReview: {
      lossLock: { tripped: false },
      candidates: [{
        eligible: true,
        suggestedNextTinyLivePerTxUsd: 50,
      }],
    },
  });

  assert.equal(slice.available, true);
  assert.equal(slice.status, "portable_review");
  assert.equal(slice.headline, "Replay-backed candidate needs review");
  assert.equal(slice.stageCounts.observed, 3);
  assert.equal(slice.stageCounts.hypothesis, 2);
  assert.equal(slice.stageCounts.portable, 1);
  assert.equal(slice.stageCounts.executableReview, 0);
  assert.equal(slice.stageCounts.selfRealized, 1);
  assert.equal(slice.stageCounts.positiveRealizedPnl, 1);
  assert.equal(slice.stageCounts.paybackDelivered, 0);
  assert.equal(slice.pnl.totalNetRealizedPnlUsd, 2.5);
  assert.equal(slice.pnl.totalNetRealizedPnlSats, "42");
  assert.equal(slice.capReview.eligibleCount, 1);
  assert.equal(slice.capReview.lossLockOn, false);
  assert.equal(slice.capReview.topSuggestedNextTinyLivePerTxUsd, 50);
  assert.deepEqual(slice.topBlocker, { code: "radar_policy_thresholds_unresolved", count: 2 });
  assert.equal(slice.guardrails.readOnly, true);
  assert.equal(slice.guardrails.externalWalletPnlUnverified, true);
  assert.equal(slice.guardrails.thresholdsResolved, true);
  assert.equal(JSON.stringify(slice).includes("rawEventPayloadHash"), false);
});
