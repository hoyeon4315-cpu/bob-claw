import assert from "node:assert/strict";
import { test } from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import {
  createBtcLocalKeySigner,
  deriveBitcoinAddress,
  paymentForKeyPair,
  toXOnlyPublicKey,
} from "../src/executor/signer/btc-local-signer.mjs";

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const TEST_BTC_SECRET = "11".repeat(32);
const TEST_NETWORK = bitcoin.networks.bitcoin;
const REFERENCE_ADDRESSES = Object.freeze({
  p2tr: "bc1p9fjtrm3nwhemkjek0wxtswz2glmneu33w9lcylrvd7alttk0psmq6cnwza",
  p2wpkh: "bc1ql3e9pgs3mmwuwrh95fecme0s0qtn2880lsvsd5",
  "p2sh-p2wpkh": "3PFpzMLrKWsphFtc8BesF3MGPnimKMuF4x",
  p2pkh: "1Q1pE5vPGEEMqRcVRMbtBK842Y6Pzo6nK9",
});

function testKeyPair() {
  return ECPair.fromPrivateKey(Buffer.from(TEST_BTC_SECRET, "hex"), {
    compressed: true,
    network: TEST_NETWORK,
  });
}

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

function fundingTransactionHex(address, valueSats) {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32), 0xffffffff);
  tx.addOutput(bitcoin.address.toOutputScript(address, TEST_NETWORK), BigInt(valueSats));
  return tx.toHex();
}

async function buildIntent({ sourceAddressType = "p2tr", valueSats = 50_000, outputValueSats = 20_000, signerOptions = {}, btc = {} } = {}) {
  const signer = await buildSigner(signerOptions);
  const keyPair = testKeyPair();
  const sourceAddress = deriveBitcoinAddress(keyPair, TEST_NETWORK, sourceAddressType);
  const destinationAddress = await signer.getAddress("bitcoin");
  const sourceScriptPubKey = Buffer.from(bitcoin.address.toOutputScript(sourceAddress, TEST_NETWORK)).toString("hex");
  const previousTxHex = sourceAddressType === "p2pkh" ? fundingTransactionHex(sourceAddress, valueSats) : null;
  const previousTxid = previousTxHex ? bitcoin.Transaction.fromHex(previousTxHex).getId() : "22".repeat(32);
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
        outputs: [{ address: destinationAddress, valueSats: outputValueSats }],
        utxos: [
          {
            txid: previousTxid,
            vout: 0,
            valueSats,
            scriptPubKey: sourceScriptPubKey,
            confirmations: 6,
            rawTxHex: previousTxHex,
          },
        ],
        ...btc,
      },
    },
  };
}

test("btc signer derives known reference vectors for all supported address types", () => {
  const keyPair = testKeyPair();

  assert.equal(deriveBitcoinAddress(keyPair, TEST_NETWORK, "p2tr"), REFERENCE_ADDRESSES.p2tr);
  assert.equal(deriveBitcoinAddress(keyPair, TEST_NETWORK, "p2wpkh"), REFERENCE_ADDRESSES.p2wpkh);
  assert.equal(deriveBitcoinAddress(keyPair, TEST_NETWORK, "p2sh-p2wpkh"), REFERENCE_ADDRESSES["p2sh-p2wpkh"]);
  assert.equal(deriveBitcoinAddress(keyPair, TEST_NETWORK, "p2pkh"), REFERENCE_ADDRESSES.p2pkh);
});

test("btc signer defaults to the Taproot operational address", async () => {
  const signer = await buildSigner();
  const addressInfo = await signer.getAddressInfo("bitcoin");

  assert.equal(addressInfo.addressType, "p2tr");
  assert.equal(addressInfo.address, REFERENCE_ADDRESSES.p2tr);
});

test("btc signer signs Taproot spends with deterministic fee metadata and default RBF sequence", async () => {
  const { signer, intent } = await buildIntent();
  const signed = await signer.signIntent(intent);
  const transaction = bitcoin.Transaction.fromHex(signed.signedTx);

  assert.equal(transaction.ins[0].sequence, 0xfffffffd);
  assert.equal(signed.metadata.addressType, "p2tr");
  assert.equal(signed.metadata.feeRateSatVb, 2);
  assert.equal(signed.metadata.feeSats, 308);
  assert.equal(signed.metadata.changeSats, 29_692);
  assert.equal(signed.metadata.rbfEnabled, true);
  assert.equal(signed.metadata.replaceByFeeSequence, 0xfffffffd);
  assert.deepEqual(signed.metadata.sourceAddressTypes, ["p2tr"]);
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

test("btc signer can sweep legacy source address types into the configured Taproot destination", async (t) => {
  for (const sourceAddressType of ["p2wpkh", "p2sh-p2wpkh", "p2pkh"]) {
    await t.test(sourceAddressType, async () => {
      const { signer, intent } = await buildIntent({ sourceAddressType });
      const signed = await signer.signIntent(intent);

      assert.equal(signed.metadata.addressType, "p2tr");
      assert.deepEqual(signed.metadata.sourceAddressTypes, [sourceAddressType]);
      assert.ok(/^[0-9a-f]+$/i.test(signed.signedTx));
    });
  }
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

test("btc signer can sign a Taproot Gateway PSBT payload", async () => {
  const signer = await buildSigner();
  const keyPair = testKeyPair();
  const address = await signer.getAddress("bitcoin");
  const scriptPubKey = Buffer.from(bitcoin.address.toOutputScript(address, TEST_NETWORK)).toString("hex");
  const psbt = new bitcoin.Psbt({ network: TEST_NETWORK });
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
      tapInternalKey: toXOnlyPublicKey(keyPair.publicKey),
    },
  });

  const transaction = bitcoin.Transaction.fromHex(signed.signedTx);
  assert.equal(transaction.outs.length, 1);
  assert.equal(signed.metadata.psbtProvided, true);
  assert.equal(signed.metadata.signingSource, "gateway_psbt");
  assert.equal(signed.metadata.addressType, "p2tr");
  assert.equal(signed.metadata.orderId, "order-123");
});

test("payment helper preserves script-specific payment outputs", () => {
  const keyPair = testKeyPair();

  assert.equal(paymentForKeyPair(keyPair, TEST_NETWORK, "p2tr").address, REFERENCE_ADDRESSES.p2tr);
  assert.equal(paymentForKeyPair(keyPair, TEST_NETWORK, "p2wpkh").address, REFERENCE_ADDRESSES.p2wpkh);
});
