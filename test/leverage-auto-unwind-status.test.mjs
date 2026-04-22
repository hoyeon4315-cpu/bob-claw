import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLeverageAutoUnwindStatus } from "../src/status/leverage-auto-unwind-status.mjs";

function runtimeReportFixture(overrides = {}) {
  return {
    strategy: { id: "wrapped-btc-loop-base-moonwell" },
    runtime: { status: "healthy" },
    ...overrides,
  };
}

function auditRecordFixture(overrides = {}) {
  return {
    strategyId: "wrapped-btc-loop-base-moonwell",
    intent: { intentType: "emergency_unwind" },
    lifecycle: { stage: "signed" },
    ...overrides,
  };
}

test("status reflects auto_unwind_ready from watcher", () => {
  const status = buildLeverageAutoUnwindStatus({
    runtimeReports: [runtimeReportFixture({ runtime: { status: "auto_unwind" } })],
    auditRecords: [],
  });
  assert.equal(status.autoUnwindReadyCount, 1);
  assert.equal(status.submittedCount, 0);
  assert.equal(status.confirmedCount, 0);
  assert.equal(status.failedCount, 0);
});

test("status reflects submitted from audit records", () => {
  const status = buildLeverageAutoUnwindStatus({
    runtimeReports: [],
    auditRecords: [auditRecordFixture({ lifecycle: { stage: "broadcasted" } })],
  });
  assert.equal(status.autoUnwindReadyCount, 0);
  assert.equal(status.submittedCount, 1);
});

test("status reflects confirmed from audit records", () => {
  const status = buildLeverageAutoUnwindStatus({
    runtimeReports: [],
    auditRecords: [auditRecordFixture({ lifecycle: { stage: "confirmed", txHash: "0xabc" } })],
  });
  assert.equal(status.confirmedCount, 1);
  assert.equal(status.items[0].lastTxHash, "0xabc");
});

test("status reflects failed from audit records", () => {
  const status = buildLeverageAutoUnwindStatus({
    runtimeReports: [],
    auditRecords: [auditRecordFixture({ lifecycle: { stage: "reverted" }, error: { message: "out of gas" } })],
  });
  assert.equal(status.failedCount, 1);
  assert.equal(status.items[0].lastError, "out of gas");
});

test("status merges watcher and audit for same strategy", () => {
  const status = buildLeverageAutoUnwindStatus({
    runtimeReports: [runtimeReportFixture({ runtime: { status: "auto_unwind" } })],
    auditRecords: [auditRecordFixture({ lifecycle: { stage: "confirmed", txHash: "0xdef" } })],
  });
  assert.equal(status.autoUnwindReadyCount, 1);
  assert.equal(status.confirmedCount, 1);
  assert.equal(status.items[0].lastTxHash, "0xdef");
});

test("status ignores non-emergency-unwind audit records", () => {
  const status = buildLeverageAutoUnwindStatus({
    runtimeReports: [],
    auditRecords: [auditRecordFixture({ intent: { intentType: "swap" }, lifecycle: { stage: "confirmed" } })],
  });
  assert.equal(status.total, 0);
});
