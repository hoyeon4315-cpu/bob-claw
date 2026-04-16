import { readFile } from "node:fs/promises";
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { MEMPOOL_API_BASE, MempoolClient } from "../../bitcoin/fees.mjs";
import { getBitcoinChainConfig } from "../../config/chains.mjs";
import { createSignedTransactionEnvelope, SignerInterface } from "./signer-interface.mjs";

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);

const BITCOIN_NETWORKS = Object.freeze({
  bitcoin: bitcoin.networks.bitcoin,
  testnet: bitcoin.networks.testnet,
});

function estimateTxVbytes({ inputCount, outputCount }) {
  return 10 + inputCount * 68 + outputCount * 31;
}

function feeForSelection({ inputCount, outputCount, feeRateSatVb }) {
  return Math.ceil(estimateTxVbytes({ inputCount, outputCount }) * feeRateSatVb);
}

async function readSigningKey(path) {
  if (!path) {
    throw new Error("BURNER_BTC_KEY_PATH is required");
  }
  const raw = (await readFile(path, "utf8")).trim();
  if (!raw) {
    throw new Error(`Empty BTC key file: ${path}`);
  }
  return raw;
}

function isHexPrivateKey(value) {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  return /^[0-9a-fA-F]{64}$/.test(normalized);
}

function networkForChain(chain = "bitcoin") {
  const config = getBitcoinChainConfig(chain);
  if (!config) throw new Error(`Unsupported BTC chain: ${chain}`);
  return BITCOIN_NETWORKS[config.network];
}

function defaultMempoolBaseUrl(env, key, fallbackKey = null) {
  return env[key] || (fallbackKey ? env[fallbackKey] : null) || MEMPOOL_API_BASE;
}

function keyPairFromSecret(secret, network) {
  if (isHexPrivateKey(secret)) {
    const hex = secret.startsWith("0x") ? secret.slice(2) : secret;
    return ECPair.fromPrivateKey(Buffer.from(hex, "hex"), { compressed: true, network });
  }
  return ECPair.fromWIF(secret, network);
}

function paymentForKeyPair(keyPair, network) {
  return bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network,
  });
}

function parsePsbt(psbtPayload, network) {
  const raw = String(psbtPayload || "").trim();
  if (!raw) {
    throw new Error("BTC PSBT payload is required");
  }
  try {
    return bitcoin.Psbt.fromBase64(raw, { network });
  } catch (base64Error) {
    try {
      return bitcoin.Psbt.fromHex(raw, { network });
    } catch {
      throw new Error(`Invalid BTC PSBT payload: ${base64Error.message}`);
    }
  }
}

function psbtMetadata(psbt, transaction) {
  let inputValueSats = 0;
  for (const input of psbt.data.inputs || []) {
    const witnessValue = input?.witnessUtxo?.value;
    if (witnessValue !== undefined) {
      inputValueSats += Number(witnessValue);
    }
  }
  const outputValueSats = transaction.outs.reduce((sum, output) => sum + Number(output.value || 0), 0);
  const feeSats = inputValueSats > 0 ? inputValueSats - outputValueSats : null;
  return {
    feeSats,
    inputCount: transaction.ins.length,
    outputCount: transaction.outs.length,
    psbtProvided: true,
    signingSource: "gateway_psbt",
  };
}

function selectUtxos({ utxos = [], targetValueSats, feeRateSatVb, dustThresholdSats }) {
  const ordered = [...utxos].sort((left, right) => (right.confirmations || 0) - (left.confirmations || 0) || right.valueSats - left.valueSats);
  const selected = [];
  let totalInputSats = 0;

  for (const utxo of ordered) {
    selected.push(utxo);
    totalInputSats += Number(utxo.valueSats);
    const provisionalFee = feeForSelection({
      inputCount: selected.length,
      outputCount: 2,
      feeRateSatVb,
    });
    if (totalInputSats >= targetValueSats + provisionalFee) {
      const changeSats = totalInputSats - targetValueSats - provisionalFee;
      if (changeSats > dustThresholdSats) {
        return {
          selected,
          feeSats: provisionalFee,
          changeSats,
        };
      }
      const noChangeFee = feeForSelection({
        inputCount: selected.length,
        outputCount: 1,
        feeRateSatVb,
      });
      if (totalInputSats >= targetValueSats + noChangeFee) {
        return {
          selected,
          feeSats: noChangeFee,
          changeSats: 0,
        };
      }
    }
  }

  throw new Error("Insufficient BTC UTXOs for requested transaction");
}

function normalizeTxHash(txHash) {
  const normalized = String(txHash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export class BtcLocalKeySigner extends SignerInterface {
  constructor({
    env = process.env,
    keyReader = readSigningKey,
    feeClient = null,
    broadcastClient = null,
    broadcastImpl = null,
  } = {}) {
    super();
    this.env = env;
    this.keyReader = keyReader;
    this.feeClient = feeClient || new MempoolClient({ baseUrl: defaultMempoolBaseUrl(env, "BOB_CLAW_BTC_MEMPOOL_BASE_URL") });
    this.broadcastClient =
      broadcastClient ||
      feeClient ||
      new MempoolClient({ baseUrl: defaultMempoolBaseUrl(env, "BOB_CLAW_BTC_BROADCAST_BASE_URL", "BOB_CLAW_BTC_MEMPOOL_BASE_URL") });
    this.broadcastImpl = broadcastImpl;
    this.secretPromise = null;
    this.keyPairs = new Map();
  }

  async secret() {
    if (!this.secretPromise) {
      this.secretPromise = this.keyReader(this.env.BURNER_BTC_KEY_PATH || null);
    }
    return this.secretPromise;
  }

  async keyPair(chain = "bitcoin") {
    if (!this.keyPairs.has(chain)) {
      const network = networkForChain(chain);
      this.keyPairs.set(chain, keyPairFromSecret(await this.secret(), network));
    }
    return this.keyPairs.get(chain);
  }

  async getAddress(chain = "bitcoin") {
    const network = networkForChain(chain);
    const payment = paymentForKeyPair(await this.keyPair(chain), network);
    return payment.address;
  }

  async feeRateSatVb(intent) {
    if (Number.isFinite(intent.btc?.feeRateSatVb)) return Number(intent.btc.feeRateSatVb);
    const response = await this.feeClient.getRecommendedFees();
    return Number(response.body.halfHourFee ?? response.body.fastestFee ?? response.body.hourFee);
  }

  async signPsbtIntent(intent) {
    const chain = intent.chain || "bitcoin";
    const network = networkForChain(chain);
    const keyPair = await this.keyPair(chain);
    const psbt = parsePsbt(intent.btc?.psbtHex, network);
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();
    const transaction = psbt.extractTransaction();
    return createSignedTransactionEnvelope({
      intent,
      signedTx: transaction.toHex(),
      txHash: transaction.getId(),
      chain,
      signerFamily: "btc",
      metadata: {
        ...psbtMetadata(psbt, transaction),
        orderId: intent.btc?.orderId || null,
        depositAddress: intent.btc?.depositAddress || null,
      },
    });
  }

  async signIntent(intent) {
    if (intent.btc?.psbtHex) {
      return this.signPsbtIntent(intent);
    }
    const chain = intent.chain || "bitcoin";
    const config = getBitcoinChainConfig(chain);
    const network = networkForChain(chain);
    const keyPair = await this.keyPair(chain);
    const changeAddress = intent.btc?.changeAddress || (await this.getAddress(chain));
    const outputs = intent.btc?.outputs || [];
    const targetValueSats = outputs.reduce((sum, item) => sum + Number(item.valueSats || 0), 0);
    const feeRateSatVb = await this.feeRateSatVb(intent);
    const selection = selectUtxos({
      utxos: intent.btc?.utxos || [],
      targetValueSats,
      feeRateSatVb,
      dustThresholdSats: config.dustThresholdSats,
    });

    const psbt = new bitcoin.Psbt({ network });
    for (const utxo of selection.selected) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: intent.btc?.enableRbf === false ? undefined : config.replaceByFeeSequence,
        witnessUtxo: {
          script: Buffer.from(utxo.scriptPubKey, "hex"),
          value: BigInt(utxo.valueSats),
        },
      });
    }
    for (const output of outputs) {
      psbt.addOutput({
        address: output.address,
        value: BigInt(output.valueSats),
      });
    }
    if (selection.changeSats > 0) {
      psbt.addOutput({
        address: changeAddress,
        value: BigInt(selection.changeSats),
      });
    }

    for (let index = 0; index < selection.selected.length; index += 1) {
      psbt.signInput(index, keyPair);
    }
    psbt.finalizeAllInputs();
    const transaction = psbt.extractTransaction();
    const txHex = transaction.toHex();

    return createSignedTransactionEnvelope({
      intent,
      signedTx: txHex,
      txHash: transaction.getId(),
      chain,
      signerFamily: "btc",
      metadata: {
        changeSats: selection.changeSats,
        feeRateSatVb,
        feeSats: selection.feeSats,
        inputCount: selection.selected.length,
        outputCount: outputs.length + (selection.changeSats > 0 ? 1 : 0),
        rbfEnabled: intent.btc?.enableRbf !== false,
        replaceByFeeSequence: intent.btc?.enableRbf === false ? null : config.replaceByFeeSequence,
      },
    });
  }

  async broadcastSignedIntent(signedEnvelope) {
    if (typeof this.broadcastImpl !== "function" && typeof this.broadcastClient?.broadcastTransaction !== "function") {
      throw new Error("BTC broadcast client is not configured");
    }
    const rawBroadcast =
      typeof this.broadcastImpl === "function"
        ? await this.broadcastImpl(signedEnvelope)
        : await this.broadcastClient.broadcastTransaction(signedEnvelope.signedTx);
    const txHash = normalizeTxHash(
      typeof rawBroadcast === "string" ? rawBroadcast : rawBroadcast?.txHash || rawBroadcast?.body,
    );
    if (!txHash) {
      throw new Error("BTC broadcast did not return a valid tx hash");
    }
    const expectedTxHash = normalizeTxHash(signedEnvelope.txHash);
    if (expectedTxHash && txHash !== expectedTxHash) {
      throw new Error(`BTC broadcast hash mismatch: expected ${expectedTxHash}, got ${txHash}`);
    }
    if (rawBroadcast && typeof rawBroadcast === "object") {
      return {
        ...rawBroadcast,
        txHash,
      };
    }
    return { txHash };
  }
}

export function createBtcLocalKeySigner(options = {}) {
  return new BtcLocalKeySigner(options);
}
