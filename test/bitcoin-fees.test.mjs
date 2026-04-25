import assert from "node:assert/strict";
import { test } from "node:test";
import { MempoolClient, bitcoinFeeSats, bitcoinFeeUsd, buildBitcoinFeeSnapshot } from "../src/bitcoin/fees.mjs";

test("bitcoin fee model converts sat/vB into sats", () => {
  assert.equal(bitcoinFeeSats({ feeRateSatVb: 4, vbytes: 180 }), 720);
});

test("bitcoin fee model converts sats into USD", () => {
  assert.equal(bitcoinFeeUsd({ feeRateSatVb: 4, vbytes: 180, btcUsd: 72_982 }), 0.5254704);
});

test("bitcoin fee snapshot uses half-hour fee as the conservative selected rate", () => {
  const snapshot = buildBitcoinFeeSnapshot({
    fees: {
      fastestFee: 8,
      halfHourFee: 4,
      hourFee: 3,
      economyFee: 2,
      minimumFee: 1,
    },
    btcUsd: 72_982,
    latencyMs: 123,
    source: "test",
    vbytes: 180,
  });

  assert.equal(snapshot.source, "test");
  assert.equal(snapshot.selectedFeeRateSatVb, 4);
  assert.equal(snapshot.estimatedFeeSats, 720);
  assert.equal(snapshot.estimatedFeeUsd, 0.5254704);
  assert.equal(snapshot.model, "estimated_single_input_single_output");
});

test("mempool client broadcasts raw transactions without rewriting the payload", async () => {
  const calls = [];
  const client = new MempoolClient({
    baseUrl: "https://mempool.test/api",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => "ab".repeat(32),
      };
    },
  });

  const response = await client.broadcastTransaction("0x0011aa");

  assert.equal(response.txHash, "ab".repeat(32));
  assert.equal(response.source, "https://mempool.test/api");
  assert.equal(response.signedTxBytes, 3);
  assert.equal(calls[0].url, "https://mempool.test/api/tx");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, "0011aa");
  assert.equal(calls[0].init.headers["content-type"], "text/plain");
});

test("mempool client rejects invalid btc transaction payloads", async () => {
  const client = new MempoolClient({
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });

  await assert.rejects(() => client.broadcastTransaction("xyz"), /hex string/);
});

test("mempool client reads address transaction history", async () => {
  const client = new MempoolClient({
    baseUrl: "https://mempool.test/api",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [{ txid: "btc123" }],
    }),
  });

  const response = await client.getAddressTransactions("bc1test");

  assert.equal(response.address, "bc1test");
  assert.equal(response.transactions[0].txid, "btc123");
  assert.equal(response.source, "https://mempool.test/api");
});

test("mempool client reads address utxos", async () => {
  const client = new MempoolClient({
    baseUrl: "https://mempool.test/api",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [{ txid: "btc123", value: 1000 }],
    }),
  });

  const response = await client.getAddressUtxos("bc1test");

  assert.equal(response.address, "bc1test");
  assert.equal(response.utxos[0].txid, "btc123");
  assert.equal(response.source, "https://mempool.test/api");
});

test("mempool client reads raw transaction hex", async () => {
  const client = new MempoolClient({
    baseUrl: "https://mempool.test/api",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "0011aa",
    }),
  });

  const response = await client.getTransactionHex("ab".repeat(32));

  assert.equal(response.txid, "ab".repeat(32));
  assert.equal(response.txHex, "0011aa");
  assert.equal(response.source, "https://mempool.test/api");
});
