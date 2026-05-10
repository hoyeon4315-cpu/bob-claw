import assert from "node:assert/strict";
import { test } from "node:test";
import { createStrategyRegistry } from "../../src/strategy/strategy-registry.mjs";

test("retired DefiLlama source is isolated while other sources continue", async () => {
  const registry = createStrategyRegistry({
    sourcePlugins: [
      {
        source: "defillama",
        loadRecords: async () => {
          throw new Error("defillama retired this endpoint");
        },
      },
      {
        source: "manual",
        loadRecords: async () => [
          {
            strategyId: "manual-1",
            source: "manual",
            classKey: "yield",
            family: "stable_carry",
            chain: "sonic",
            protocol: "future-protocol",
            poolKey: "pool-1",
            measured_apr_pct: 8,
            reward_haircut_pct: 0,
            entry_cost_usd_per_dollar: 0.001,
            exit_cost_usd_per_dollar: 0.001,
            expected_hold_days: 14,
            il_risk_class: "low",
            audit_status: "review",
            protocol_age_days: 400,
            receipts_positive_count: 1,
            receipts_total_count: 1,
            backtest_quality: "wf_cv_1_regime",
            positionReader: { kind: "reader", status: "declared" },
            rewardAccrual: { kind: "none" },
            pnlAccounting: { unit: "BTC", status: "declared" },
          },
        ],
      },
    ],
  });

  const envelope = await registry.refresh();

  assert.equal(envelope.ok, true);
  assert.equal(envelope.records.length, 1);
  assert.equal(envelope.sourceHealth.defillama.ok, false);
  assert.match(envelope.sourceHealth.defillama.error, /retired/);
  assert.equal(envelope.sourceHealth.manual.ok, true);
});
