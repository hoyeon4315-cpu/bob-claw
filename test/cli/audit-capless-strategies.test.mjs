import assert from "node:assert/strict";
import { test } from "node:test";
import { auditCaplessStrategies } from "../../src/cli/audit-capless-strategies.mjs";

test("capless audit emits exactly one row per capless blocker with deterministic recommendation", () => {
  const report = auditCaplessStrategies({
    blockerFunnel: {
      rootCauseGroups: [
        { code: "hard_safety_stop:capless_strategy", params: { strategyId: "s1" }, affectedStrategies: ["s1"] },
        { code: "hard_safety_stop:capless_strategy", params: { strategyId: "s2" }, affectedStrategies: ["s2"] },
        { code: "economic_no_go:edge_below_variance_floor", params: { strategyId: "s3" }, affectedStrategies: ["s3"] },
      ],
    },
    strategyCapsById: {
      s1: { caps: { perTxUsd: 10, perDayUsd: 20, perChainUsd: { base: 20 }, maxDailyLossUsd: 5 } },
    },
    receiptRecords: [{ strategyId: "s2", amountUsd: 12, realized: { actualKnownCostUsd: 0.1 } }],
    generatedAt: "2026-05-09T00:00:00.000Z",
  });
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].strategyId, "s1");
  assert.equal(report.rows[0].recommendedAction, "declare_cap_in_committed_diff");
  assert.equal(report.rows[1].recommendedAction, "needs_evidence_first");
  assert.equal(report.summary.caplessStrategyCount, 2);
});
