import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPreliveExecutionAudit } from "../src/prelive/execution-audit.mjs";

test("prelive execution audit reports complete records when plan, submission, receipt, and journal agree", () => {
  const audit = buildPreliveExecutionAudit({
    forkExecutionPlans: [
      { observedAt: "2026-04-12T11:00:00.000Z", planId: "p1", routeLabel: "ethereum->base", amount: "10000", srcChain: "ethereum", status: "planned" },
    ],
    forkExecutionSubmissions: [
      { observedAt: "2026-04-12T11:01:00.000Z", planId: "p1", routeLabel: "ethereum->base", amount: "10000", chain: "ethereum", submissionStatus: "submitted", txHash: "0xabc" },
    ],
    forkExecutionReceipts: [
      { observedAt: "2026-04-12T11:02:00.000Z", planId: "p1", routeLabel: "ethereum->base", amount: "10000", chain: "ethereum", reconciliationStatus: "reconciled", txHash: "0xabc", flags: { failed: false } },
    ],
    executionEvents: [
      { observedAt: "2026-04-12T11:01:00.000Z", jobId: "p1", status: "submitted", executionMethod: "external_signed_raw_tx", txHash: "0xabc" },
      { observedAt: "2026-04-12T11:02:00.000Z", jobId: "p1", status: "confirmed", executionMethod: "external_signed_raw_tx", txHash: "0xabc" },
    ],
  });

  assert.equal(audit.status, "complete");
  assert.equal(audit.missingRecordCount, 0);
  assert.equal(audit.recentTransitions[0].kind, "fork_confirmed");
});

test("prelive execution audit detects missing records and orphan journal events", () => {
  const audit = buildPreliveExecutionAudit({
    forkExecutionPlans: [
      { observedAt: "2026-04-12T11:00:00.000Z", planId: "p1", routeLabel: "ethereum->base", amount: "10000", srcChain: "ethereum", status: "planned" },
    ],
    forkExecutionSubmissions: [
      { observedAt: "2026-04-12T11:01:00.000Z", planId: "p2", routeLabel: "ethereum->unichain", amount: "10000", chain: "ethereum", submissionStatus: "submitted", txHash: "0xdef" },
    ],
    forkExecutionReceipts: [
      { observedAt: "2026-04-12T11:02:00.000Z", planId: "p1", routeLabel: "ethereum->base", amount: "10000", chain: "ethereum", reconciliationStatus: "failed", txHash: "0xabc", flags: { failed: true } },
    ],
    executionEvents: [
      { observedAt: "2026-04-12T11:03:00.000Z", jobId: "unknown-plan", status: "submitted", executionMethod: "external_signed_raw_tx", txHash: "0x999" },
    ],
  });

  assert.equal(audit.status, "missing_records");
  assert.equal(audit.blockers.includes("submission_without_plan"), true);
  assert.equal(audit.blockers.includes("receipt_without_submission"), true);
  assert.equal(audit.blockers.includes("receipt_missing_journal_event"), true);
  assert.equal(audit.blockers.includes("orphan_journal_events"), true);
  assert.equal(audit.missingRecordCount > 0, true);
});
