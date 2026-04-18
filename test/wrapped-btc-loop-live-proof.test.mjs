import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWrappedBtcLoopLiveProof,
  summarizeWrappedBtcLoopLiveProof,
} from "../src/strategy/wrapped-btc-loop-live-proof.mjs";

test("wrapped btc loop live proof summarizes successful signer-backed roundtrip", () => {
  const proof = buildWrappedBtcLoopLiveProof({
    result: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      scenarioId: "healthy_baseline",
      perTradeCapUsdOverride: 7,
      marketAssumptionsOverride: { minIncrementUsd: 2 },
      entryResults: [
        { broadcast: { txHash: "0xentry1" } },
        { broadcast: { txHash: "0xentry2" } },
      ],
      unwindResults: [
        { broadcast: { txHash: "0xunwind1" } },
      ],
      receiptAutoIngest: {
        ran: false,
        reason: "no_matching_ingest_command",
      },
      ok: true,
    },
    receiptContext: {
      actualLoopFeesUsd: 1.2345678,
      actualUnwindCostUsd: 0.7654321,
      realizedNetCarryUsd: 0,
    },
    now: "2026-04-16T21:37:24.879Z",
  });

  assert.equal(proof.proofStatus, "signer_backed_roundtrip_recorded");
  assert.deepEqual(proof.entryTxHashes, ["0xentry1", "0xentry2"]);
  assert.deepEqual(proof.unwindTxHashes, ["0xunwind1"]);
  assert.equal(proof.actualLoopFeesUsd, 1.234568);
  assert.equal(proof.oosReceiptStatus, "extended_receipt_context_pending");

  const summary = summarizeWrappedBtcLoopLiveProof(proof);
  assert.equal(summary.proofRecorded, true);
  assert.equal(summary.entryCount, 2);
  assert.equal(summary.unwindCount, 1);
});
