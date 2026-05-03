import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { indexNftPositions, POSITION_MANAGER_REGISTRY } from "../src/treasury/nft-position-indexer.mjs";
import { runLoop, LOOP_LIMITS } from "../src/cli/auto-research-loop.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "phase16-")); }

// --- nft-position-indexer ---
test("POSITION_MANAGER_REGISTRY exposes ethereum + base + base aerodromeCl", () => {
  assert.ok(POSITION_MANAGER_REGISTRY.ethereum.uniswapV3);
  assert.ok(POSITION_MANAGER_REGISTRY.base.aerodromeCl);
});

test("indexNftPositions writes cache and aggregates per-chain", async () => {
  const dir = tmp();
  try {
    const cachePath = join(dir, "nft.json");
    let calls = 0;
    const r = await indexNftPositions({
      walletAddress: "0xWallet",
      registry: { base: { uniswapV3: "0xPM" } },
      cachePath,
      indexerFn: async ({ chain, address, contract }) => {
        calls++;
        return [{ tokenId: "100", chain, contract }];
      },
    });
    assert.equal(r.fromCache, false);
    assert.equal(r.positions.base.positions.length, 1);
    assert.ok(existsSync(cachePath));
    assert.equal(calls, 1);
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    assert.ok(cache.perWallet["0xWallet"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("indexNftPositions hits cache within 24h", async () => {
  const dir = tmp();
  try {
    const cachePath = join(dir, "nft.json");
    let calls = 0;
    const indexerFn = async () => { calls++; return []; };
    await indexNftPositions({ walletAddress: "0xW", registry: { base: { uniswapV3: "0x" } }, cachePath, indexerFn });
    const second = await indexNftPositions({ walletAddress: "0xW", registry: { base: { uniswapV3: "0x" } }, cachePath, indexerFn });
    assert.equal(second.fromCache, true);
    assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("indexNftPositions surfaces per-protocol errors instead of throwing", async () => {
  const dir = tmp();
  try {
    const r = await indexNftPositions({
      walletAddress: "0xW",
      registry: { base: { brokenProto: "0xX" } },
      cachePath: join(dir, "c.json"),
      indexerFn: async () => { throw new Error("rpc_dead"); },
    });
    assert.equal(r.positions.base.errors[0].error, "rpc_dead");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- auto-research-loop ---
test("LOOP_LIMITS matches the locked decisions", () => {
  assert.equal(LOOP_LIMITS.iterationCap, 20);
  assert.equal(LOOP_LIMITS.wallclockCapMs, 2 * 60 * 60 * 1000);
  assert.equal(LOOP_LIMITS.costCapUsd, 2.0);
  assert.equal(LOOP_LIMITS.sameFailureCap, 3);
  assert.equal(LOOP_LIMITS.maxFiles, 15);
  assert.equal(LOOP_LIMITS.maxDiffLines, 400);
});

test("runLoop returns ok when scorer passes", async () => {
  const dir = tmp();
  try {
    const r = await runLoop({
      iterate: async () => ({ costUsd: 0.1, files: [] }),
      scorer: async () => ({ passed: true, blockers: [] }),
      auditPath: join(dir, "audit.jsonl"),
    });
    assert.equal(r.ok, true);
    assert.equal(r.iteration, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runLoop aborts on same_failure_cap", async () => {
  const dir = tmp();
  try {
    const r = await runLoop({
      iterate: async () => ({ costUsd: 0.01 }),
      scorer: async () => ({ passed: false, blockers: ["x"] }),
      auditPath: join(dir, "audit.jsonl"),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "same_failure_cap");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runLoop aborts on cost_cap", async () => {
  const dir = tmp();
  try {
    const r = await runLoop({
      iterate: async () => ({ costUsd: 5 }),
      scorer: async () => ({ passed: false, blockers: ["y"] }),
      auditPath: join(dir, "audit.jsonl"),
    });
    assert.equal(r.ok, false);
    assert.ok(r.reason === "cost_cap" || r.reason === "same_failure_cap");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runLoop rejects too-many-files iteration without scoring", async () => {
  const dir = tmp();
  try {
    const r = await runLoop({
      iterate: async () => ({ costUsd: 0, files: new Array(20).fill({ path: "a" }) }),
      scorer: async () => ({ passed: true, blockers: [] }),
      auditPath: join(dir, "audit.jsonl"),
      limits: { ...LOOP_LIMITS, iterationCap: 1 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "iteration_cap");
    assert.equal(r.history[0].reason, "max_files_exceeded");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
