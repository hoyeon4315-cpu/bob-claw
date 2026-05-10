import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreStrategyForSlot } from "../../src/executor/portfolio-allocator/top-k-rotator.mjs";

function record(haircut) {
  return {
    strategyId: `reward-${haircut}`,
    source: "manual",
    classKey: "yield",
    family: "campaign",
    chain: "bsc",
    protocol: "generic",
    poolKey: `pool-${haircut}`,
    measured_apr_pct: 25,
    reward_haircut_pct: haircut,
    entry_cost_usd_per_dollar: 0.002,
    exit_cost_usd_per_dollar: 0.003,
    expected_hold_days: 7,
    il_risk_class: "medium",
    audit_status: "review",
    protocol_age_days: 60,
    receipts_positive_count: 0,
    receipts_total_count: 0,
    backtest_quality: "paper_only",
    positionReader: { kind: "reader" },
    rewardAccrual: { kind: "reward" },
    pnlAccounting: { unit: "BTC" },
  };
}

test("90 percent reward-token loss sharply reduces score and exposes breakeven", () => {
  const normal = scoreStrategyForSlot(record(50), { capitalUsd: 500 });
  const shocked = scoreStrategyForSlot(record(90), { capitalUsd: 500 });

  assert.equal(shocked.breakdown.rewardHaircutPct, 90);
  assert.equal(shocked.score < normal.score, true);
  assert.equal(shocked.breakdown.breakeven_days > 0, true);
});
