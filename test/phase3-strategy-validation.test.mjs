import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPhase3StrategyValidation, summarizePhase3StrategyValidation } from "../src/strategy/phase3-strategy-validation.mjs";
import { resolveTrustTierDecision } from "../src/strategy/protocol-trust-tiers.mjs";
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
    wrappedBtcLoopLiveProof: {
      success: true,
      proofStatus: "signer_backed_roundtrip_recorded",
      entryCount: 2,
      unwindCount: 1,
      extendedReceiptContextReady: false,
      missingExtendedReceiptFields: ["observedHealthFactorPath", "realizedNetCarryUsd"],
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
  assert.equal(wrappedLoop.shockTestStatus, "live_roundtrip_recorded");
  assert.equal(wrappedLoop.blockers.includes("extended_receipt_context_missing"), true);
  assert.deepEqual(wrappedLoop.evidence.missingExtendedReceiptFields, ["observedHealthFactorPath", "realizedNetCarryUsd"]);

  const summary = summarizePhase3StrategyValidation(report);
  assert.equal(summary.validationCount, 4);
  assert.equal(summary.topBlocked.id, "wrapped_btc_loop_validation");
  assert.equal(summary.topBlocked.blockers.includes("extended_receipt_context_missing"), true);

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

test("phase3 strategy validation records signer-backed wrapped-loop roundtrip before full OOS packet exists", () => {
  const report = buildPhase3StrategyValidation({
    wrappedBtcLendingLoopSlice: {
      strategy: { id: "wrapped-btc-loop-base-moonwell", protocol: "moonwell" },
    },
    wrappedBtcLoopDryRun: {
      dryRunReceiptRecorded: true,
      autoUnwindPassCount: 1,
    },
    wrappedBtcLoopLiveProof: {
      success: true,
      proofStatus: "signer_backed_roundtrip_recorded",
      entryCount: 8,
      unwindCount: 4,
    },
    now: "2026-04-16T21:40:00.000Z",
  });

  const wrappedLoop = report.validations.find((item) => item.id === "wrapped_btc_loop_validation");
  assert.ok(wrappedLoop);
  assert.equal(wrappedLoop.oosSplitStatus, "signer_backed_roundtrip_recorded");
  assert.equal(wrappedLoop.shockTestStatus, "live_roundtrip_recorded");
  assert.equal(wrappedLoop.blockers.includes("extended_receipt_context_missing"), true);
  assert.equal(wrappedLoop.blockers.includes("oos_receipt_window_below_policy"), false);
  assert.equal(wrappedLoop.evidence.liveRoundtripProofStatus, "signer_backed_roundtrip_recorded");
  assert.equal(wrappedLoop.nextAction.code, "capture_wrapped_btc_loop_extended_receipt_context");
});

test("phase3 strategy validation surfaces recursive lending loops as blocked on observed receipts after dry-run evidence", () => {
  const report = buildPhase3StrategyValidation({
    recursiveWrappedBtcLoop: {
      strategy: { id: "recursive_wrapped_btc_lending_loop", label: "Recursive wrapped-BTC lending loop", protocol: "moonwell", arrivalFamily: "wrapped_btc" },
      validation: { ok: true },
      blockers: [],
      readiness: { readyForDryRun: true },
      executionSupport: { status: "repo_auto_build_supported" },
      dryRunSummary: { dryRunReceiptRecorded: true, autoUnwindPassCount: 2, signerBackedRunCount: 0 },
    },
    recursiveWrappedBtcLoopDryRun: {
      dryRunReceiptRecorded: true,
      autoUnwindPassCount: 2,
      signerBackedRunCount: 0,
    },
    recursiveStablecoinLoop: {
      strategy: { id: "recursive_stablecoin_lending_loop", label: "Recursive stablecoin lending loop", protocol: "morpho", arrivalFamily: "stablecoin" },
      validation: { ok: true },
      blockers: [],
      readiness: { readyForDryRun: true },
      executionSupport: { status: "planning_adapter_ready" },
      dryRunSummary: { dryRunReceiptRecorded: true, autoUnwindPassCount: 2, signerBackedRunCount: 0 },
    },
    recursiveStablecoinLoopDryRun: {
      dryRunReceiptRecorded: true,
      autoUnwindPassCount: 2,
      signerBackedRunCount: 0,
    },
    protocolTrustTiers: {
      items: [
        { id: "moonwell", status: "recorded", tier: "B", appliesTo: ["recursive_wrapped_btc_lending_loop"] },
        { id: "morpho", status: "recorded", tier: "B", appliesTo: ["recursive_stablecoin_lending_loop"] },
      ],
    },
    resolveTrustTierDecision,
    now: "2026-04-17T19:50:00.000Z",
  });

  const wrapped = report.validations.find((item) => item.id === "recursive_wrapped_btc_lending_loop_validation");
  const stable = report.validations.find((item) => item.id === "recursive_stablecoin_lending_loop_validation");
  assert.ok(wrapped);
  assert.ok(stable);
  assert.equal(wrapped.oosSplitStatus, "simulated_dry_run_recorded");
  assert.equal(wrapped.blockers.includes("recursive_observed_receipts_missing"), true);
  assert.equal(wrapped.nextAction.code, "collect_recursive_loop_observed_receipts");
  assert.equal(stable.blockers.includes("recursive_observed_receipts_missing"), true);
});
