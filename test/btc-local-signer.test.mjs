import assert from "node:assert/strict";
import { test } from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import { createBtcLocalKeySigner } from "../src/executor/signer/btc-local-signer.mjs";

const TEST_BTC_SECRET = "11".repeat(32);

async function buildSigner(overrides = {}) {
  return createBtcLocalKeySigner({
    keyReader: async () => TEST_BTC_SECRET,
    feeClient: {
      getRecommendedFees: async () => ({ body: { halfHourFee: 2 } }),
      broadcastTransaction: async (signedTx) => ({
        txHash: bitcoin.Transaction.fromHex(signedTx).getId(),
        source: "https://mempool.test/api",
        signedTxBytes: signedTx.length / 2,
      }),
    },
    ...overrides,
  });
}

async function buildIntent(overrides = {}) {
  const signer = await buildSigner(overrides.signerOptions);
  const address = await signer.getAddress("bitcoin");
  const scriptPubKey = Buffer.from(bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)).toString("hex");
  return {
    signer,
    intent: {
      intentId: "intent-btc-broadcast-test",
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "bitcoin",
      family: "btc",
      intentType: "btc_transfer",
      amountUsd: 1,
      btc: {
        feeRateSatVb: 2,
        outputs: [{ address, valueSats: 20_000 }],
        utxos: [
          {
            txid: "22".repeat(32),
            vout: 0,
            valueSats: 50_000,
            scriptPubKey,
            confirmations: 6,
          },
        ],
        ...(overrides.btc || {}),
      },
    },
  };
}

test("btc signer signs with deterministic fee metadata and default RBF sequence", async () => {
  const { signer, intent } = await buildIntent();
  const signed = await signer.signIntent(intent);
  const transaction = bitcoin.Transaction.fromHex(signed.signedTx);

  assert.equal(transaction.ins[0].sequence, 0xfffffffd);
  assert.equal(signed.metadata.feeRateSatVb, 2);
  assert.equal(signed.metadata.feeSats, 280);
  assert.equal(signed.metadata.changeSats, 29_720);
  assert.equal(signed.metadata.rbfEnabled, true);
  assert.equal(signed.metadata.replaceByFeeSequence, 0xfffffffd);
});

test("btc signer can disable RBF deterministically when the intent requests it", async () => {
  const { signer, intent } = await buildIntent({
    btc: { enableRbf: false },
  });
  const signed = await signer.signIntent(intent);
  const transaction = bitcoin.Transaction.fromHex(signed.signedTx);

  assert.equal(transaction.ins[0].sequence, 0xffffffff);
  assert.equal(signed.metadata.rbfEnabled, false);
  assert.equal(signed.metadata.replaceByFeeSequence, null);
});

test("btc signer broadcasts with the repository mempool client when no override is injected", async () => {
  const seen = [];
  const { signer, intent } = await buildIntent({
    signerOptions: {
      feeClient: {
        getRecommendedFees: async () => ({ body: { halfHourFee: 2 } }),
      },
      broadcastClient: {
        broadcastTransaction: async (signedTx) => {
          seen.push(signedTx);
          return {
            txHash: bitcoin.Transaction.fromHex(signedTx).getId(),
            source: "https://mempool.test/api",
          };
        },
      },
    },
  });
  const signed = await signer.signIntent(intent);
  const broadcast = await signer.broadcastSignedIntent(signed);

  assert.deepEqual(seen, [signed.signedTx]);
  assert.equal(broadcast.txHash, signed.txHash);
  assert.equal(broadcast.source, "https://mempool.test/api");
});

test("btc signer rejects broadcast responses that do not match the signed tx hash", async () => {
  const { signer, intent } = await buildIntent({
    signerOptions: {
      feeClient: {
        getRecommendedFees: async () => ({ body: { halfHourFee: 2 } }),
      },
      broadcastClient: {
        broadcastTransaction: async () => ({
          txHash: "33".repeat(32),
        }),
      },
    },
  });
  const signed = await signer.signIntent(intent);

  await assert.rejects(() => signer.broadcastSignedIntent(signed), /BTC broadcast hash mismatch/);
});

test("btc signer can sign a provided Gateway PSBT payload", async () => {
  const signer = await buildSigner();
  const address = await signer.getAddress("bitcoin");
  const scriptPubKey = Buffer.from(bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)).toString("hex");
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: "44".repeat(32),
    index: 0,
    witnessUtxo: {
      script: Buffer.from(scriptPubKey, "hex"),
      value: BigInt(50_000),
    },
  });
  psbt.addOutput({
    address,
    value: BigInt(20_000),
  });
  const signed = await signer.signIntent({
    intentId: "intent-btc-psbt-test",
    strategyId: "gateway-btc-onramp",
    chain: "bitcoin",
    family: "btc",
    intentType: "gateway_btc_onramp",
    amountUsd: 30,
    btc: {
      psbtHex: psbt.toBase64(),
      orderId: "order-123",
      depositAddress: address,
    },
  });

  const transaction = bitcoin.Transaction.fromHex(signed.signedTx);
  assert.equal(transaction.outs.length, 1);
  assert.equal(signed.metadata.psbtProvided, true);
  assert.equal(signed.metadata.signingSource, "gateway_psbt");
  assert.equal(signed.metadata.orderId, "order-123");
});
