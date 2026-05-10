import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyBlocker } from "../../src/executor/blocker-classifier.mjs";
import { rotateTopK } from "../../src/executor/portfolio-allocator/top-k-rotator.mjs";

const baseRecord = {
  strategyId: "base-yield",
  source: "manual",
  classKey: "yield",
  family: "stable_carry",
  chain: "base",
  protocol: "generic-base",
  poolKey: "base-pool",
  measured_apr_pct: 12,
  reward_haircut_pct: 20,
  entry_cost_usd_per_dollar: 0.001,
  exit_cost_usd_per_dollar: 0.001,
  expected_hold_days: 10,
  il_risk_class: "low",
  audit_status: "review",
  protocol_age_days: 365,
  receipts_positive_count: 2,
  receipts_total_count: 2,
  backtest_quality: "wf_cv_1_regime",
  positionReader: { kind: "reader", status: "declared" },
  rewardAccrual: { kind: "reward", status: "declared" },
  pnlAccounting: { unit: "BTC", status: "declared" },
};

test("base down for seven days freezes only base slots", () => {
  const blocker = classifyBlocker("chain_base_down_7d", { chain: "base" });
  const result = rotateTopK(
    [
      baseRecord,
      {
        ...baseRecord,
        strategyId: "sonic-yield",
        chain: "sonic",
        protocol: "generic-sonic",
        poolKey: "sonic-pool",
      },
    ],
    {
      capitalUsd: 500,
      chainBlockers: new Map([[blocker.chain, blocker]]),
    },
  );

  assert.equal(blocker.category, "chain");
  assert.deepEqual(result.selected.map((item) => item.record.strategyId), ["sonic-yield"]);
  assert.equal(result.actions[0].strategyId, "sonic-yield");
});
