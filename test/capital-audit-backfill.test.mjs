import assert from "node:assert/strict";
import { test } from "node:test";

import { replayAuditForCapitalGaps } from "../src/executor/capital/audit-replay-startup.mjs";
import { buildCapitalAuditBackfillRecords } from "../src/executor/capital/capital-audit-backfill.mjs";

function auditRecord(overrides = {}) {
  return {
    timestamp: "2026-05-10T00:00:00.000Z",
    strategyId: "lifi-bridge",
    chain: "base",
    intentHash: "intent-1",
    lifecycle: { stage: "broadcasted", txHash: "0xabc" },
    broadcast: { txHash: "0xabc" },
    ...overrides,
  };
}

test("replayAuditForCapitalGaps counts one unmatched gap per intent hash", () => {
  const state = replayAuditForCapitalGaps({
    auditRecords: [
      auditRecord({ timestamp: "2026-05-10T00:00:00.000Z" }),
      auditRecord({ timestamp: "2026-05-10T00:00:01.000Z", lifecycle: { stage: "confirmed", txHash: "0xabc" } }),
    ],
    capitalAuditRecords: [],
  });

  assert.equal(state.flaggedStrategies.length, 1);
  assert.equal(state.flaggedStrategies[0].unmatchedCount, 1);
});

test("backfill records close receipt-backed broadcast gaps", () => {
  const records = buildCapitalAuditBackfillRecords({
    auditRecords: [
      auditRecord({ lifecycle: { stage: "broadcasted", txHash: "0xabc" } }),
      auditRecord({ timestamp: "2026-05-10T00:00:02.000Z", lifecycle: { stage: "confirmed", txHash: "0xabc" } }),
    ],
    receiptRecords: [{
      kind: "lifi_bridge",
      chain: "base",
      txHash: "0xabc",
      reconciliationStatus: "reconciled",
      realized: { actualKnownCostUsd: 0.2 },
    }],
    existingRecords: [],
    now: "2026-05-10T00:01:00.000Z",
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].status, "closed");
  assert.equal(records[0].intentHash, "intent-1");

  const state = replayAuditForCapitalGaps({
    auditRecords: [auditRecord()],
    capitalAuditRecords: records,
  });
  assert.deepEqual(state.flaggedStrategies, []);
});

test("backfill skips pending output receipts", () => {
  const records = buildCapitalAuditBackfillRecords({
    auditRecords: [auditRecord()],
    receiptRecords: [{
      txHash: "0xabc",
      reconciliationStatus: "pending_output",
    }],
    existingRecords: [],
  });

  assert.equal(records.length, 0);
});

test("replay ignores legacy unmatched broadcasts before backfill activation", () => {
  const state = replayAuditForCapitalGaps({
    auditRecords: [
      auditRecord({ timestamp: "2026-05-10T00:00:00.000Z", intentHash: "legacy-unmatched" }),
      auditRecord({ timestamp: "2026-05-10T00:02:00.000Z", intentHash: "future-unmatched" }),
    ],
    capitalAuditRecords: [{
      intentHash: "closed-before",
      strategyId: "lifi-bridge",
      source: "receipt_reconciliation_backfill",
      observedAt: "2026-05-10T00:01:00.000Z",
      status: "closed",
      validation: { ok: true },
    }],
  });

  assert.equal(state.flaggedStrategies.length, 1);
  assert.equal(state.flaggedStrategies[0].unmatchedCount, 1);
});
