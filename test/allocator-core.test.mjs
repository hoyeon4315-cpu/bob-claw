import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAllocatorCore, summarizeAllocatorCore } from "../src/strategy/allocator-core.mjs";

test("allocator core applies deterministic cap defaults and keeps blocked strategies review-only", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: {
      validations: [
        {
          id: "wrapped_btc_loop_validation",
          overallStatus: "blocked",
          blockers: ["oos_receipt_window_below_policy"],
          nextAction: { code: "collect_wrapped_btc_loop_oos_receipts" },
        },
        {
          id: "stablecoin_spread_loop_validation",
          overallStatus: "blocked",
          blockers: ["overfit_gate_blocked", "search_complexity_budget_not_recorded"],
        },
      ],
    },
    wrappedBtcLendingLoopSlice: {
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        label: "Wrapped BTC lending loop (Base / Moonwell)",
        chain: "base",
        protocol: "moonwell",
      },
    },
    secondaryStrategyScaffolds: {
      scaffolds: [
        {
          id: "stablecoin_spread_loop",
          label: "Stablecoin spread loop",
          category: "yield",
          protocolTrack: { chains: ["base"], protocols: ["morpho", "aave_v3"] },
          blockers: ["stable_loop_protocol_adapter_not_built"],
          nextAction: { code: "build_stablecoin_spread_loop" },
        },
      ],
    },
    now: "2026-04-15T16:00:00.000Z",
  });

  assert.equal(report.summary.candidateCount, 2);
  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(report.activeView.maxAllocationPerStrategyUsd, null);
  assert.equal(report.planningView.maxAllocationPerStrategyUsd, null);
  assert.equal(report.planningView.planningQueue[0].id, "wrapped-btc-loop-base-moonwell");
  assert.equal(
    report.notes.some((item) => item.includes("Cross-chain reserve movement belongs in the allocator/rebalance layer")),
    true,
  );

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.activeAllocationCount, 0);
  assert.equal(summary.activeReadyCandidateCount, 0);
  assert.equal(summary.topActiveReadyCandidate, null);
  assert.equal(summary.topPlanningCandidate.id, "wrapped-btc-loop-base-moonwell");
});

test("allocator core prioritizes recursive wrapped loop when recursive phase3 validation exists", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          overallStatus: "blocked",
          blockers: ["recursive_observed_receipts_missing"],
          evidence: { strategyId: "recursive_wrapped_btc_lending_loop" },
          nextAction: { code: "collect_recursive_loop_observed_receipts" },
        },
      ],
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        chain: "base",
        protocol: "moonwell",
        arrivalFamily: "wrapped_btc",
      },
    },
    now: "2026-04-17T19:50:00.000Z",
  });

  assert.equal(report.summary.candidateCount, 1);
  assert.equal(report.planningView.planningQueue[0].id, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.summary.nextAction.code, "collect_recursive_loop_observed_receipts");
});

test("allocator core exposes active-ready recursive strategy even before an active budget exists", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          overallStatus: "passed",
          blockers: [],
          evidence: { strategyId: "recursive_wrapped_btc_lending_loop" },
          nextAction: { code: "review_recursive_loop_observed_receipts" },
        },
        {
          id: "recursive_stablecoin_lending_loop_validation",
          overallStatus: "blocked",
          blockers: ["stable_swap_binding_missing"],
          evidence: { strategyId: "recursive_stablecoin_lending_loop" },
          nextAction: { code: "materialize_stable_swap_binding" },
        },
      ],
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        chain: "base",
        protocol: "moonwell",
        arrivalFamily: "wrapped_btc",
      },
    },
    recursiveStablecoinLoop: {
      strategy: {
        id: "recursive_stablecoin_lending_loop",
        label: "Recursive stablecoin lending loop",
        chain: "base",
        protocol: "aave_v3",
        arrivalFamily: "stablecoin",
      },
    },
    now: "2026-04-18T11:30:00.000Z",
  });

  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(report.summary.activeReadyCandidateCount, 1);
  assert.equal(report.summary.topActiveAllocationId, null);
  assert.equal(report.summary.topActiveReadyCandidateId, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.summary.nextAction.code, "review_recursive_loop_observed_receipts");
  assert.equal(report.planningView.planningQueue[0].id, "recursive_wrapped_btc_lending_loop");

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.topActiveAllocation, null);
  assert.equal(summary.topActiveReadyCandidate.id, "recursive_wrapped_btc_lending_loop");
  assert.equal(summary.activeNextAction.code, "review_recursive_loop_observed_receipts");
});

test("allocator core keeps active allocation distinct once active budget is declared", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: 500 },
      summary: { planningBudgetUsd: 1000 },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          overallStatus: "passed",
          blockers: [],
          evidence: { strategyId: "recursive_wrapped_btc_lending_loop" },
          nextAction: { code: "review_recursive_loop_observed_receipts" },
        },
      ],
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        chain: "base",
        protocol: "moonwell",
        arrivalFamily: "wrapped_btc",
      },
    },
    now: "2026-04-18T11:35:00.000Z",
  });

  assert.equal(report.summary.activeAllocationCount, 1);
  assert.equal(report.summary.topActiveAllocationId, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.activeView.activePlan[0].maxAllocationUsd, 100);

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.topActiveAllocation.id, "recursive_wrapped_btc_lending_loop");
  assert.equal(summary.topActiveAllocation.maxAllocationUsd, 100);
});
