import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWrappedBtcLoopLiveProof,
  hydrateWrappedBtcLoopLiveProof,
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
      observedHealthFactorPath: [1.51, 1.43],
      observedLiquidationBufferPath: [18.2, 13.6],
      actualLoopFeesUsd: 1.2345678,
      actualUnwindCostUsd: 0.7654321,
      realizedNetCarryUsd: 0,
    },
    now: "2026-04-16T21:37:24.879Z",
  });

  assert.equal(proof.proofStatus, "signer_backed_roundtrip_recorded");
  assert.deepEqual(proof.entryTxHashes, ["0xentry1", "0xentry2"]);
  assert.deepEqual(proof.unwindTxHashes, ["0xunwind1"]);
  assert.deepEqual(proof.observedHealthFactorPath, [1.51, 1.43]);
  assert.deepEqual(proof.observedLiquidationBufferPath, [18.2, 13.6]);
  assert.equal(proof.actualLoopFeesUsd, 1.234568);
  assert.equal(proof.oosReceiptStatus, "ingestable_extended_receipt_context_ready");
  assert.equal(proof.extendedReceiptContextReady, true);

  const summary = summarizeWrappedBtcLoopLiveProof(proof);
  assert.equal(summary.proofRecorded, true);
  assert.equal(summary.entryCount, 2);
  assert.equal(summary.unwindCount, 1);
  assert.equal(summary.extendedReceiptContextReady, true);
});

test("wrapped btc loop live proof hydrates missing fee fields from capital audit and exposes remaining blockers", () => {
  const proof = hydrateWrappedBtcLoopLiveProof({
    proof: {
      schemaVersion: 1,
      observedAt: "2026-04-16T21:37:24.879Z",
      strategyId: "wrapped-btc-loop-base-moonwell",
      scenarioId: "healthy_baseline",
      success: true,
      proofStatus: "signer_backed_roundtrip_recorded",
      entryCount: 2,
      unwindCount: 1,
      entryTxHashes: ["0xentry1", "0xentry2"],
      unwindTxHashes: ["0xunwind1"],
      actualLoopFeesUsd: null,
      actualUnwindCostUsd: null,
      realizedNetCarryUsd: null,
      oosReceiptStatus: "extended_receipt_context_pending",
    },
    capitalAuditReport: {
      transactions: [
        { txHash: "0xentry1", gasUsd: 0.11 },
        { txHash: "0xentry2", gasUsd: 0.22 },
        { txHash: "0xunwind1", gasUsd: 0.33 },
      ],
    },
  });

  assert.equal(proof.actualLoopFeesUsd, 0.33);
  assert.equal(proof.actualUnwindCostUsd, 0.33);
  assert.equal(proof.extendedReceiptContextReady, false);
  assert.deepEqual(proof.missingExtendedReceiptFields, [
    "observedHealthFactorPath",
    "observedLiquidationBufferPath",
    "realizedNetCarryUsd",
  ]);
});
