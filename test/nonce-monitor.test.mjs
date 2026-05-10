import assert from "node:assert/strict";
import { test } from "node:test";

import {
  featureEnabled,
  detectNonceGap,
  buildRbfTransaction,
  buildEmptySelfTx,
} from "../src/executor/signer/nonce-monitor.mjs";

test("featureEnabled defaults to true when profile omits nonceMonitor", () => {
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ nonceMonitor: undefined }), true);
});

test("featureEnabled returns false when explicitly disabled", () => {
  assert.equal(featureEnabled({ nonceMonitor: false }), false);
  assert.equal(featureEnabled({ nonceMonitor: { enabled: false } }), false);
});

test("featureEnabled returns true when explicitly enabled", () => {
  assert.equal(featureEnabled({ nonceMonitor: true }), true);
  assert.equal(featureEnabled({ nonceMonitor: { enabled: true } }), true);
});

test("detectNonceGap finds missing nonces between on-chain and pending", () => {
  const result = detectNonceGap({ onChainNonce: 5, pendingNonces: [5, 6, 8] });
  assert.deepEqual(result.gaps, [7]);
  assert.equal(result.needsRepair, true);
});

test("detectNonceGap returns empty when no gaps exist", () => {
  const result = detectNonceGap({ onChainNonce: 5, pendingNonces: [5, 6, 7] });
  assert.deepEqual(result.gaps, []);
  assert.equal(result.needsRepair, false);
});

test("detectNonceGap sorts pending nonces before checking", () => {
  const result = detectNonceGap({ onChainNonce: 2, pendingNonces: [4, 2, 5] });
  assert.deepEqual(result.gaps, [3]);
  assert.equal(result.needsRepair, true);
});

test("detectNonceGap returns empty when pending is empty", () => {
  const result = detectNonceGap({ onChainNonce: 10, pendingNonces: [] });
  assert.deepEqual(result.gaps, []);
  assert.equal(result.needsRepair, false);
});

test("detectNonceGap returns empty gaps when feature is disabled", () => {
  const profile = { nonceMonitor: false };
  const result = detectNonceGap({ onChainNonce: 5, pendingNonces: [5, 6, 8], profile });
  assert.deepEqual(result.gaps, []);
  assert.equal(result.needsRepair, false);
});

test("buildRbfTransaction preserves nonce and bumps gas price", () => {
  const originalTx = {
    to: "0x0000000000000000000000000000000000000001",
    value: 100n,
    gasLimit: 21000n,
    nonce: 7,
    gasPrice: 1_000_000_000n,
    chainId: 8453,
    data: "0x1234",
  };
  const newGasPrice = 2_000_000_000n;
  const rbf = buildRbfTransaction({ originalTx, newGasPrice });

  assert.equal(rbf.nonce, 7);
  assert.equal(rbf.gasPrice, newGasPrice);
  assert.equal(rbf.to, originalTx.to);
  assert.equal(rbf.value, originalTx.value);
  assert.equal(rbf.gasLimit, originalTx.gasLimit);
  assert.equal(rbf.chainId, originalTx.chainId);
  assert.equal(rbf.data, originalTx.data);
});

test("buildRbfTransaction copies eip1559 fees when no legacy gasPrice", () => {
  const originalTx = {
    to: "0x0000000000000000000000000000000000000001",
    value: 0n,
    gasLimit: 21000n,
    nonce: 3,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    chainId: 1,
    data: "0x",
  };
  const newGasPrice = 2_000_000_000n;
  const rbf = buildRbfTransaction({ originalTx, newGasPrice });

  assert.equal(rbf.nonce, 3);
  assert.equal(rbf.maxFeePerGas, newGasPrice);
  assert.equal(rbf.maxPriorityFeePerGas, originalTx.maxPriorityFeePerGas);
});

test("buildEmptySelfTx creates minimal self-send transaction", () => {
  const from = "0x000000000000000000000000000000000000000a";
  const tx = buildEmptySelfTx({
    from,
    nonce: 9,
    gasPrice: 5_000_000_000n,
    chainId: 8453,
  });

  assert.equal(tx.to, from);
  assert.equal(tx.from, from);
  assert.equal(tx.value, 0n);
  assert.equal(tx.data, "0x");
  assert.equal(tx.gasLimit, 21000n);
  assert.equal(tx.nonce, 9);
  assert.equal(tx.gasPrice, 5_000_000_000n);
  assert.equal(tx.chainId, 8453);
});

test("buildEmptySelfTx creates eip1559 variant when maxFeePerGas provided", () => {
  const from = "0x000000000000000000000000000000000000000b";
  const tx = buildEmptySelfTx({
    from,
    nonce: 10,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 50_000_000n,
    chainId: 1,
  });

  assert.equal(tx.to, from);
  assert.equal(tx.value, 0n);
  assert.equal(tx.data, "0x");
  assert.equal(tx.gasLimit, 21000n);
  assert.equal(tx.nonce, 10);
  assert.equal(tx.maxFeePerGas, 1_000_000_000n);
  assert.equal(tx.maxPriorityFeePerGas, 50_000_000n);
  assert.equal(tx.chainId, 1);
  assert.equal(tx.gasPrice, undefined);
});
