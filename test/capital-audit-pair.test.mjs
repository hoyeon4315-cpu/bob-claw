import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPreTradeSnapshot,
  buildPostBroadcastReconciliation,
  validateCapitalAuditPair,
} from "../src/executor/capital/capital-audit-pair.mjs";

test("buildPreTradeSnapshot returns snapshot with snapshotId and null intentHash", () => {
  const snapshot = buildPreTradeSnapshot({
    strategyId: "test-strategy",
    chain: "base",
    operatingCapitalBtc: 0.5,
    operatingCapitalUsd: 15000,
    perChainInventory: { base: { wbtc: 0.1, usdc: 5000 } },
    protocolLockedNav: { moonwell: 3000 },
  });

  assert.equal(snapshot.strategyId, "test-strategy");
  assert.equal(snapshot.chain, "base");
  assert.equal(snapshot.intentHash, null);
  assert.equal(snapshot.operatingCapitalBtc, 0.5);
  assert.equal(snapshot.operatingCapitalUsd, 15000);
  assert.deepEqual(snapshot.perChainInventory, { base: { wbtc: 0.1, usdc: 5000 } });
  assert.deepEqual(snapshot.protocolLockedNav, { moonwell: 3000 });
  assert.ok(typeof snapshot.snapshotId === "string");
  assert.ok(typeof snapshot.timestamp === "string");
});

test("buildPostBroadcastReconciliation closes pair with intentHash", () => {
  const pre = buildPreTradeSnapshot({
    strategyId: "test-strategy",
    chain: "base",
    operatingCapitalBtc: 0.5,
    operatingCapitalUsd: 15000,
    perChainInventory: {},
    protocolLockedNav: {},
  });

  const post = buildPostBroadcastReconciliation({
    intentHash: "abc123",
    preSnapshot: pre,
    postBroadcastData: {
      operatingCapitalBtc: 0.51,
      operatingCapitalUsd: 15300,
      perChainInventory: { base: { wbtc: 0.11 } },
      protocolLockedNav: { moonwell: 3200 },
    },
    feesUsd: 5,
    slippageBps: 10,
    protocolMarkDelta: 200,
  });

  assert.equal(post.intentHash, "abc123");
  assert.equal(post.preSnapshotId, pre.snapshotId);
  assert.equal(post.feesUsd, 5);
  assert.equal(post.slippageBps, 10);
  assert.equal(post.protocolMarkDelta, 200);
  assert.ok(typeof post.timestamp === "string");
});

test("validateCapitalAuditPair returns ok when deltas match within tolerance", () => {
  const pre = buildPreTradeSnapshot({
    strategyId: "test-strategy",
    chain: "base",
    operatingCapitalBtc: 1.0,
    operatingCapitalUsd: 30000,
    perChainInventory: { base: { wbtc: 1.0 } },
    protocolLockedNav: {},
  });

  const post = buildPostBroadcastReconciliation({
    intentHash: "hash1",
    preSnapshot: pre,
    postBroadcastData: {
      operatingCapitalBtc: 0.999,
      operatingCapitalUsd: 29995,
      perChainInventory: { base: { wbtc: 0.999 } },
      protocolLockedNav: {},
    },
    feesUsd: 5,
    slippageBps: 5,
    protocolMarkDelta: 0,
  });

  const result = validateCapitalAuditPair({ preSnapshot: pre, reconciliation: post });
  assert.equal(result.ok, true);
  assert.equal(result.unmatched, false);
  assert.ok(typeof result.deltaBtc === "number");
  assert.ok(typeof result.deltaUsd === "number");
});

test("validateCapitalAuditPair returns unmatched when delta is too large", () => {
  const pre = buildPreTradeSnapshot({
    strategyId: "test-strategy",
    chain: "base",
    operatingCapitalBtc: 1.0,
    operatingCapitalUsd: 30000,
    perChainInventory: {},
    protocolLockedNav: {},
  });

  const post = buildPostBroadcastReconciliation({
    intentHash: "hash2",
    preSnapshot: pre,
    postBroadcastData: {
      operatingCapitalBtc: 0.5,
      operatingCapitalUsd: 15000,
      perChainInventory: {},
      protocolLockedNav: {},
    },
    feesUsd: 1,
    slippageBps: 1,
    protocolMarkDelta: 0,
  });

  const result = validateCapitalAuditPair({ preSnapshot: pre, reconciliation: post });
  assert.equal(result.ok, false);
  assert.equal(result.unmatched, true);
});

test("validateCapitalAuditPair respects explicit tolerance", () => {
  const pre = buildPreTradeSnapshot({
    strategyId: "test-strategy",
    chain: "base",
    operatingCapitalBtc: 1.0,
    operatingCapitalUsd: 30000,
    perChainInventory: {},
    protocolLockedNav: {},
  });

  const post = buildPostBroadcastReconciliation({
    intentHash: "hash3",
    preSnapshot: pre,
    postBroadcastData: {
      operatingCapitalBtc: 0.98,
      operatingCapitalUsd: 29999,
      perChainInventory: {},
      protocolLockedNav: {},
    },
    feesUsd: 1,
    slippageBps: 1,
    protocolMarkDelta: 0,
  });

  const strict = validateCapitalAuditPair({ preSnapshot: pre, reconciliation: post, toleranceBtc: 0.01 });
  assert.equal(strict.ok, false);

  const loose = validateCapitalAuditPair({ preSnapshot: pre, reconciliation: post, toleranceBtc: 0.05 });
  assert.equal(loose.ok, true);
});
