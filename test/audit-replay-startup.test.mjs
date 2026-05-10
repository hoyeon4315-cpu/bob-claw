import assert from "node:assert/strict";
import { test } from "node:test";
import { replayAuditForCapitalGaps } from "../src/executor/capital/audit-replay-startup.mjs";

test("replayAuditForCapitalGaps flags strategies with unmatched broadcasts", () => {
  const auditRecords = [
    {
      strategyId: "strategy-a",
      chain: "base",
      timestamp: "2026-05-01T00:00:00.000Z",
      intentHash: "hash-a1",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    },
    {
      strategyId: "strategy-b",
      chain: "base",
      timestamp: "2026-05-01T00:00:00.000Z",
      intentHash: "hash-b1",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    },
  ];

  const capitalAuditRecords = [
    {
      strategyId: "strategy-a",
      intentHash: "hash-a1",
      preSnapshotId: "snap-a1",
      timestamp: "2026-05-01T00:01:00.000Z",
    },
  ];

  const result = replayAuditForCapitalGaps({ auditRecords, capitalAuditRecords });
  assert.equal(result.flaggedStrategies.length, 1);
  assert.equal(result.flaggedStrategies[0].strategyId, "strategy-b");
  assert.equal(result.flaggedStrategies[0].unmatchedCount, 1);
});

test("replayAuditForCapitalGaps ignores non-broadcast records", () => {
  const auditRecords = [
    {
      strategyId: "strategy-a",
      chain: "base",
      timestamp: "2026-05-01T00:00:00.000Z",
      intentHash: "hash-a1",
      policyVerdict: "rejected",
      lifecycle: { stage: "rejected" },
    },
  ];

  const result = replayAuditForCapitalGaps({ auditRecords, capitalAuditRecords: [] });
  assert.equal(result.flaggedStrategies.length, 0);
});

test("replayAuditForCapitalGaps counts multiple unmatched per strategy", () => {
  const auditRecords = [
    {
      strategyId: "strategy-a",
      chain: "base",
      timestamp: "2026-05-01T00:00:00.000Z",
      intentHash: "hash-a1",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    },
    {
      strategyId: "strategy-a",
      chain: "base",
      timestamp: "2026-05-01T01:00:00.000Z",
      intentHash: "hash-a2",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    },
  ];

  const result = replayAuditForCapitalGaps({ auditRecords, capitalAuditRecords: [] });
  assert.equal(result.flaggedStrategies.length, 1);
  assert.equal(result.flaggedStrategies[0].unmatchedCount, 2);
  assert.equal(result.flaggedStrategies[0].latestUnmatchedAt, "2026-05-01T01:00:00.000Z");
});

test("replayAuditForCapitalGaps returns empty when all broadcasts matched", () => {
  const auditRecords = [
    {
      strategyId: "strategy-a",
      chain: "base",
      timestamp: "2026-05-01T00:00:00.000Z",
      intentHash: "hash-a1",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    },
  ];

  const capitalAuditRecords = [
    {
      strategyId: "strategy-a",
      intentHash: "hash-a1",
      preSnapshotId: "snap-a1",
      timestamp: "2026-05-01T00:01:00.000Z",
    },
  ];

  const result = replayAuditForCapitalGaps({ auditRecords, capitalAuditRecords });
  assert.equal(result.flaggedStrategies.length, 0);
});

test("replayAuditForCapitalGaps uses latest unmatched timestamp", () => {
  const auditRecords = [
    {
      strategyId: "strategy-a",
      chain: "base",
      timestamp: "2026-05-01T00:00:00.000Z",
      intentHash: "hash-a1",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    },
    {
      strategyId: "strategy-a",
      chain: "base",
      timestamp: "2026-05-01T02:00:00.000Z",
      intentHash: "hash-a2",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    },
  ];

  const capitalAuditRecords = [
    {
      strategyId: "strategy-a",
      intentHash: "hash-a1",
      preSnapshotId: "snap-a1",
      timestamp: "2026-05-01T00:01:00.000Z",
    },
  ];

  const result = replayAuditForCapitalGaps({ auditRecords, capitalAuditRecords });
  assert.equal(result.flaggedStrategies.length, 1);
  assert.equal(result.flaggedStrategies[0].latestUnmatchedAt, "2026-05-01T02:00:00.000Z");
});
