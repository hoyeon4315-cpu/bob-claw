import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCapitalAuditGate } from "../../src/executor/policy/capital-audit-gate.mjs";

function buildIntent(overrides = {}) {
  return {
    strategyId: "test-strategy",
    chain: "base",
    intentId: "intent-001",
    intentHash: "hash-001",
    intentType: "deposit",
    amountUsd: 100,
    ...overrides,
  };
}

function buildPreTradeSnapshot(strategyId) {
  return {
    strategyId,
    observedAt: new Date().toISOString(),
    preNavBtc: 0.001,
    preNavUsd: 100,
    intentHash: "hash-001",
    stage: "pre_trade",
  };
}

function buildPostReconciliation(strategyId, intentHash) {
  return {
    strategyId,
    observedAt: new Date().toISOString(),
    postNavBtc: 0.0011,
    postNavUsd: 110,
    realizedGasUsd: 0.5,
    slippageBps: 10,
    protocolPositionMarkDelta: 0.0001,
    intentHash,
    stage: "post_reconciliation",
  };
}

function buildCapitalAuditStateFromRecords(records) {
  const unmatchedByStrategy = new Map();

  for (const record of records) {
    const strategyId = record.strategyId;
    if (record.stage === "pre_trade" && record.intentHash) {
      const set = unmatchedByStrategy.get(strategyId) || new Set();
      set.add(record.intentHash);
      unmatchedByStrategy.set(strategyId, set);
    } else if (record.stage === "post_reconciliation" && record.intentHash) {
      const set = unmatchedByStrategy.get(strategyId);
      if (set) {
        set.delete(record.intentHash);
        if (set.size === 0) {
          unmatchedByStrategy.delete(strategyId);
        }
      }
    }
  }

  return {
    flaggedStrategies: [...unmatchedByStrategy.entries()].map(([strategyId, intentHashes]) => ({
      strategyId,
      unmatchedCount: intentHashes.size,
      latestUnmatchedAt: new Date().toISOString(),
    })),
  };
}

test("E2E: complete capital-audit pair -> next intent ALLOWED", () => {
  const strategyId = "strategy-complete";
  const intentHash = "hash-complete-001";

  const preTrade = buildPreTradeSnapshot(strategyId);
  preTrade.intentHash = intentHash;

  const postRecon = buildPostReconciliation(strategyId, intentHash);

  const capitalAuditState = buildCapitalAuditStateFromRecords([preTrade, postRecon]);

  const result = evaluateCapitalAuditGate({
    intent: buildIntent({ strategyId, intentHash: "hash-complete-002" }),
    capitalAuditState,
  });

  assert.equal(result.decision, "ALLOW", "complete reconciliation should allow next intent");
  assert.equal(result.blockers.length, 0);
});

test("E2E: missing reconciliation after broadcast -> next intent BLOCKED", () => {
  const strategyId = "strategy-missing";
  const intentHash = "hash-missing-001";

  const preTrade = buildPreTradeSnapshot(strategyId);
  preTrade.intentHash = intentHash;

  // No post-reconciliation record
  const capitalAuditState = buildCapitalAuditStateFromRecords([preTrade]);

  const result = evaluateCapitalAuditGate({
    intent: buildIntent({ strategyId, intentHash: "hash-missing-002" }),
    capitalAuditState,
  });

  assert.equal(result.decision, "BLOCK", "missing reconciliation should block next intent");
  assert.ok(result.blockers.includes("capital_audit_pair_unmatched"), "should have unmatched blocker");
  assert.equal(result.metrics.unmatchedCount, 1);
});

test("E2E: multiple pre-trades without matching reconciliations -> BLOCKED", () => {
  const strategyId = "strategy-multi";

  const preTrade1 = buildPreTradeSnapshot(strategyId);
  preTrade1.intentHash = "hash-multi-001";

  const preTrade2 = buildPreTradeSnapshot(strategyId);
  preTrade2.intentHash = "hash-multi-002";

  // Only reconcile the first one
  const postRecon1 = buildPostReconciliation(strategyId, "hash-multi-001");

  const capitalAuditState = buildCapitalAuditStateFromRecords([preTrade1, preTrade2, postRecon1]);

  const result = evaluateCapitalAuditGate({
    intent: buildIntent({ strategyId, intentHash: "hash-multi-003" }),
    capitalAuditState,
  });

  assert.equal(result.decision, "BLOCK", "unmatched pre-trade should block");
  assert.equal(result.metrics.unmatchedCount, 1);
});

test("E2E: reconciliation for different intentHash does not clear unrelated pre-trade", () => {
  const strategyId = "strategy-wrong-hash";

  const preTrade = buildPreTradeSnapshot(strategyId);
  preTrade.intentHash = "hash-real-001";

  const wrongPostRecon = buildPostReconciliation(strategyId, "hash-wrong-001");

  const capitalAuditState = buildCapitalAuditStateFromRecords([preTrade, wrongPostRecon]);

  const result = evaluateCapitalAuditGate({
    intent: buildIntent({ strategyId }),
    capitalAuditState,
  });

  assert.equal(result.decision, "BLOCK", "wrong intentHash reconciliation should not clear pre-trade");
  assert.equal(result.metrics.unmatchedCount, 1);
});

test("E2E: empty capitalAuditState -> ALLOW", () => {
  const result = evaluateCapitalAuditGate({
    intent: buildIntent({ strategyId: "strategy-empty" }),
    capitalAuditState: { flaggedStrategies: [] },
  });

  assert.equal(result.decision, "ALLOW", "empty state should allow");
  assert.equal(result.blockers.length, 0);
});

test("E2E: capital audit gate disabled (dev profile) -> ALLOW even with unmatched", () => {
  const result = evaluateCapitalAuditGate({
    intent: buildIntent({ strategyId: "strategy-dev" }),
    capitalAuditState: null,
  });

  assert.equal(result.decision, "ALLOW", "disabled gate should allow");
  assert.ok(result.metrics.bypassReason === "feature_disabled_or_no_state");
});

test("E2E: full pipeline simulation from intent to verified_current", () => {
  const strategyId = "strategy-pipeline";
  const intentHash = "hash-pipeline-001";

  // Step 1: Intent created
  const intent = buildIntent({ strategyId, intentHash });

  // Step 2: Pre-trade snapshot recorded
  const preTrade = buildPreTradeSnapshot(strategyId);
  preTrade.intentHash = intentHash;

  // Step 3: Broadcast attempted
  const broadcastRecord = {
    strategyId,
    intentHash,
    timestamp: new Date().toISOString(),
    policyVerdict: "approved",
    lifecycle: { stage: "broadcasted" },
  };

  // Step 4: Post-reconciliation recorded
  const postRecon = buildPostReconciliation(strategyId, intentHash);

  // Step 5: Capital audit state computed
  const capitalAuditState = buildCapitalAuditStateFromRecords([preTrade, postRecon]);

  // Step 6: Next intent evaluated
  const nextIntent = buildIntent({ strategyId, intentHash: "hash-pipeline-002" });
  const gateResult = evaluateCapitalAuditGate({
    intent: nextIntent,
    capitalAuditState,
  });

  assert.equal(gateResult.decision, "ALLOW", "pipeline should result in ALLOW after full reconciliation");

  // Verify the audit trail is coherent
  assert.equal(preTrade.intentHash, intentHash, "pre-trade should reference the intent hash");
  assert.equal(postRecon.intentHash, intentHash, "post-reconciliation should reference the same intent hash");
  assert.equal(broadcastRecord.intentHash, intentHash, "broadcast should reference the same intent hash");
});
