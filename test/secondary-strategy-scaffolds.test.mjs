import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSecondaryStrategyScaffolds, summarizeSecondaryStrategyScaffolds } from "../src/strategy/secondary-strategy-scaffolds.mjs";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../src/strategy/strategy-snapshot.mjs";

test("secondary strategy scaffolds rank follow-on builds with concrete blocker lists", () => {
  const report = buildSecondaryStrategyScaffolds({
    laneReclassification: {
      lanes: [
        {
          id: "stablecoin_entry_exit_loops",
          clearsNewFloor: true,
          passesOverfitGate: false,
          statusNew: "measured_overfit_blocked",
          netPnlMeasuredUsd: 0.42,
          gasSlippageVarianceUsd: 0.12,
        },
        {
          id: "btc_proxy_spreads",
          clearsNewFloor: false,
          passesOverfitGate: false,
          statusNew: "measured_inside_variance_floor",
          netPnlMeasuredUsd: 0.08,
        },
      ],
    },
    now: "2026-04-15T14:00:00.000Z",
  });

  assert.equal(report.summary.scaffoldCount, 6);
  assert.equal(report.summary.leverageCount, 3);
  assert.equal(report.summary.topScaffoldId, "stablecoin_spread_loop");
  assert.equal(report.scaffolds[0].blockers.includes("overfit_gate_blocked"), true);
  assert.equal(typeof report.scaffolds[0].sequencingDecision, "string");
  assert.equal(report.scaffolds[0].sequencingDecision.includes("same-chain"), true);

  const summary = summarizeSecondaryStrategyScaffolds(report);
  assert.equal(summary.topScaffold.id, "stablecoin_spread_loop");
  assert.equal(summary.statusCounts.design_scaffold >= 1, true);

  const snapshot = buildStrategySnapshot({
    dashboardStatus: {
      generatedAt: "2026-04-15T14:00:00.000Z",
      overall: { liveTrading: "BLOCKED", shadowTrading: "ALLOWED" },
      prelive: { currentStage: "shadow_replay" },
      strategy: {
        btcProxySpreads: null,
        strategyTracks: { tracks: [] },
        edgeViability: null,
        ethProfitability: null,
      },
    },
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
    secondaryStrategyScaffolds: report,
    now: "2026-04-15T14:00:00.000Z",
  });
  const summarizedSnapshot = summarizeStrategySnapshot(snapshot);
  assert.equal(snapshot.summary.secondaryScaffoldCount, 6);
  assert.equal(summarizedSnapshot.secondaryStrategyScaffolds.topScaffold.id, "stablecoin_spread_loop");
});
