import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { evaluateAutoKillTriggers, evaluateOracleDivergence } from "../../../src/risk/auto-kill-triggers.mjs";
import { runAutoKillCheck } from "../../../src/risk/auto-kill-events.mjs";
import { buildAutoKillConfig } from "../../../src/config/auto-kill.mjs";
import { checkKillSwitch } from "../../../src/executor/policy/kill-switch.mjs";

test("oracle divergence >5% triggers auto-kill and writes kill-switch file", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "oracle-divergence-test-"));
  const killSwitchPath = join(tmpDir, "KILL_SWITCH");

  const config = buildAutoKillConfig({
    oracleDivergence: {
      enabled: true,
      maxDivergencePct: 0.05,
      minSourceCount: 2,
    },
  });

  const oracleSamples = [
    { source: "binance", pair: "BTC/USD", priceUsd: 100_000 },
    { source: "coinbase", pair: "BTC/USD", priceUsd: 106_000 },
  ];

  // Phase 1: pure evaluator detects divergence
  const verdict = evaluateAutoKillTriggers({
    oracleSamples,
    config,
  });

  assert.equal(verdict.triggered, true, "should trigger on >5% divergence");
  assert.equal(verdict.triggers.length, 1);
  assert.equal(verdict.triggers[0].trigger, "oracle_divergence");
  assert.equal(verdict.triggers[0].pair, "BTC/USD");
  assert.ok(Math.abs(verdict.triggers[0].divergence - 0.06) < 1e-12, "divergence should be 6%");

  // Phase 2: runAutoKillCheck writes kill-switch file
  const autoKillResult = await runAutoKillCheck({
    oracleSamples,
    config,
    killSwitchPath,
    rootDir: tmpDir,
  });

  assert.equal(autoKillResult.killSwitchWritten, true, "should write kill-switch file");
  assert.equal(existsSync(killSwitchPath), true, "kill-switch file should exist");

  // Phase 3: policy engine blocks
  const policyResult = await checkKillSwitch({
    killSwitchPath,
    existsImpl: async () => existsSync(killSwitchPath),
  });

  assert.equal(policyResult.decision, "BLOCK", "should block when kill-switch is present");
  assert.ok(policyResult.blockers.includes("kill_switch_present"));

  // Phase 4: operator removes kill-switch after review
  unlinkSync(killSwitchPath);

  const postResolve = await checkKillSwitch({
    killSwitchPath,
    existsImpl: async () => existsSync(killSwitchPath),
  });

  assert.equal(postResolve.decision, "ALLOW", "should allow after kill-switch removed");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("oracle divergence within threshold -> no trigger", () => {
  const config = buildAutoKillConfig({
    oracleDivergence: {
      enabled: true,
      maxDivergencePct: 0.05,
      minSourceCount: 2,
    },
  });

  const oracleSamples = [
    { source: "binance", pair: "BTC/USD", priceUsd: 100_000 },
    { source: "coinbase", pair: "BTC/USD", priceUsd: 102_000 },
  ];

  const verdict = evaluateAutoKillTriggers({
    oracleSamples,
    config,
  });

  assert.equal(verdict.triggered, false, "should not trigger on 2% divergence");
  assert.equal(verdict.triggers.length, 0);
});

test("oracle divergence with only one source -> no trigger (insufficient sources)", () => {
  const config = buildAutoKillConfig({
    oracleDivergence: {
      enabled: true,
      maxDivergencePct: 0.05,
      minSourceCount: 2,
    },
  });

  const oracleSamples = [
    { source: "binance", pair: "BTC/USD", priceUsd: 100_000 },
  ];

  const verdict = evaluateAutoKillTriggers({
    oracleSamples,
    config,
  });

  assert.equal(verdict.triggered, false, "should not trigger with insufficient sources");
});

test("evaluateOracleDivergence evaluates each pair independently", () => {
  const config = buildAutoKillConfig({
    oracleDivergence: {
      enabled: true,
      maxDivergencePct: 0.05,
      minSourceCount: 2,
    },
  });

  const oracleSamples = [
    { source: "binance", pair: "BTC/USD", priceUsd: 100_000 },
    { source: "coinbase", pair: "BTC/USD", priceUsd: 100_100 },
    { source: "binance", pair: "ETH/USD", priceUsd: 5_000 },
    { source: "coinbase", pair: "ETH/USD", priceUsd: 5_500 },
  ];

  const verdict = evaluateAutoKillTriggers({
    oracleSamples,
    config,
  });

  assert.equal(verdict.triggered, true, "should trigger because ETH/USD diverges 10%");
  assert.equal(verdict.triggers[0].pair, "ETH/USD", "should report the diverging pair");
});

test("oracle divergence disabled -> no trigger even with extreme divergence", () => {
  const config = buildAutoKillConfig({
    oracleDivergence: {
      enabled: false,
      maxDivergencePct: 0.05,
      minSourceCount: 2,
    },
  });

  const oracleSamples = [
    { source: "binance", pair: "BTC/USD", priceUsd: 100_000 },
    { source: "coinbase", pair: "BTC/USD", priceUsd: 200_000 },
  ];

  const verdict = evaluateAutoKillTriggers({
    oracleSamples,
    config,
  });

  assert.equal(verdict.triggered, false, "disabled oracle divergence should not trigger");
});

test("runAutoKillCheck does not re-write kill-switch if already armed", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "oracle-divergence-already-armed-"));
  const killSwitchPath = join(tmpDir, "KILL_SWITCH");

  // Pre-create kill-switch
  const { writeFile } = await import("node:fs/promises");
  await writeFile(killSwitchPath, JSON.stringify({ reason: "pre_existing" }), "utf8");

  const config = buildAutoKillConfig({
    oracleDivergence: {
      enabled: true,
      maxDivergencePct: 0.05,
      minSourceCount: 2,
    },
  });

  const oracleSamples = [
    { source: "binance", pair: "BTC/USD", priceUsd: 100_000 },
    { source: "coinbase", pair: "BTC/USD", priceUsd: 106_000 },
  ];

  const result = await runAutoKillCheck({
    oracleSamples,
    config,
    killSwitchPath,
    rootDir: tmpDir,
  });

  assert.equal(result.killSwitchWritten, false, "should not re-write already armed kill-switch");
  assert.equal(result.alreadyArmed, true, "should report already armed");

  rmSync(tmpDir, { recursive: true, force: true });
});
