import assert from "node:assert/strict";
import test from "node:test";

import { buildSliceDryRunSummary } from "../src/strategy/slice-dryrun-summary-builder.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../src/strategy/wrapped-btc-lending-loop-slice.mjs";

test("buildSliceDryRunSummary reflects signer-audit lifecycle stages and tx hashes", () => {
  const summary = buildSliceDryRunSummary({
    strategyId: "wrapped-btc-loop-base-moonwell",
    existingSummary: {
      runCount: 2,
      passedCount: 2,
      autoUnwindPassCount: 1,
      dryRunReceiptRecorded: true,
    },
    signerAuditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        timestamp: "2026-05-08T00:00:00.000Z",
        lifecycle: { stage: "dry_run_recorded" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        timestamp: "2026-05-08T00:01:00.000Z",
        lifecycle: { stage: "broadcasted", txHash: "0xabc" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        timestamp: "2026-05-08T00:02:00.000Z",
        lifecycle: { stage: "confirmed" },
        broadcast: { txHash: "0xdef" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        timestamp: "2026-05-08T00:03:00.000Z",
        lifecycle: { stage: "error" },
      },
      {
        strategyId: "other",
        timestamp: "2026-05-08T00:04:00.000Z",
        lifecycle: { stage: "confirmed", txHash: "0xignored" },
      },
    ],
  });

  assert.equal(summary.source, "signer_audit_log");
  assert.equal(summary.runCount, 3);
  assert.equal(summary.dryRunReceiptCount, 3);
  assert.equal(summary.signerBackedRunCount, 2);
  assert.equal(summary.passedCount, 2);
  assert.equal(summary.autoUnwindPassCount, 1);
  assert.equal(summary.latestDryRunObservedAt, "2026-05-08T00:02:00.000Z");
  assert.equal(summary.latestRun.txHash, "0xdef");
});

test("buildSliceDryRunSummary preserves existing fixture summary when signer audit has no match", () => {
  const summary = buildSliceDryRunSummary({
    strategyId: "wrapped-btc-loop-base-moonwell",
    existingSummary: {
      runCount: 1,
      passedCount: 1,
      signerBackedRunCount: 0,
      dryRunReceiptRecorded: true,
      latestObservedAt: "2026-05-07T00:00:00.000Z",
    },
    signerAuditRecords: [
      {
        strategyId: "other",
        timestamp: "2026-05-08T00:00:00.000Z",
        lifecycle: { stage: "confirmed", txHash: "0xignored" },
      },
    ],
  });

  assert.equal(summary.source, "fixture_records");
  assert.equal(summary.runCount, 1);
  assert.equal(summary.dryRunReceiptCount, 1);
  assert.equal(summary.signerBackedRunCount, 0);
  assert.equal(summary.latestDryRunObservedAt, "2026-05-07T00:00:00.000Z");
});

test("wrapped BTC slice dryRunSummary can be hydrated from signer audit", () => {
  const scaffold = buildWrappedBtcLendingLoopScaffold({
    signerAuditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        timestamp: "2026-05-08T00:00:00.000Z",
        lifecycle: { stage: "broadcasted", txHash: "0xabc" },
      },
    ],
  });

  assert.equal(scaffold.dryRunSummary.source, "signer_audit_log");
  assert.equal(scaffold.dryRunSummary.dryRunReceiptRecorded, true);
  assert.equal(scaffold.dryRunSummary.dryRunReceiptCount, 1);
  assert.equal(scaffold.dryRunSummary.signerBackedRunCount, 1);
});
