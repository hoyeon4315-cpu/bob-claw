import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPhase3StrategyValidation, summarizePhase3StrategyValidation } from "../src/strategy/phase3-strategy-validation.mjs";
import { buildSearchComplexityBudgets, resolveSearchComplexityBudget } from "../src/strategy/search-complexity-budgets.mjs";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../src/strategy/strategy-snapshot.mjs";

test("phase3 strategy validation records OOS, search-budget, and shock-test blockers", () => {
  const report = buildPhase3StrategyValidation({
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
    wrappedBtcLendingLoopSlice: {
      strategy: { id: "wrapped-btc-loop-base-moonwell", protocol: "moonwell" },
    },
    wrappedBtcLoopDryRun: {
      dryRunReceiptRecorded: true,
      autoUnwindPassCount: 1,
    },
    secondaryStrategyScaffolds: {
      scaffolds: [
        {
          id: "tokenized_reserve_sleeve",
          label: "Tokenized reserve sleeve",
          status: "design_scaffold",
          leverage: false,
          blockers: ["issuer_due_diligence_missing"],
          nextAction: { code: "review_reserve_issuer" },
        },
      ],
    },
    now: "2026-04-15T15:00:00.000Z",
  });

  assert.equal(report.summary.validationCount, 4);
  assert.equal(report.summary.passedCount, 0);
  assert.equal(report.summary.topBlockedId, "wrapped_btc_loop_validation");

  const wrappedLoop = report.validations.find((item) => item.id === "wrapped_btc_loop_validation");
  assert.ok(wrappedLoop);
  assert.equal(wrappedLoop.shockTestStatus, "simulated_pass");
  assert.equal(wrappedLoop.blockers.includes("oos_receipt_window_below_policy"), true);

  const summary = summarizePhase3StrategyValidation(report);
  assert.equal(summary.validationCount, 4);
  assert.equal(summary.topBlocked.id, "wrapped_btc_loop_validation");

  const snapshot = buildStrategySnapshot({
    dashboardStatus: {
      generatedAt: "2026-04-15T15:00:00.000Z",
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
    phase3StrategyValidation: report,
    now: "2026-04-15T15:00:00.000Z",
  });
  const summarizedSnapshot = summarizeStrategySnapshot(snapshot);
  assert.equal(snapshot.summary.phase3ValidationCount, 4);
  assert.equal(snapshot.summary.phase3TopBlockedId, "wrapped_btc_loop_validation");
  assert.equal(summarizedSnapshot.phase3StrategyValidation.topBlocked.id, "wrapped_btc_loop_validation");
});

test("phase3 strategy validation clears recorded search-complexity budgets for stable and proxy lanes", () => {
  const secondaryStrategyScaffolds = {
    scaffolds: [
      {
        id: "stablecoin_spread_loop",
        protocolTrack: {
          chains: ["base"],
          protocols: ["morpho", "aave_v3", "euler"],
          collateralAsset: "USDC",
          borrowAsset: "USDT",
        },
      },
      {
        id: "proxy_spread_expansion",
        protocolTrack: {
          chains: ["base", "bob", "bera", "unichain"],
          wrappers: ["WBTC", "wBTC.OFT", "LBTC", "cbBTC", "tBTC"],
        },
      },
    ],
  };
  const searchComplexityBudgets = buildSearchComplexityBudgets({ secondaryStrategyScaffolds });
  const report = buildPhase3StrategyValidation({
    laneReclassification: {
      lanes: [
        {
          id: "stablecoin_entry_exit_loops",
          clearsNewFloor: true,
          passesOverfitGate: false,
          statusNew: "measured_overfit_blocked",
        },
        {
          id: "btc_proxy_spreads",
          clearsNewFloor: true,
          passesOverfitGate: false,
          statusNew: "thin_coverage",
        },
      ],
    },
    secondaryStrategyScaffolds,
    searchComplexityBudgets,
    resolveSearchComplexityBudget,
    now: "2026-04-15T15:00:00.000Z",
  });

  const stable = report.validations.find((item) => item.id === "stablecoin_spread_loop_validation");
  const proxy = report.validations.find((item) => item.id === "proxy_spread_expansion_validation");
  assert.equal(stable.searchComplexityStatus, "budget_recorded");
  assert.equal(stable.blockers.includes("search_complexity_budget_not_recorded"), false);
  assert.equal(proxy.searchComplexityStatus, "budget_recorded");
  assert.equal(proxy.blockers.includes("search_complexity_budget_not_recorded"), false);
});
