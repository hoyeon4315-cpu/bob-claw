import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReceiptSeedProof } from "../src/cli/ingest-wrapped-btc-loop-receipt.mjs";

test("buildReceiptSeedProof resets stale receipt metadata when tx hashes are overridden", () => {
  const seed = buildReceiptSeedProof({
    args: {
      entryTxHashes: ["0xentry-a", "0xentry-b"],
      unwindTxHashes: ["0xunwind-a"],
    },
    liveProof: {
      observedAt: "2026-04-19T14:00:00.000Z",
      strategyId: "wrapped-btc-loop-base-moonwell",
      scenarioId: "healthy_baseline",
      success: true,
      proofKind: "signer_backed_roundtrip",
      proofStatus: "signer_backed_roundtrip_recorded",
      entryReceiptMode: "collateral_only_roundtrip",
      mintEventCount: 1,
      borrowEventCount: 0,
      entryTxHashes: ["0xlatest-entry"],
      unwindTxHashes: ["0xlatest-unwind"],
      receiptAutoIngest: {
        ran: true,
        reason: "live_auto_ingest",
      },
    },
  });

  assert.equal(seed.entryReceiptMode, null);
  assert.equal(seed.mintEventCount, null);
  assert.equal(seed.borrowEventCount, null);
  assert.deepEqual(seed.entryTxHashes, ["0xentry-a", "0xentry-b"]);
  assert.deepEqual(seed.unwindTxHashes, ["0xunwind-a"]);
  assert.deepEqual(seed.receiptAutoIngest, {
    ran: false,
    reason: "historical_receipt_reconstruction",
  });
});

test("buildReceiptSeedProof preserves observed receipt metadata when tx hashes are unchanged", () => {
  const liveProof = {
    observedAt: "2026-04-19T14:00:00.000Z",
    strategyId: "wrapped-btc-loop-base-moonwell",
    scenarioId: "healthy_baseline",
    success: true,
    proofKind: "signer_backed_roundtrip",
    proofStatus: "signer_backed_roundtrip_recorded",
    entryReceiptMode: "borrow_loop_observed",
    mintEventCount: 2,
    borrowEventCount: 1,
    entryTxHashes: ["0xentry-a", "0xentry-b"],
    unwindTxHashes: ["0xunwind-a"],
    receiptAutoIngest: {
      ran: true,
      reason: "live_auto_ingest",
    },
  };

  const seed = buildReceiptSeedProof({
    args: {
      entryTxHashes: ["0xentry-a", "0xentry-b"],
      unwindTxHashes: ["0xunwind-a"],
    },
    liveProof,
  });

  assert.equal(seed.entryReceiptMode, "borrow_loop_observed");
  assert.equal(seed.mintEventCount, 2);
  assert.equal(seed.borrowEventCount, 1);
  assert.deepEqual(seed.receiptAutoIngest, {
    ran: true,
    reason: "live_auto_ingest",
  });
});
