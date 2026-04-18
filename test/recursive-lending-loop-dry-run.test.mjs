import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRecursiveLendingLoopDryRunPacket,
  buildRecursiveLendingLoopDryRunReceipt,
  buildRecursiveLendingLoopObservedReceipt,
  recursiveLendingLoopDryRunSessionName,
  summarizeRecursiveLendingLoopDryRunRuns,
} from "../src/strategy/recursive-lending-loop-dry-run.mjs";
import {
  buildDefaultRecursiveLendingLoopConfig,
  buildRecursiveLendingLoopScaffold,
} from "../src/strategy/recursive-lending-loop-slice.mjs";

test("recursive wrapped BTC dry-run packet enumerates breach scenarios and receipt requirements", () => {
  const scaffold = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_wrapped_btc_lending_loop",
    strategyConfig: buildDefaultRecursiveLendingLoopConfig("recursive_wrapped_btc_lending_loop"),
    now: "2026-04-17T17:00:00.000Z",
  });
  const packet = buildRecursiveLendingLoopDryRunPacket({
    scaffold,
    now: "2026-04-17T17:00:00.000Z",
  });

  assert.equal(packet.readiness.technicalStatus, "dry_run_ready");
  assert.equal(packet.readiness.evidenceStatus, "awaiting_dry_run_receipt");
  assert.equal(packet.watcherScenarios.length, 4);
  assert.equal(packet.watcherScenarios.find((item) => item.id === "health_factor_breach").shouldAutoUnwind, true);
  assert.equal(packet.watcherScenarios.find((item) => item.id === "oracle_drift_pause").watcherStatus, "pause_new_entries");

  const receipt = buildRecursiveLendingLoopDryRunReceipt({
    scaffold,
    packet,
    scenarioId: "health_factor_breach",
    now: "2026-04-17T17:00:00.000Z",
  });
  assert.equal(receipt.result, "passed");
  assert.equal(receipt.watcherStatus, "auto_unwind");
  const summary = summarizeRecursiveLendingLoopDryRunRuns([receipt]);
  assert.equal(summary.dryRunReceiptRecorded, true);
  assert.equal(summary.autoUnwindPassCount, 1);
  assert.equal(recursiveLendingLoopDryRunSessionName(scaffold.strategy.id), "wrapped-btc-loop-dry-runs");
});

test("recursive stablecoin dry-run packet uses peg drift pause scenario", () => {
  const scaffold = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_stablecoin_lending_loop",
    strategyConfig: buildDefaultRecursiveLendingLoopConfig("recursive_stablecoin_lending_loop"),
    now: "2026-04-17T17:05:00.000Z",
  });
  const packet = buildRecursiveLendingLoopDryRunPacket({
    scaffold,
    now: "2026-04-17T17:05:00.000Z",
  });

  assert.equal(packet.watcherScenarios.find((item) => item.id === "peg_drift_pause").watcherStatus, "pause_new_entries");
  const receipt = buildRecursiveLendingLoopDryRunReceipt({
    scaffold,
    packet,
    scenarioId: "buffer_breach",
    now: "2026-04-17T17:05:00.000Z",
  });
  assert.equal(receipt.watcherStatus, "auto_unwind");
  assert.equal(recursiveLendingLoopDryRunSessionName(scaffold.strategy.id), "stablecoin-lending-loop-dry-runs");
});

test("recursive lending loop observed receipt records signer-backed executions distinctly", () => {
  const scaffold = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_wrapped_btc_lending_loop",
    strategyConfig: buildDefaultRecursiveLendingLoopConfig("recursive_wrapped_btc_lending_loop"),
    now: "2026-04-17T17:10:00.000Z",
  });
  const receipt = buildRecursiveLendingLoopObservedReceipt({
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
    now: "2026-04-17T17:10:00.000Z",
  });

  assert.equal(receipt.executionMode, "signer_backed_receipt");
  assert.equal(receipt.result, "passed");
  assert.deepEqual(receipt.entryTxHashes, ["0xentry"]);
  assert.deepEqual(receipt.unwindTxHashes, ["0xunwind"]);
  assert.deepEqual(receipt.observedHealthFactorPath, [1.65, 1.61]);
  assert.deepEqual(receipt.observedLiquidationBufferPath, [12, 13]);
});

test("recursive lending loop observed receipt rejects missing required fields", () => {
  const scaffold = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_wrapped_btc_lending_loop",
    strategyConfig: buildDefaultRecursiveLendingLoopConfig("recursive_wrapped_btc_lending_loop"),
    now: "2026-04-17T17:15:00.000Z",
  });

  assert.throws(
    () =>
      buildRecursiveLendingLoopObservedReceipt({
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
        now: "2026-04-17T17:15:00.000Z",
      }),
    /entryTxHashes/,
  );

  assert.throws(
    () =>
      buildRecursiveLendingLoopObservedReceipt({
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
        now: "2026-04-17T17:15:00.000Z",
      }),
    /non-simulated execution mode/,
  );
});
