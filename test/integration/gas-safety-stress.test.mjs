import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { evaluateStaleQuote } from "../../src/executor/policy/stale-quote.mjs";
import { evaluateGasPriceCeiling } from "../../src/executor/policy/gas-price-ceiling.mjs";
import { evaluatePreBroadcastSimulation } from "../../src/executor/policy/pre-broadcast-simulator.mjs";
import { evaluateConsecutiveFailures } from "../../src/executor/policy/consecutive-failures.mjs";
import { detectNonceGap, buildEmptySelfTx } from "../../src/executor/signer/nonce-monitor.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "gas-stress-test-"));
}

function writeGasHistory(dir, chain, lines) {
  const path = join(dir, `gas-history-${chain}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

function buildIntent(overrides = {}) {
  return {
    strategyId: "test-strategy",
    chain: "base",
    intentId: "intent-001",
    intentHash: "hash-001",
    intentType: "swap",
    amountUsd: 100,
    quote: {
      observedAt: new Date().toISOString(),
      maxAgeMs: 30_000,
    },
    gasPriceGwei: 0.5,
    to: "0x0000000000000000000000000000000000000000",
    data: "0x",
    value: 0,
    from: "0x1111111111111111111111111111111111111111",
    ...overrides,
  };
}

function buildAuditRecord(overrides = {}) {
  return {
    strategyId: "test-strategy",
    chain: "base",
    intentId: "intent-001",
    intentHash: "hash-001",
    timestamp: new Date().toISOString(),
    policyVerdict: "approved",
    lifecycle: { stage: "reverted" },
    ...overrides,
  };
}

test("D1: stale quote + high gas + revert simulation -> BLOCKED by all three", async () => {
  const tmpDir = makeTempDir();
  const now = new Date("2026-05-10T12:00:00.000Z");
  const chain = "base";

  writeGasHistory(tmpDir, chain, [
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

  const staleQuoteAt = new Date(now.getTime() - 120_000).toISOString();
  const intent = buildIntent({
    quote: { observedAt: staleQuoteAt, maxAgeMs: 30_000 },
    gasPriceGwei: 2.0,
  });

  const staleResult = evaluateStaleQuote({ intent, now: now.toISOString() });
  const gasResult = evaluateGasPriceCeiling({ intent, now: now.toISOString(), dataDir: tmpDir });

  const mockProvider = {
    call: async () => {
      const err = new Error("execution reverted");
      err.code = "CALL_EXCEPTION";
      throw err;
    },
  };
  const simResult = await evaluatePreBroadcastSimulation({
    intent,
    provider: mockProvider,
    now: now.toISOString(),
    profile: { preBroadcastSimulationEnabled: true },
    auditPath: join(tmpDir, "pre-broadcast-audit.jsonl"),
  });

  assert.equal(staleResult.decision, "BLOCK", "stale quote should block");
  assert.ok(staleResult.blockers.includes("quote_stale"), "stale quote blocker missing");

  assert.equal(gasResult.decision, "BLOCK", "high gas should block");
  assert.ok(gasResult.blockers.includes("gas_price_above_ceiling"), "gas ceiling blocker missing");

  assert.equal(simResult.decision, "BLOCK", "revert simulation should block");
  assert.ok(simResult.blockers.includes("pre_broadcast_simulation_revert"), "sim revert blocker missing");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("D2: good quote + normal gas + clean simulation -> ALLOW", async () => {
  const tmpDir = makeTempDir();
  const now = new Date("2026-05-10T12:00:00.000Z");
  const chain = "base";

  writeGasHistory(tmpDir, chain, [
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

  const freshQuoteAt = new Date(now.getTime() - 5_000).toISOString();
  const intent = buildIntent({
    quote: { observedAt: freshQuoteAt, maxAgeMs: 30_000 },
    gasPriceGwei: 0.5,
  });

  const staleResult = evaluateStaleQuote({ intent, now: now.toISOString() });
  const gasResult = evaluateGasPriceCeiling({ intent, now: now.toISOString(), dataDir: tmpDir });

  const mockProvider = {
    call: async () => "0x",
  };
  const simResult = await evaluatePreBroadcastSimulation({
    intent,
    provider: mockProvider,
    now: now.toISOString(),
    profile: { preBroadcastSimulationEnabled: true },
    auditPath: join(tmpDir, "pre-broadcast-audit.jsonl"),
  });

  assert.equal(staleResult.decision, "ALLOW", "fresh quote should allow");
  assert.equal(gasResult.decision, "ALLOW", "normal gas should allow");
  assert.equal(simResult.decision, "ALLOW", "clean simulation should allow");

  rmSync(tmpDir, { recursive: true, force: true });
});

test("D3: double-broadcast same intentHash -> second attempt BLOCKED by consecutive-failures (broadcastFailed streak)", () => {
  const intent = buildIntent({ intentHash: "hash-dup-001" });

  const auditRecords = [
    buildAuditRecord({
      intentHash: "hash-dup-001",
      timestamp: "2026-05-10T11:55:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    }),
    buildAuditRecord({
      intentHash: "hash-dup-001",
      timestamp: "2026-05-10T11:56:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "reverted" },
    }),
  ];

  const result = evaluateConsecutiveFailures({
    intent,
    auditRecords,
    maxConsecutiveFailures: 1,
  });

  assert.equal(result.decision, "BLOCK", "second broadcast of same intentHash after revert should block");
  assert.ok(result.blockers.includes("max_consecutive_failures_reached"), "consecutive failures blocker missing");
});

test("D4: intent after 3 consecutive broadcast failures -> BLOCKED by circuit breaker", () => {
  const intent = buildIntent({ intentHash: "hash-cb-001" });

  const auditRecords = [
    buildAuditRecord({
      intentHash: "hash-cb-001-a",
      timestamp: "2026-05-10T11:50:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "reverted" },
    }),
    buildAuditRecord({
      intentHash: "hash-cb-001-b",
      timestamp: "2026-05-10T11:52:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "reverted" },
    }),
    buildAuditRecord({
      intentHash: "hash-cb-001-c",
      timestamp: "2026-05-10T11:54:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "reverted" },
    }),
  ];

  const result = evaluateConsecutiveFailures({
    intent,
    auditRecords,
    maxConsecutiveFailures: 3,
  });

  assert.equal(result.decision, "BLOCK", "3 consecutive failures should block");
  assert.ok(result.blockers.includes("max_consecutive_failures_reached"), "circuit breaker blocker missing");
  assert.equal(result.metrics.consecutiveFailures, 3, "should report 3 consecutive failures");
});

test("D5: nonce gap detected by nonce-monitor when pending nonce skips a value", () => {
  const onChainNonce = 5;
  const pendingNonces = [5, 7, 8];

  const result = detectNonceGap({ onChainNonce, pendingNonces, profile: {} });

  assert.equal(result.needsRepair, true, "should detect repair needed");
  assert.deepEqual(result.gaps, [6], "should find gap at nonce 6");
});

test("D6: no nonce gap when pending nonces are contiguous", () => {
  const onChainNonce = 5;
  const pendingNonces = [5, 6, 7];

  const result = detectNonceGap({ onChainNonce, pendingNonces, profile: {} });

  assert.equal(result.needsRepair, false, "should not need repair");
  assert.deepEqual(result.gaps, [], "should find no gaps");
});

test("D7: empty self-tx fills nonce gap with correct fields", () => {
  const tx = buildEmptySelfTx({
    from: "0x1111111111111111111111111111111111111111",
    nonce: 6,
    gasPrice: 1_000_000_000n,
    chainId: 8453,
  });

  assert.equal(tx.to, "0x1111111111111111111111111111111111111111");
  assert.equal(tx.from, "0x1111111111111111111111111111111111111111");
  assert.equal(tx.value, 0n);
  assert.equal(tx.data, "0x");
  assert.equal(tx.gasLimit, 21000n);
  assert.equal(tx.nonce, 6);
  assert.equal(tx.chainId, 8453);
  assert.equal(tx.gasPrice, 1_000_000_000n);
});

test("D8: empty self-tx with EIP-1559 fields", () => {
  const tx = buildEmptySelfTx({
    from: "0x1111111111111111111111111111111111111111",
    nonce: 6,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    chainId: 8453,
  });

  assert.equal(tx.maxFeePerGas, 2_000_000_000n);
  assert.equal(tx.maxPriorityFeePerGas, 100_000_000n);
  assert.equal(tx.gasPrice, undefined, "gasPrice should not be set when maxFeePerGas is present");
});

test("D9: gas price ceiling disabled profile -> always ALLOW", () => {
  const intent = buildIntent({ gasPriceGwei: 999 });
  const result = evaluateGasPriceCeiling({
    intent,
    profile: { gasPriceCeiling: false },
  });

  assert.equal(result.decision, "ALLOW", "disabled ceiling should always allow");
  assert.equal(result.metrics.enabled, false);
});

test("D10: pre-broadcast simulation disabled profile -> always ALLOW", async () => {
  const intent = buildIntent();
  const result = await evaluatePreBroadcastSimulation({
    intent,
    profile: { preBroadcastSimulationEnabled: false },
  });

  assert.equal(result.decision, "ALLOW", "disabled simulation should always allow");
  assert.equal(result.metrics.simulated, false);
});

test("D11: stale quote with exactly at boundary age -> BLOCK", () => {
  const now = new Date("2026-05-10T12:00:00.000Z");
  const quoteAt = new Date(now.getTime() - 30_001).toISOString();
  const intent = buildIntent({ quote: { observedAt: quoteAt, maxAgeMs: 30_000 } });

  const result = evaluateStaleQuote({ intent, now: now.toISOString() });

  assert.equal(result.decision, "BLOCK", "quote 1ms over boundary should block");
  assert.ok(result.blockers.includes("quote_stale"));
});

test("D12: consecutive failures reset by successful broadcast", () => {
  const intent = buildIntent({ intentHash: "hash-reset-001" });

  const auditRecords = [
    buildAuditRecord({
      intentHash: "hash-reset-001-a",
      timestamp: "2026-05-10T11:50:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "reverted" },
    }),
    buildAuditRecord({
      intentHash: "hash-reset-001-b",
      timestamp: "2026-05-10T11:52:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "reverted" },
    }),
    buildAuditRecord({
      intentHash: "hash-reset-001-c",
      timestamp: "2026-05-10T11:54:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "broadcasted" },
    }),
  ];

  const result = evaluateConsecutiveFailures({
    intent,
    auditRecords,
    maxConsecutiveFailures: 2,
  });

  assert.equal(result.decision, "ALLOW", "successful broadcast should reset failure streak");
  assert.equal(result.metrics.consecutiveFailures, 0, "streak should be reset to 0");
});

test("D13: nonce monitor disabled profile -> no gap detection", () => {
  const result = detectNonceGap({
    onChainNonce: 5,
    pendingNonces: [5, 7],
    profile: { nonceMonitor: false },
  });

  assert.equal(result.needsRepair, false);
  assert.deepEqual(result.gaps, []);
});

test("D14: gas price ceiling with empty history -> ALLOW", () => {
  const tmpDir = makeTempDir();
  const intent = buildIntent({ gasPriceGwei: 100 });

  const result = evaluateGasPriceCeiling({
    intent,
    dataDir: tmpDir,
  });

  assert.equal(result.decision, "ALLOW", "empty history should allow");
  assert.equal(result.metrics.historyEntriesCount, 0);

  rmSync(tmpDir, { recursive: true, force: true });
});
