import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectNonceGap,
  buildEmptySelfTx,
  featureEnabled,
} from "../../../src/executor/signer/nonce-monitor.mjs";

test("stuck tx creates nonce gap -> nonce-monitor detects -> empty self-tx fills gap -> pipeline resumes", () => {
  const from = "0x1111111111111111111111111111111111111111";
  const chainId = 8453;

  // Phase 1: on-chain nonce is 5, but pending pool has nonces 5, 7, 8
  // Nonce 6 is missing (stuck tx dropped from mempool)
  const onChainNonce = 5;
  const pendingNonces = [5, 7, 8];

  const gapResult = detectNonceGap({ onChainNonce, pendingNonces, profile: {} });

  assert.equal(gapResult.needsRepair, true, "should detect repair needed");
  assert.deepEqual(gapResult.gaps, [6], "should find gap at nonce 6");

  // Phase 2: build empty self-tx to fill gap at nonce 6
  const fillTx = buildEmptySelfTx({
    from,
    nonce: 6,
    gasPrice: 1_000_000_000n,
    chainId,
  });

  assert.equal(fillTx.to, from, "self-tx sends to self");
  assert.equal(fillTx.from, from);
  assert.equal(fillTx.value, 0n);
  assert.equal(fillTx.nonce, 6, "fills exactly the gap nonce");
  assert.equal(fillTx.chainId, chainId);
  assert.equal(fillTx.gasLimit, 21000n);

  // Phase 3: simulate filling the gap
  const newPendingNonces = [...pendingNonces, 6].sort((a, b) => a - b);
  const postFillResult = detectNonceGap({
    onChainNonce,
    pendingNonces: newPendingNonces,
    profile: {},
  });

  assert.equal(postFillResult.needsRepair, false, "after filling gap, no repair needed");
  assert.deepEqual(postFillResult.gaps, [], "no gaps after fill");
});

test("multiple nonce gaps detected and filled in order", () => {
  const from = "0x1111111111111111111111111111111111111111";
  const onChainNonce = 3;
  const pendingNonces = [3, 5, 8];

  const gapResult = detectNonceGap({ onChainNonce, pendingNonces, profile: {} });

  assert.equal(gapResult.needsRepair, true);
  assert.deepEqual(gapResult.gaps, [4, 6, 7], "should find all missing nonces");

  // Fill gaps in order
  const fillTxs = gapResult.gaps.map((nonce) =>
    buildEmptySelfTx({ from, nonce, gasPrice: 1n, chainId: 1 }),
  );

  assert.equal(fillTxs[0].nonce, 4);
  assert.equal(fillTxs[1].nonce, 6);
  assert.equal(fillTxs[2].nonce, 7);

  // After filling all gaps
  const filledPending = [3, 4, 5, 6, 7, 8];
  const postFill = detectNonceGap({ onChainNonce, pendingNonces: filledPending, profile: {} });
  assert.equal(postFill.needsRepair, false);
});

test("nonce gap at start of pending range", () => {
  const onChainNonce = 5;
  const pendingNonces = [7, 8];

  const gapResult = detectNonceGap({ onChainNonce, pendingNonces, profile: {} });

  assert.equal(gapResult.needsRepair, true);
  assert.deepEqual(gapResult.gaps, [5, 6], "should include onChainNonce if not in pending");
});

test("empty pending nonces -> no gap", () => {
  const gapResult = detectNonceGap({
    onChainNonce: 10,
    pendingNonces: [],
    profile: {},
  });

  assert.equal(gapResult.needsRepair, false);
  assert.deepEqual(gapResult.gaps, []);
});

test("nonce monitor disabled -> no gap detection", () => {
  const gapResult = detectNonceGap({
    onChainNonce: 5,
    pendingNonces: [5, 7],
    profile: { nonceMonitor: false },
  });

  assert.equal(gapResult.needsRepair, false);
  assert.deepEqual(gapResult.gaps, []);
});

test("featureEnabled defaults to true", () => {
  assert.equal(featureEnabled(), true, "should default to enabled");
  assert.equal(featureEnabled({}), true, "should default to enabled with empty profile");
  assert.equal(featureEnabled({ nonceMonitor: true }), true, "should be enabled when explicitly true");
  assert.equal(featureEnabled({ nonceMonitor: false }), false, "should be disabled when explicitly false");
  assert.equal(featureEnabled({ nonceMonitor: { enabled: false } }), false, "should respect nested enabled: false");
  assert.equal(featureEnabled({ nonceMonitor: { enabled: true } }), true, "should respect nested enabled: true");
});
