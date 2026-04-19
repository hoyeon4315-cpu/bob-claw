import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyPivotPlan, summarizeStrategyPivotPlan } from "../src/strategy/pivot-plan.mjs";

function baseDashboardStatus() {
  return {
    generatedAt: "2026-04-13T23:40:02.198Z",
    overall: {
      liveTrading: "BLOCKED",
    },
    prelive: {
      currentStage: "shadow_replay",
    },
    strategy: {
      edgeViability: {
        measuredLoopCount: 0,
        positiveMeasuredCount: 0,
        policyReadyCount: 0,
        verdict: {
          code: "no_measured_loops",
        },
      },
      edgeResearch: {
        routeCount: 106,
        multiLevelCandidateCount: 0,
        definiteEdgeCandidateCount: 0,
        bestCandidate: {
          routeKey: "bitcoin:0x0->base:0x0",
          bestNetEdgeUsd: 0.6240654483040213,
          bestNetEdgePct: 0.0041744485759815046,
          classification: "no_edge",
          decay: {
            allCovered: true,
            allSurvived: false,
          },
        },
      },
      crossAssetArbitrage: {
        entryCount: 2,
        exitCount: 7,
        exactAssetPairCount: 14,
        matchedLoopCount: 0,
        profitableClosedLoopCount: 0,
        bestAmountLadderPair: {
          blockerCounts: [
            { blocker: "amount_mismatch", count: 4 },
            { blocker: "entry_insufficient_data", count: 4 },
          ],
        },
        closestLoop: {
          startInputUsd: 4.0325191575,
          finalOutputUsd: 142.08062022,
          loopNetEdgeUsd: 137.7772083513,
          amountGapPct: 44.47521600727604,
          blockers: [
            "amount_mismatch",
            "entry_insufficient_data",
            "exit_observe_only_slow_settlement",
          ],
        },
      },
      btcProxySpreads: {
        opportunityCount: 9,
        rawPositiveCount: 9,
        rebalancePositiveCount: 2,
        policyReadyCount: 1,
        overfitAssessment: "high_overfit_risk",
        overfitRisks: [
          "thin_buy_quote_coverage",
          "all_quotes_stale",
        ],
        nextCoverageTarget: {
          nextAction: "expand_amount_ladder",
          reason: "partial_amount_match",
          buyChains: ["base", "ethereum"],
          sellChains: ["base", "ethereum"],
        },
        bestRebalanceOpportunity: {
          proxyTicker: "WBTC/wBTC.OFT",
          buyStableCostUsd: 143.41076113524133,
          rebalanceAdjustedSpreadUsd: 1.7563278971077454,
          rebalanceAdjustedSpreadPct: 0.01224683477867792,
          blockers: [
            "rebalance_ethereum_l1_policy_override_disabled",
            "rebalance_exact_src_execution_gas_not_estimated",
          ],
        },
      },
      strategyTracks: {
        tracks: [
          { kind: "stable_loop", status: "blocked_loop", reason: "amount_mismatch" },
          { kind: "proxy_spread", status: "thin_coverage", reason: "partial_amount_match" },
        ],
      },
      objectivePlans: {
        discovery: {
          nextActionCode: "validate_route_durability",
          nextActionLabel: "validate route durability",
          reason: "multi_level_candidate",
          command: "npm run verify:gateway -- --route-key=\"bitcoin:0x0->base:0x0\" --amounts=\"10000\"",
        },
      },
    },
  };
}

test("strategy pivot plan removes the repo-wide live budget and builds a deterministic yield blueprint", () => {
  const plan = buildStrategyPivotPlan({
    dashboardStatus: baseDashboardStatus(),
    state: {
      scoreSnapshot: { scores: [] },
    },
    triangleArtifacts: {
      "base-btc": {
        latest: {
          totalSamples: 47,
          triangular: [
            {
              label: "USDC→LBTC→cbBTC→USDC",
              ok: true,
              netAfterFlashPct: -0.0836,
            },
          ],
          summary: {
            profitableAfterFlash: 0,
            meetsPolicy: 0,
            bestRoute: null,
            bestNetPct: null,
          },
        },
        analysis: {
          sampleCount: 441,
          overallBest: { max: 0.9017 },
          verdict: "policy_opportunity_detected — historical raw analysis artifact",
        },
      },
    },
  });

  assert.equal(plan.currentSystem.liveTrading, "BLOCKED");
  assert.equal(plan.currentSystem.riskBudgetUsd, 300);
  assert.equal(plan.budgetAssessment.currentBudgetUsd, 300);
  assert.match(plan.budgetAssessment.explanation[0], /per-strategy/i);
  assert.deepEqual(plan.budgetAssessment.budgetScenarios, [
    {
      budgetUsd: 300,
      label: "reference_cap_current",
      planningOnly: false,
    },
  ]);

  const yieldPivot = plan.pivots.find((pivot) => pivot.id === "gateway_base_btc_yield");
  assert.ok(yieldPivot);
  assert.equal(yieldPivot.status, "pre_execution_blueprint");
  assert.equal(yieldPivot.evidence.compatibility.requiredAdaptation, "deterministic_allowlisted_policy_engine");
  assert.equal(yieldPivot.capitalGuidance.researchPilotMinimumUsd, 105);
  assert.equal(yieldPivot.capitalGuidance.diversifiedSingleSleeveMinimumUsd, 205);
  assert.equal(yieldPivot.capitalGuidance.defaultDualSleeveMinimumUsd, 338.33);
  assert.equal(yieldPivot.capitalGuidance.budgetFit.researchPilotFits, true);
  assert.equal(yieldPivot.capitalGuidance.budgetFit.diversifiedSingleSleeveFits, true);
  assert.equal(yieldPivot.capitalGuidance.budgetFit.defaultDualSleeveFits, false);
  assert.equal(yieldPivot.budgetScenarios.length, 1);

  const proxyPivot = plan.pivots.find((pivot) => pivot.id === "btc_proxy_spreads");
  assert.ok(proxyPivot);
  assert.equal(proxyPivot.status, "blocked_policy_or_overfit");
  assert.equal(proxyPivot.capitalGuidance.minimumCapitalUsd, 143.41);
  assert.equal(proxyPivot.capitalGuidance.policyClear, true);
  assert.equal(proxyPivot.blockers.includes("thin_buy_quote_coverage"), true);

  const stablePivot = plan.pivots.find((pivot) => pivot.id === "stablecoin_entry_exit_loops");
  assert.ok(stablePivot);
  assert.equal(stablePivot.capitalGuidance.mode, "invalidated_measurement");
  assert.match(stablePivot.capitalGuidance.caveat, /amount mismatch/i);

  assert.equal(plan.recommendedPivotOrder[0].id, "gateway_base_btc_yield");
  const summary = summarizeStrategyPivotPlan(plan);
  assert.equal(summary.topRecommendation.id, "gateway_base_btc_yield");
  assert.equal(summary.topRecommendation.researchPilotMinimumUsd, 105);
  assert.equal(summary.currentBudgetUsd, 300);
  assert.equal(summary.budgetScenarios.length, 1);
  assert.equal(summary.topRecommendation.budgetScenarios.length, 1);
});

test("strategy pivot plan refuses to invent a triangle capital floor from flash-negative percent-only data", () => {
  const plan = buildStrategyPivotPlan({
    dashboardStatus: {
      generatedAt: "2026-04-13T23:40:02.198Z",
      overall: { liveTrading: "BLOCKED" },
      strategy: {},
    },
    state: {
      scoreSnapshot: { scores: [] },
    },
    triangleArtifacts: {
      "base-btc": {
        latest: {
          totalSamples: 12,
          triangular: [
            {
              label: "USDC→LBTC→cbBTC→USDC",
              ok: true,
              netAfterFlashPct: -0.0707,
            },
          ],
          summary: {
            profitableAfterFlash: 0,
            meetsPolicy: 0,
            bestRoute: null,
            bestNetPct: null,
          },
        },
        analysis: {
          sampleCount: 200,
          overallBest: { max: 0.9017 },
          verdict: "policy_opportunity_detected — stale raw artifact",
        },
      },
    },
  });

  const trianglePivot = plan.pivots.find((pivot) => pivot.id === "triangular_flash_btc");
  assert.ok(trianglePivot);
  assert.equal(trianglePivot.status, "blocked_current_surface");
  assert.equal(trianglePivot.reason, "latest_flash_negative");
  assert.equal(trianglePivot.capitalGuidance.mode, "unavailable");
});
