import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLaneReclassificationArtifact,
  buildOverfitAuditArtifact,
  summarizePhase1Revalidation,
} from "../src/strategy/phase1-revalidation.mjs";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../src/strategy/strategy-snapshot.mjs";

function dashboardStatusFixture() {
  return {
    generatedAt: "2026-04-15T03:00:00.000Z",
    overall: {
      liveTrading: "BLOCKED",
      shadowTrading: "ALLOWED",
    },
    prelive: {
      currentStage: "shadow_replay",
    },
    strategy: {
      edgeViability: {
        measuredLoopCount: 1,
        positiveMeasuredCount: 1,
        policyReadyCount: 0,
        verdict: { code: "positive_but_below_policy" },
        bestMeasuredLoop: {
          routeKey: "bob:0xbtc->base:0xbtc",
          amount: "10000",
          measuredLoopNetUsd: 0.5,
        },
      },
      crossAssetArbitrage: {
        bestLoop: null,
        closestLoop: null,
      },
      btcProxySpreads: {
        opportunityCount: 2,
        policyReadyCount: 1,
        overfitAssessment: "high_overfit_risk",
        overfitRisks: ["thin_buy_quote_coverage"],
        bestRebalanceOpportunity: {
          rebalanceRouteKey: "base:0xwbtc->bob:0xwbtc",
          amount: "10000",
          rebalanceAdjustedSpreadUsd: 0.12,
        },
      },
      ethProfitability: null,
      strategyTracks: {
        tracks: [
          { kind: "stable_loop", status: "route_only", reason: "no_stable_loop_observed" },
          { kind: "proxy_spread", status: "thin_coverage", reason: "partial_amount_match" },
        ],
      },
      objectivePlans: {
        discovery: {
          nextActionCode: "validate_route_durability",
          nextActionLabel: "validate route durability",
          command: "npm run verify:gateway -- --route-key=\"bob:0xbtc->base:0xbtc\" --amounts=\"10000\"",
        },
      },
    },
  };
}

test("phase1 artifacts classify lanes with variance and overfit context", () => {
  const snapshot = buildStrategySnapshot({
    dashboardStatus: dashboardStatusFixture(),
    state: {
      scoreSnapshot: { scores: [] },
    },
    triangleArtifacts: {},
  });

  const overfitArtifact = buildOverfitAuditArtifact({
    audit: {
      auditLabel: "Overfit Audit",
      decision: "LIVE_BLOCKED",
      shadow: "ALLOWED",
      sampleSource: "shadow_observations",
      checks: [{ label: "shadow time window", ok: false }],
      warnings: [{ label: "legacy records", ok: false }],
    },
    strategySnapshot: snapshot,
    now: "2026-04-15T03:00:00.000Z",
  });

  const varianceArtifact = {
    routes: [
      {
        routeVariantKey: "bob:0xbtc->base:0xbtc|10000",
        routeKey: "bob:0xbtc->base:0xbtc",
        amount: "10000",
        policyNoiseFloorUsd: 0.2,
      },
      {
        routeVariantKey: "base:0xwbtc->bob:0xwbtc|10000",
        routeKey: "base:0xwbtc->bob:0xwbtc",
        amount: "10000",
        policyNoiseFloorUsd: 0.05,
      },
    ],
    summary: {
      routeVariantCount: 2,
      varianceReadyRouteCount: 2,
    },
  };

  const laneReclassification = buildLaneReclassificationArtifact({
    strategySnapshot: snapshot,
    dashboardStatus: dashboardStatusFixture(),
    varianceArtifact,
    overfitAuditArtifact: overfitArtifact,
    now: "2026-04-15T03:00:00.000Z",
  });

  const gatewayLoop = laneReclassification.lanes.find((lane) => lane.id === "gateway_wrapped_btc_loops");
  assert.ok(gatewayLoop);
  assert.equal(gatewayLoop.statusNew, "candidate_for_validation");
  assert.equal(gatewayLoop.clearsNewFloor, true);
  assert.equal(gatewayLoop.gasSlippageVarianceUsd, 0.2);

  const proxy = laneReclassification.lanes.find((lane) => lane.id === "btc_proxy_spreads");
  assert.ok(proxy);
  assert.equal(proxy.statusNew, "measured_overfit_blocked");
  assert.equal(proxy.clearsNewFloor, true);
  assert.equal(proxy.passesOverfitGate, false);

  const phase1Summary = summarizePhase1Revalidation({
    overfitAuditArtifact: overfitArtifact,
    varianceArtifact,
    laneReclassification,
  });
  assert.equal(phase1Summary.globalOverfitPasses, false);
  assert.equal(phase1Summary.candidateForValidationCount, 1);
  assert.equal(phase1Summary.clearsNewFloorCount >= 1, true);

  const snapshotWithPhase1 = buildStrategySnapshot({
    dashboardStatus: dashboardStatusFixture(),
    state: {
      scoreSnapshot: { scores: [] },
    },
    triangleArtifacts: {},
    phase1Revalidation: {
      overfitAuditArtifact: overfitArtifact,
      gasSlippageVariance: varianceArtifact,
      laneReclassification,
    },
  });
  const summarized = summarizeStrategySnapshot(snapshotWithPhase1);
  assert.equal(summarized.phase1Revalidation.overfitDecision, "LIVE_BLOCKED");
  assert.equal(summarized.phase1Revalidation.candidateForValidationCount, 1);
});
