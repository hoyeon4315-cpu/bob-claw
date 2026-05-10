import assert from "node:assert/strict";
import { test } from "node:test";
import { rotateTopK } from "../../src/executor/portfolio-allocator/top-k-rotator.mjs";

test("all current strategies dead returns conservative no-tx without crashing", () => {
  const result = rotateTopK(
    [
      {
        strategyId: "dead-a",
        source: "manual",
        classKey: "yield",
        family: "btc_yield",
        chain: "base",
        protocol: "generic",
        poolKey: "pool-a",
        measured_apr_pct: 14,
        reward_haircut_pct: 50,
        entry_cost_usd_per_dollar: 0.01,
        exit_cost_usd_per_dollar: 0.01,
        expected_hold_days: 7,
        il_risk_class: "medium",
        audit_status: "review",
        protocol_age_days: 100,
        receipts_positive_count: 0,
        receipts_total_count: 0,
        backtest_quality: "paper_only",
        positionReader: { kind: "reader", status: "declared" },
        rewardAccrual: { kind: "reward", status: "declared" },
        pnlAccounting: { unit: "BTC", status: "declared" },
      },
    ],
    {
      capitalUsd: 500,
      blockedStrategies: new Set(["dead-a"]),
    },
  );

  assert.equal(result.status, "no_action");
  assert.equal(result.noTxReason, "no_strategy_candidates_eligible");
  assert.equal(result.blockerClass, "policy");
});
