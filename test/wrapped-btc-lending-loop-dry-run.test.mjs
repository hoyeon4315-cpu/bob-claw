import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWrappedBtcLendingLoopScaffold } from "../src/strategy/wrapped-btc-lending-loop-slice.mjs";
import {
  buildWrappedBtcLendingLoopDryRunPacket,
  buildWrappedBtcLendingLoopDryRunReceipt,
  buildWrappedBtcLoopObservedReceipt,
  summarizeWrappedBtcLendingLoopDryRunRuns,
} from "../src/strategy/wrapped-btc-lending-loop-dry-run.mjs";

test("wrapped BTC loop dry-run packet enumerates breach scenarios and receipt requirements", () => {
  const scaffold = buildWrappedBtcLendingLoopScaffold({
    now: "2026-04-15T13:45:00.000Z",
  });
  const packet = buildWrappedBtcLendingLoopDryRunPacket({
    scaffold,
    now: "2026-04-15T13:45:00.000Z",
  });

  assert.equal(packet.readiness.technicalStatus, "dry_run_ready");
  assert.equal(packet.readiness.evidenceStatus, "awaiting_dry_run_receipt");
  assert.equal(packet.watcherScenarios.length, 4);
  assert.equal(packet.watcherScenarios.find((item) => item.id === "health_factor_breach").shouldAutoUnwind, true);
  assert.equal(packet.watcherScenarios.find((item) => item.id === "oracle_drift_pause").watcherStatus, "pause_new_entries");
  assert.equal(packet.receiptTemplate.requiredFields.includes("actualUnwindCostUsd"), true);

  const receipt = buildWrappedBtcLendingLoopDryRunReceipt({
    scaffold,
    packet,
    scenarioId: "health_factor_breach",
    now: "2026-04-15T13:45:00.000Z",
  });
  assert.equal(receipt.result, "passed");
  assert.equal(receipt.watcherStatus, "auto_unwind");
  const summary = summarizeWrappedBtcLendingLoopDryRunRuns([receipt]);
  assert.equal(summary.dryRunReceiptRecorded, true);
  assert.equal(summary.autoUnwindPassCount, 1);
});

test("wrapped BTC loop observed receipt records signer-backed executions distinctly", () => {
  const scaffold = buildWrappedBtcLendingLoopScaffold({
    now: "2026-04-15T13:45:00.000Z",
  });
  const receipt = buildWrappedBtcLoopObservedReceipt({
    scaffold,
    scenarioId: "healthy_baseline",
    executionMode: "signer_backed_receipt",
    result: "passed",
    entryTxHashes: ["0xentry"],
    unwindTxHashes: ["0xunwind"],
    observedHealthFactorPath: [1.65, 1.61],
    observedLiquidationBufferPath: [12, 13],
    actualLoopFeesUsd: 0.84,
    actualUnwindCostUsd: 2.31,
    realizedNetCarryUsd: 8.12,
    now: "2026-04-15T14:00:00.000Z",
  });

  assert.equal(receipt.executionMode, "signer_backed_receipt");
  assert.equal(receipt.result, "passed");
  assert.deepEqual(receipt.entryTxHashes, ["0xentry"]);
  assert.deepEqual(receipt.unwindTxHashes, ["0xunwind"]);
  assert.deepEqual(receipt.observedHealthFactorPath, [1.65, 1.61]);
  assert.deepEqual(receipt.observedLiquidationBufferPath, [12, 13]);
});

test("wrapped BTC loop observed receipt rejects missing required signer-backed receipt fields", () => {
  const scaffold = buildWrappedBtcLendingLoopScaffold({
    now: "2026-04-15T13:45:00.000Z",
  });

  assert.throws(
    () =>
      buildWrappedBtcLoopObservedReceipt({
        scaffold,
        scenarioId: "healthy_baseline",
        executionMode: "signer_backed_receipt",
        result: "passed",
        entryTxHashes: [],
        unwindTxHashes: ["0xunwind"],
        observedHealthFactorPath: [1.65],
        observedLiquidationBufferPath: [12],
        actualLoopFeesUsd: 0.84,
        actualUnwindCostUsd: 2.31,
        realizedNetCarryUsd: 8.12,
        now: "2026-04-15T14:00:00.000Z",
      }),
    /entryTxHashes/,
  );

  assert.throws(
    () =>
      buildWrappedBtcLoopObservedReceipt({
        scaffold,
        scenarioId: "healthy_baseline",
        executionMode: "simulated_dry_run",
        result: "passed",
        entryTxHashes: ["0xentry"],
        unwindTxHashes: ["0xunwind"],
        observedHealthFactorPath: [1.65],
        observedLiquidationBufferPath: [12],
        actualLoopFeesUsd: 0.84,
        actualUnwindCostUsd: 2.31,
        realizedNetCarryUsd: 8.12,
        now: "2026-04-15T14:00:00.000Z",
      }),
    /non-simulated execution mode/,
  );
});
