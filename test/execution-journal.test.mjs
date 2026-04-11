import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExecutionAttemptEvent,
  buildExecutionReconciliationEvent,
  buildExecutionSubmissionEvent,
  canStartExecution,
  latestExecutionEvent,
} from "../src/execution/journal.mjs";

function jobFixture() {
  return {
    jobId: "job-123",
    chain: "bob",
    type: "refill_native",
    asset: "ETH",
    token: "0x0000000000000000000000000000000000000000",
    targetAmount: "1000",
    targetAmountDecimal: 0.001,
    executionMethod: "same_chain_token_to_native_swap",
    resourceKey: "bob:native",
    requiresManualReview: false,
    constraints: {
      requireEmergencyStopClear: true,
    },
  };
}

test("execution journal blocks duplicate starts without force", () => {
  const planned = buildExecutionAttemptEvent({
    job: jobFixture(),
    guards: { blocked: false, reasons: [], mode: "dry_run" },
    observedAt: "2026-04-11T05:00:00.000Z",
  });
  const gate = canStartExecution([planned], "job-123");

  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "job_already_dry_run_planned");
});

test("execution journal allows force override", () => {
  const submitted = buildExecutionSubmissionEvent({
    job: jobFixture(),
    txHash: "0xabc",
    observedAt: "2026-04-11T05:01:00.000Z",
  });
  const gate = canStartExecution([submitted], "job-123", { force: true });

  assert.equal(gate.ok, true);
  assert.equal(gate.reason, "force_override");
});

test("execution reconciliation maps receipt outcomes into journal statuses", () => {
  const confirmed = buildExecutionReconciliationEvent({
    job: jobFixture(),
    txHash: "0xabc",
    receiptRecord: {
      reconciliationStatus: "reconciled",
      realized: { actualKnownCostUsd: 0.1 },
      flags: { failed: false },
    },
  });
  const failed = buildExecutionReconciliationEvent({
    job: jobFixture(),
    txHash: "0xdef",
    receiptRecord: {
      reconciliationStatus: "failed",
      realized: { actualKnownCostUsd: 0.2 },
      flags: { failed: true },
    },
  });

  assert.equal(confirmed.status, "confirmed");
  assert.equal(failed.status, "failed");
});

test("latest execution event returns the newest event for a job", () => {
  const older = buildExecutionAttemptEvent({
    job: jobFixture(),
    guards: { blocked: false, reasons: [], mode: "dry_run" },
    observedAt: "2026-04-11T05:00:00.000Z",
  });
  const newer = buildExecutionSubmissionEvent({
    job: jobFixture(),
    txHash: "0xabc",
    observedAt: "2026-04-11T05:05:00.000Z",
  });

  assert.equal(latestExecutionEvent([older, newer], "job-123").status, "submitted");
});
