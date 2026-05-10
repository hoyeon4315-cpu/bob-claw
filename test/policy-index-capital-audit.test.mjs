import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";

test("evaluateIntentPolicies includes capital_audit BLOCK when capitalAuditState flags strategy", async () => {
  const result = await evaluateIntentPolicies({
    intent: {
      strategyId: "gateway-btc-funding-transfer",
      chain: "base",
      amountUsd: 10,
      intentType: "funding_transfer",
    },
    capitalAuditState: {
      flaggedStrategies: [
        { strategyId: "gateway-btc-funding-transfer", unmatchedCount: 1, latestUnmatchedAt: "2026-05-01T00:00:00.000Z" },
      ],
    },
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.ok(result.blockers.includes("capital_audit_pair_unmatched"));
  assert.equal(result.decision, "BLOCK");

  const capitalAuditResult = result.results.find((r) => r.policy === "capital_audit");
  assert.ok(capitalAuditResult);
  assert.equal(capitalAuditResult.decision, "BLOCK");
});

test("evaluateIntentPolicies ALLOWs when capitalAuditState is clean", async () => {
  const result = await evaluateIntentPolicies({
    intent: {
      strategyId: "gateway-btc-funding-transfer",
      chain: "base",
      amountUsd: 10,
      intentType: "funding_transfer",
    },
    capitalAuditState: {
      flaggedStrategies: [],
    },
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.ok(!result.blockers.includes("capital_audit_pair_unmatched"));

  const capitalAuditResult = result.results.find((r) => r.policy === "capital_audit");
  assert.ok(capitalAuditResult);
  assert.equal(capitalAuditResult.decision, "ALLOW");
});
