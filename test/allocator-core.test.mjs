import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAllocatorCore, summarizeAllocatorCore } from "../src/strategy/allocator-core.mjs";

test("allocator core applies deterministic cap defaults and keeps blocked strategies review-only", () => {
  const report = buildAllocatorCore({
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: 300 },
      summary: { planningBudgetUsd: 1000 },
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
  assert.equal(report.activeView.maxAllocationPerStrategyUsd, 60);
  assert.equal(report.planningView.maxAllocationPerStrategyUsd, 200);
  assert.equal(report.planningView.planningQueue[0].id, "wrapped-btc-loop-base-moonwell");

  const summary = summarizeAllocatorCore(report);
  assert.equal(summary.activeAllocationCount, 0);
  assert.equal(summary.topPlanningCandidate.id, "wrapped-btc-loop-base-moonwell");
});
