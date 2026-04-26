import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../src/strategy/strategy-snapshot.mjs";

function dashboardStatusFixture() {
  return {
    generatedAt: "2026-04-14T03:08:10.854Z",
    overall: {
      liveTrading: "BLOCKED",
      shadowTrading: "ALLOWED",
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
        coverageTargets: [],
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

function triangleArtifactsFixture() {
  return {
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
  };
}

test("strategy snapshot preserves implemented strategies and planning layers in one artifact", () => {
  const snapshot = buildStrategySnapshot({
    dashboardStatus: dashboardStatusFixture(),
    state: {
      scoreSnapshot: { scores: [] },
    },
    triangleArtifacts: triangleArtifactsFixture(),
    autonomousDiscoveryBoard: {
      summary: {
        opportunityCount: 3,
        readyNowCount: 1,
        topOpportunityId: "recursive_wrapped_btc_lending_loop",
        nextAction: {
          code: "record_recursive_loop_dry_run_receipt",
          command: "npm run run:recursive-lending-loop-dry-run -- --strategy=recursive_wrapped_btc_lending_loop --write",
        },
      },
      opportunities: [
        {
          id: "recursive_wrapped_btc_lending_loop",
          label: "Recursive wrapped-BTC lending loop",
          type: "deterministic_strategy",
          lane: "strategy",
          status: "repo_auto_build_supported",
          priorityScore: 0.97,
          nextAction: {
            code: "record_recursive_loop_dry_run_receipt",
            command: "npm run run:recursive-lending-loop-dry-run -- --strategy=recursive_wrapped_btc_lending_loop --write",
          },
        },
      ],
    },
    leverageAutoUnwindRuntimeReports: [
      {
        strategy: { id: "wrapped-btc-loop-base-moonwell", label: "Wrapped BTC lending loop (Base / Moonwell)", chain: "base", protocol: "moonwell" },
        runtime: { status: "healthy", severity: "info", triggerCount: 0 },
        watcherDecision: { triggers: [] },
        emergencyUnwindExecution: { status: "standby", actions: new Array(9).fill({}) },
        nextAction: { code: "continue_monitoring" },
      },
      {
        strategy: { id: "recursive_wrapped_btc_lending_loop", label: "Recursive wrapped-BTC lending loop", chain: "base", protocol: "moonwell" },
        runtime: { status: "pause_new_entries", severity: "warning", triggerCount: 1 },
        watcherDecision: { triggers: ["unwind_gas_above_budget"] },
        emergencyUnwindExecution: { status: "standby", actions: new Array(9).fill({}) },
        nextAction: { code: "pause_new_entries_and_review" },
      },
    ],
  });

  assert.equal(snapshot.currentSystem.liveTrading, "BLOCKED");
  assert.equal(snapshot.currentSystem.activeBudgetUsd, 1_000_000);
  assert.equal(snapshot.currentSystem.referenceBudgetUsd, 1_000_000);
  assert.equal(snapshot.summary.planningBudgetUsd, null);
  assert.equal(snapshot.planningLayers.yieldShadowBook.topProfile.id, "research_pilot");
  assert.equal(snapshot.planningLayers.capitalExpansionReview.summary.activeLaneBudgetUsd, 1_000_000);
  assert.equal(snapshot.planningLayers.capitalExpansionReview.summary.planningLaneBudgetUsd, null);
  assert.equal(snapshot.planningLayers.formulaAudit.summary.implementedCount, 3);
  assert.equal(snapshot.planningLayers.formulaAudit.summary.topGap.id, "advanced_overfit_statistics");
  assert.equal(snapshot.planningLayers.leverageAutoUnwindRuntime.runtimeCount, 2);
  assert.equal(snapshot.planningLayers.leverageAutoUnwindRuntime.topPriority.strategyId, "recursive_wrapped_btc_lending_loop");
  assert.equal(snapshot.summary.autonomousDiscoveryOpportunityCount, 3);
  assert.equal(snapshot.summary.autonomousDiscoveryTopOpportunityId, "recursive_wrapped_btc_lending_loop");

  const proxy = snapshot.implementedStrategies.find((item) => item.id === "btc_proxy_spreads");
  assert.ok(proxy);
  assert.equal(proxy.capitalGuidance.minimumCapitalUsd, 143.41);
  assert.equal(proxy.overfitRisks.includes("thin_buy_quote_coverage"), true);

  const summary = summarizeStrategySnapshot(snapshot);
  assert.equal(summary.topPivot.id, "gateway_base_btc_yield");
  assert.equal(summary.topAction.code, "build_deterministic_yield_shadow_book");
  assert.equal(summary.activeBudgetUsd, 1_000_000);
  assert.equal(summary.capitalExpansionReview.activeLaneBudgetUsd, 1_000_000);
  assert.equal(summary.capitalExpansionReview.planningLaneBudgetUsd, null);
  assert.equal(summary.capitalExpansionReview.approvalRequiredForPlanningLane, false);
  assert.equal(summary.formulaAudit.summary.missingCount, 1);
  assert.equal(summary.leverageAutoUnwindRuntime.topPriority.status, "pause_new_entries");
  assert.equal(summary.autonomousDiscoveryBoard.topOpportunity.id, "recursive_wrapped_btc_lending_loop");
  assert.equal(summary.productCoverage.pillarCount, 3);
  assert.equal(summary.productCoverage.topGap.id, "payback_engine");
});
