import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateChainFailover, featureEnabled, loadChainHealth } from "../src/executor/portfolio-allocator/chain-failover.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ chainFailover: false }), false);
});

test("unhealthy chain rejects candidate due to low gateway success rate", () => {
  const result = evaluateChainFailover({
    candidate: { chain: "base" },
    chainHealth: { base: { gatewaySuccessRate24h: 0.80, rpcErrorRate: 0.05 } },
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers, ["chain_failover_unhealthy"]);
});

test("unhealthy chain rejects candidate due to high rpc error rate", () => {
  const result = evaluateChainFailover({
    candidate: { chain: "base" },
    chainHealth: { base: { gatewaySuccessRate24h: 0.90, rpcErrorRate: 0.15 } },
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers, ["chain_failover_unhealthy"]);
});

test("healthy chain allows candidate", () => {
  const result = evaluateChainFailover({
    candidate: { chain: "base" },
    chainHealth: { base: { gatewaySuccessRate24h: 0.90, rpcErrorRate: 0.05 } },
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockers, []);
});

test("missing chain health allows candidate", () => {
  const result = evaluateChainFailover({
    candidate: { chain: "unknown" },
    chainHealth: { base: { gatewaySuccessRate24h: 0.90, rpcErrorRate: 0.05 } },
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockers, []);
});

test("feature disabled allows candidate regardless of health", () => {
  const result = evaluateChainFailover({
    candidate: { chain: "base", profile: { chainFailover: false } },
    chainHealth: { base: { gatewaySuccessRate24h: 0.80, rpcErrorRate: 0.05 } },
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockers, []);
});

test("loadChainHealth reads from existing status file", () => {
  const dir = mkdtempSync(join(tmpdir(), "chain-failover-test-"));
  const path = join(dir, "health.json");
  writeFileSync(path, JSON.stringify({ chainHealth: { base: { gatewaySuccessRate24h: 0.95, rpcErrorRate: 0.02 } } }));
  const health = loadChainHealth(path);
  assert.deepEqual(health, { base: { gatewaySuccessRate24h: 0.95, rpcErrorRate: 0.02 } });
  rmSync(dir, { recursive: true });
});
