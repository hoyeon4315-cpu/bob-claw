import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { evaluateGasPriceCeiling } from "../../../src/executor/policy/gas-price-ceiling.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "gas-spike-test-"));
}

function writeHistory(dir, chain, lines) {
  const path = join(dir, `gas-history-${chain}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

test("gas price spikes to 3x p90 -> intents deferred -> normalizes -> intents allowed", () => {
  const tmpDir = makeTempDir();
  const chain = "base";
  const now = "2026-05-10T12:00:00.000Z";

  // Baseline history: p90 is 1.0 gwei
  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 0.1 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 0.2 },
    { observedAt: "2026-05-10T09:00:00.000Z", gasPriceGwei: 0.3 },
    { observedAt: "2026-05-10T08:00:00.000Z", gasPriceGwei: 0.4 },
    { observedAt: "2026-05-10T07:00:00.000Z", gasPriceGwei: 0.5 },
    { observedAt: "2026-05-10T06:00:00.000Z", gasPriceGwei: 0.6 },
    { observedAt: "2026-05-10T05:00:00.000Z", gasPriceGwei: 0.7 },
    { observedAt: "2026-05-10T04:00:00.000Z", gasPriceGwei: 0.8 },
    { observedAt: "2026-05-10T03:00:00.000Z", gasPriceGwei: 0.9 },
    { observedAt: "2026-05-10T02:00:00.000Z", gasPriceGwei: 1.0 },
  ]);

  // Phase 1: normal gas -> ALLOW
  const normalIntent = {
    strategyId: "test-strategy",
    chain,
    gasPriceGwei: 0.8,
  };

  const normalResult = evaluateGasPriceCeiling({
    intent: normalIntent,
    now,
    dataDir: tmpDir,
  });

  assert.equal(normalResult.decision, "ALLOW", "normal gas should allow");
  assert.equal(normalResult.metrics.p90GasPriceGwei, 0.9, "p90 of 10 sorted values is index 8 (0.9)");

  // Phase 2: spike to 3x p90 -> BLOCK
  const spikeIntent = {
    strategyId: "test-strategy",
    chain,
    gasPriceGwei: 3.1,
  };

  const spikeResult = evaluateGasPriceCeiling({
    intent: spikeIntent,
    now,
    dataDir: tmpDir,
  });

  assert.equal(spikeResult.decision, "BLOCK", "3x p90 spike should block");
  assert.ok(spikeResult.blockers.includes("gas_price_above_ceiling"), "should have gas_price_above_ceiling blocker");
  assert.equal(spikeResult.metrics.p90GasPriceGwei, 0.9);

  // Phase 3: gas normalizes back to below p90 -> ALLOW
  const normalizedIntent = {
    strategyId: "test-strategy",
    chain,
    gasPriceGwei: 0.85,
  };

  const normalizedResult = evaluateGasPriceCeiling({
    intent: normalizedIntent,
    now,
    dataDir: tmpDir,
  });

  assert.equal(normalizedResult.decision, "ALLOW", "normalized gas should allow again");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("gas exactly at p90 boundary -> ALLOW", () => {
  const tmpDir = makeTempDir();
  const chain = "base";
  const now = "2026-05-10T12:00:00.000Z";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 1.0 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 2.0 },
  ]);

  const intent = {
    strategyId: "test-strategy",
    chain,
    gasPriceGwei: 2.0, // exactly p90
  };

  const result = evaluateGasPriceCeiling({
    intent,
    now,
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "ALLOW", "exactly at p90 should allow");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("gas just above p90 -> BLOCK", () => {
  const tmpDir = makeTempDir();
  const chain = "base";
  const now = "2026-05-10T12:00:00.000Z";

  writeHistory(tmpDir, chain, [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 1.0 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 2.0 },
  ]);

  const intent = {
    strategyId: "test-strategy",
    chain,
    gasPriceGwei: 2.01, // just above p90
  };

  const result = evaluateGasPriceCeiling({
    intent,
    now,
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "BLOCK", "just above p90 should block");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("gas spike on different chain does not affect other chains", () => {
  const tmpDir = makeTempDir();
  const now = "2026-05-10T12:00:00.000Z";

  writeHistory(tmpDir, "base", [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 0.1 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 0.15 },
    { observedAt: "2026-05-10T09:00:00.000Z", gasPriceGwei: 0.2 },
    { observedAt: "2026-05-10T08:00:00.000Z", gasPriceGwei: 0.25 },
    { observedAt: "2026-05-10T07:00:00.000Z", gasPriceGwei: 0.3 },
    { observedAt: "2026-05-10T06:00:00.000Z", gasPriceGwei: 0.35 },
    { observedAt: "2026-05-10T05:00:00.000Z", gasPriceGwei: 0.4 },
    { observedAt: "2026-05-10T04:00:00.000Z", gasPriceGwei: 0.45 },
    { observedAt: "2026-05-10T03:00:00.000Z", gasPriceGwei: 0.5 },
    { observedAt: "2026-05-10T02:00:00.000Z", gasPriceGwei: 0.55 },
  ]);

  writeHistory(tmpDir, "ethereum", [
    { observedAt: "2026-05-10T11:00:00.000Z", gasPriceGwei: 50 },
    { observedAt: "2026-05-10T10:00:00.000Z", gasPriceGwei: 60 },
  ]);

  // Base intent with normal gas should not be affected by Ethereum spike
  const baseIntent = {
    strategyId: "test-strategy",
    chain: "base",
    gasPriceGwei: 0.2,
  };

  const baseResult = evaluateGasPriceCeiling({
    intent: baseIntent,
    now,
    dataDir: tmpDir,
  });

  assert.equal(baseResult.decision, "ALLOW", "base should not be affected by ethereum spike");

  rmSync(tmpDir, { recursive: true, force: true });
});
