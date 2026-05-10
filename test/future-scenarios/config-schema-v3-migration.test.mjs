import assert from "node:assert/strict";
import { test } from "node:test";
import { migrateStrategyRecord, validateStrategyRecord } from "../../src/strategy/strategy-record-schema.mjs";

test("schema v3 migration fills new safety fields deterministically", () => {
  const migrated = migrateStrategyRecord({
    schemaVersion: 2,
    strategyId: "old-record",
    source: "manual",
    classKey: "yield",
    family: "stable",
    chain: "bob",
    protocol: "generic",
    poolKey: "pool",
    measured_apr_pct: 5,
    reward_haircut_pct: 0,
    entry_cost_usd_per_dollar: 0,
    exit_cost_usd_per_dollar: 0,
    expected_hold_days: 30,
    il_risk_class: "low",
    audit_status: "review",
    protocol_age_days: 900,
    receipts_positive_count: 3,
    receipts_total_count: 4,
    positionReader: { kind: "reader" },
    rewardAccrual: { kind: "none" },
    pnlAccounting: { unit: "BTC" },
  });

  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.backtest_quality, "paper_only");
  assert.equal(validateStrategyRecord(migrated).ok, true);
});
