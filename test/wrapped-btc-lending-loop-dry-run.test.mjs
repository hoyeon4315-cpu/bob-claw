import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWrappedBtcLendingLoopScaffold } from "../src/strategy/wrapped-btc-lending-loop-slice.mjs";
import {
  buildWrappedBtcLendingLoopDryRunPacket,
  buildWrappedBtcLendingLoopDryRunReceipt,
  buildWrappedBtcLoopObservedReceipt,
  buildWrappedBtcLoopReceiptGuide,
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
  assert.equal(summary.signerBackedRunCount, 0);
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
  const summary = summarizeWrappedBtcLendingLoopDryRunRuns([receipt]);
  assert.equal(summary.signerBackedRunCount, 1);
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

test("wrapped BTC loop receipt guide narrows command to missing extended fields when live proof exists", () => {
  const guide = buildWrappedBtcLoopReceiptGuide({
    liveProof: {
      scenarioId: "healthy_baseline",
      executionMode: "signer_backed_receipt",
      result: "passed",
      entryTxHashes: ["0xentry"],
      unwindTxHashes: ["0xunwind"],
      actualLoopFeesUsd: 0.02,
      actualUnwindCostUsd: 0.01,
      missingExtendedReceiptFields: [
        "observedHealthFactorPath",
        "observedLiquidationBufferPath",
        "realizedNetCarryUsd",
      ],
    },
  });

  assert.equal(guide.sampleCommand.includes("--entry-tx-hashes="), false);
  assert.equal(guide.sampleCommand.includes("--unwind-tx-hashes="), false);
  assert.equal(guide.sampleCommand.includes("--actual-loop-fees-usd="), false);
  assert.equal(guide.sampleCommand.includes("--actual-unwind-cost-usd="), false);
  assert.equal(guide.sampleCommand.includes("--health-factor-path=<hf-1>,<hf-2>"), true);
  assert.equal(guide.sampleCommand.includes("--liquidation-buffer-path=<buffer-pct-1>,<buffer-pct-2>"), true);
  assert.equal(guide.sampleCommand.includes("--realized-net-carry-usd=<realized-net-carry-usd>"), true);
});
