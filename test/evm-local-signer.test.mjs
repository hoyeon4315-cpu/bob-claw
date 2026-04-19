import assert from "node:assert/strict";
import { test } from "node:test";

import { EvmLocalKeySigner } from "../src/executor/signer/evm-local-signer.mjs";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function buildProvider({ pendingNonce = 12 } = {}) {
  return {
    getFeeData: async () => ({
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
      gasPrice: null,
    }),
    getTransactionCount: async (_address, blockTag) => {
      assert.equal(blockTag, "pending");
      return pendingNonce;
    },
    broadcastTransaction: async (signedTx) => ({
      hash: "0x" + "a".repeat(64),
      nonce: pendingNonce,
      from: "0x0000000000000000000000000000000000000000",
      to: "0x0000000000000000000000000000000000000001",
      signedTx,
    }),
  };
}

function buildSigner(provider) {
  return new EvmLocalKeySigner({
    keyReader: async () => PRIVATE_KEY,
    providerFactory: () => provider,
  });
}

function intent() {
  return {
    family: "evm",
    chain: "base",
    strategyId: "wrapped-btc-loop-base-moonwell",
    intentType: "wrapped_btc_loop_entry",
    amountUsd: 1,
    mode: "live",
    tx: {
      to: "0x0000000000000000000000000000000000000001",
      data: "0x",
      value: "0",
      gasLimit: "21000",
    },
  };
}

test("evm signer sign-only mode does not consume the sequential nonce manager", async () => {
  const signer = buildSigner(buildProvider({ pendingNonce: 12 }));

  const firstPreview = await signer.signIntent(intent(), { reserveNonce: false });
  const secondPreview = await signer.signIntent(intent(), { reserveNonce: false });
  const firstBroadcastable = await signer.signIntent(intent(), { reserveNonce: true });
  const secondBroadcastable = await signer.signIntent(intent(), { reserveNonce: true });

  assert.equal(firstPreview.metadata.nonce, 12);
  assert.equal(secondPreview.metadata.nonce, 12);
  assert.equal(firstBroadcastable.metadata.nonce, 12);
  assert.equal(secondBroadcastable.metadata.nonce, 13);
});
