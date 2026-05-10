import assert from "node:assert/strict";
import { test } from "node:test";
import { createStrategyRegistry } from "../../src/strategy/strategy-registry.mjs";

test("new strategy class can be added through a plugin without core scoring edits", async () => {
  const registry = createStrategyRegistry({
    classPlugins: [
      {
        classKey: "future_sleeve",
        classify: (record) => ({ ...record, family: record.family || "future" }),
        validateRecord: () => ({ ok: true, errors: [] }),
        scoreFor: (record) => ({ score: record.measured_apr_pct, breakdown: { plugin: true } }),
        buildEntryIntent: (record) => ({ intentType: "future_entry", strategyId: record.strategyId }),
        buildExitIntent: (record) => ({ intentType: "future_exit", strategyId: record.strategyId }),
        buildHealthCheck: (record) => ({ strategyId: record.strategyId, checks: [] }),
        expectedFailureModes: () => ["unknown_future_adapter"],
      },
    ],
    sourcePlugins: [
      {
        source: "future",
        loadRecords: async () => [
          {
            strategyId: "future-1",
            source: "future",
            classKey: "future_sleeve",
            family: "future",
            chain: "unichain",
            protocol: "future",
            poolKey: "pool",
            measured_apr_pct: 4,
            reward_haircut_pct: 0,
            entry_cost_usd_per_dollar: 0,
            exit_cost_usd_per_dollar: 0,
            expected_hold_days: 30,
            il_risk_class: "none",
            audit_status: "review",
            protocol_age_days: 1,
            receipts_positive_count: 0,
            receipts_total_count: 0,
            backtest_quality: "operator_override",
            positionReader: { kind: "future" },
            rewardAccrual: { kind: "none" },
            pnlAccounting: { unit: "BTC" },
          },
        ],
      },
    ],
  });

  const envelope = await registry.refresh();

  assert.equal(envelope.records[0].classKey, "future_sleeve");
  assert.equal(envelope.records[0].plugin.classKey, "future_sleeve");
  assert.equal(envelope.records[0].entryIntent.intentType, "future_entry");
});
