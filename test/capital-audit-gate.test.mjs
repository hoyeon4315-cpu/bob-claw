import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateCapitalAuditGate,
  featureEnabled,
} from "../src/executor/policy/capital-audit-gate.mjs";

test("evaluateCapitalAuditGate BLOCKs when strategy has unmatched capital-audit pair", () => {
  const result = evaluateCapitalAuditGate({
    intent: { strategyId: "strategy-a", chain: "base" },
    capitalAuditState: {
      flaggedStrategies: [
        { strategyId: "strategy-a", unmatchedCount: 1, latestUnmatchedAt: "2026-05-01T00:00:00.000Z" },
      ],
    },
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(result.policy, "capital_audit");
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("capital_audit_pair_unmatched"));
});

test("evaluateCapitalAuditGate ALLOWs when strategy has no unmatched pairs", () => {
  const result = evaluateCapitalAuditGate({
    intent: { strategyId: "strategy-a", chain: "base" },
    capitalAuditState: {
      flaggedStrategies: [
        { strategyId: "strategy-b", unmatchedCount: 1, latestUnmatchedAt: "2026-05-01T00:00:00.000Z" },
      ],
    },
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
});

test("evaluateCapitalAuditGate ALLOWs when capitalAuditState is empty", () => {
  const result = evaluateCapitalAuditGate({
    intent: { strategyId: "strategy-a", chain: "base" },
    capitalAuditState: { flaggedStrategies: [] },
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(result.decision, "ALLOW");
});

test("evaluateCapitalAuditGate ALLOWs when feature is disabled", () => {
  const result = evaluateCapitalAuditGate({
    intent: { strategyId: "strategy-a", chain: "base" },
    capitalAuditState: null,
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
});

test("featureEnabled returns true for live profile", () => {
  assert.equal(featureEnabled("live"), true);
});

test("featureEnabled returns false for dev profile", () => {
  assert.equal(featureEnabled("dev"), false);
});

test("featureEnabled defaults to true when profile omitted", () => {
  assert.equal(featureEnabled(), true);
});
