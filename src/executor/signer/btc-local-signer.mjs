import { readFile } from "node:fs/promises";
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { MEMPOOL_API_BASE, MempoolClient } from "../../bitcoin/fees.mjs";
import { getBitcoinChainConfig } from "../../config/chains.mjs";
import { createSignedTransactionEnvelope, SignerInterface } from "./signer-interface.mjs";

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);

export const SUPPORTED_BITCOIN_ADDRESS_TYPES = Object.freeze([
  "p2tr",
  "p2wpkh",
  "p2sh-p2wpkh",
  "p2pkh",
]);

const INPUT_VBYTES_BY_SCRIPT_TYPE = Object.freeze({
  p2tr: 58,
  p2wpkh: 68,
  p2sh: 91,
  p2pkh: 148,
});

const OUTPUT_VBYTES_BY_SCRIPT_TYPE = Object.freeze({
  p2tr: 43,
  p2wpkh: 31,
  p2sh: 32,
  p2pkh: 34,
});

const BITCOIN_NETWORKS = Object.freeze({
  bitcoin: bitcoin.networks.bitcoin,
  testnet: bitcoin.networks.testnet,
});

export function normalizeBitcoinAddressType(addressType = "p2tr") {
  const normalized = String(addressType || "p2tr").trim().toLowerCase();
  if (!SUPPORTED_BITCOIN_ADDRESS_TYPES.includes(normalized)) {
    throw new Error(`Unsupported BTC address type: ${addressType}`);
  }
  return normalized;
}

function bitcoinChainConfig(chain = "bitcoin") {
  const config = getBitcoinChainConfig(chain);
  if (!config) throw new Error(`Unsupported BTC chain: ${chain}`);
  return config;
}

export function addressTypeForChain(chain = "bitcoin") {
  return normalizeBitcoinAddressType(bitcoinChainConfig(chain).addressType || "p2tr");
}

export function toXOnlyPublicKey(publicKey) {
  const normalized = Buffer.from(publicKey);
  if (normalized.length === 32) {
    return normalized;
  }
  if (normalized.length === 33 && [0x02, 0x03].includes(normalized[0])) {
    return normalized.subarray(1, 33);
  }
  if (normalized.length === 65 && normalized[0] === 0x04) {
    return normalized.subarray(1, 33);
  }
  throw new Error(`Invalid public key length for x-only conversion: ${normalized.length}`);
}

function taprootTweakHash(keyPair, merkleRoot = null) {
  const internalPubkey = toXOnlyPublicKey(keyPair.publicKey);
  return Buffer.from(
    bitcoin.crypto.taggedHash(
      "TapTweak",
      merkleRoot ? Buffer.concat([internalPubkey, Buffer.from(merkleRoot)]) : internalPubkey,
    ),
  );
}

function taprootSignerForKeyPair(keyPair, merkleRoot = null) {
  return keyPair.tweak(taprootTweakHash(keyPair, merkleRoot));
}

export function classifyBitcoinOutputScript(script) {
  const output = Buffer.from(script);
  if (output.length === 34 && output[0] === 0x51 && output[1] === 0x20) return "p2tr";
  if (output.length === 22 && output[0] === 0x00 && output[1] === 0x14) return "p2wpkh";
  if (output.length === 23 && output[0] === 0xa9 && output[1] === 0x14 && output[22] === 0x87) return "p2sh";
  if (
    output.length === 25 &&
    output[0] === 0x76 &&
    output[1] === 0xa9 &&
    output[2] === 0x14 &&
    output[23] === 0x88 &&
    output[24] === 0xac
  ) {
    return "p2pkh";
  }
  return null;
}

function scriptTypeForAddress(address, network) {
  return classifyBitcoinOutputScript(bitcoin.address.toOutputScript(address, network));
}

export function estimateBitcoinTxVbytes({ inputScriptTypes = [], outputScriptTypes = [] }) {
  const inputVbytes = inputScriptTypes.reduce((sum, scriptType) => sum + (INPUT_VBYTES_BY_SCRIPT_TYPE[scriptType] || 68), 0);
  const outputVbytes = outputScriptTypes.reduce((sum, scriptType) => sum + (OUTPUT_VBYTES_BY_SCRIPT_TYPE[scriptType] || 31), 0);
  return 10 + inputVbytes + outputVbytes;
}

function feeForSelection({ utxos = [], outputAddresses = [], feeRateSatVb, changeAddress = null, network }) {
  const inputScriptTypes = utxos.map((utxo) => {
    const scriptType = classifyBitcoinOutputScript(Buffer.from(utxo.scriptPubKey, "hex"));
    if (!scriptType) {
      throw new Error(`Unsupported BTC input script type for utxo ${utxo.txid}:${utxo.vout}`);
    }
    return scriptType;
  });
  const outputScriptTypes = outputAddresses.map((address) => scriptTypeForAddress(address, network)).filter(Boolean);
  if (changeAddress) {
    outputScriptTypes.push(scriptTypeForAddress(changeAddress, network));
  }
  return Math.ceil(estimateBitcoinTxVbytes({ inputScriptTypes, outputScriptTypes }) * feeRateSatVb);
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
  return BITCOIN_NETWORKS[bitcoinChainConfig(chain).network];
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

export function paymentForKeyPair(keyPair, network, addressType = "p2tr") {
  const normalizedType = normalizeBitcoinAddressType(addressType);
  const pubkey = Buffer.from(keyPair.publicKey);
  if (normalizedType === "p2tr") {
    return bitcoin.payments.p2tr({
      internalPubkey: toXOnlyPublicKey(pubkey),
      network,
    });
  }
  if (normalizedType === "p2wpkh") {
    return bitcoin.payments.p2wpkh({
      pubkey,
      network,
    });
  }
  if (normalizedType === "p2sh-p2wpkh") {
    return bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({
        pubkey,
        network,
      }),
      network,
    });
  }
  if (normalizedType === "p2pkh") {
    return bitcoin.payments.p2pkh({
      pubkey,
      network,
    });
  }
  throw new Error(`Unsupported BTC address type: ${addressType}`);
}

export function deriveBitcoinAddress(keyPair, network, addressType = "p2tr") {
  const payment = paymentForKeyPair(keyPair, network, addressType);
  if (!payment.address) {
    throw new Error(`Could not derive BTC address for ${addressType}`);
  }
  return payment.address;
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
  const txInputs = psbt.txInputs || [];
  for (let index = 0; index < (psbt.data.inputs || []).length; index += 1) {
    const input = psbt.data.inputs[index];
    const witnessValue = input?.witnessUtxo?.value;
    if (witnessValue !== undefined) {
      inputValueSats += Number(witnessValue);
      continue;
    }
    const nonWitness = input?.nonWitnessUtxo;
    const prevIndex = txInputs[index]?.index;
    if (nonWitness && Number.isInteger(prevIndex)) {
      const previousTx = bitcoin.Transaction.fromBuffer(Buffer.from(nonWitness));
      const previousOutput = previousTx.outs[prevIndex];
      if (previousOutput) {
        inputValueSats += Number(previousOutput.value || 0);
      }
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

function selectUtxos({ utxos = [], targetValueSats, feeRateSatVb, dustThresholdSats, outputs = [], changeAddress, network }) {
  const ordered = [...utxos].sort((left, right) => (right.confirmations || 0) - (left.confirmations || 0) || right.valueSats - left.valueSats);
  const selected = [];
  let totalInputSats = 0;

  for (const utxo of ordered) {
    selected.push(utxo);
    totalInputSats += Number(utxo.valueSats);
    const provisionalFee = feeForSelection({
      utxos: selected,
      outputAddresses: outputs.map((item) => item.address),
      feeRateSatVb,
      changeAddress,
      network,
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
        utxos: selected,
        outputAddresses: outputs.map((item) => item.address),
        feeRateSatVb,
        network,
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

function addPsbtInputForUtxo(psbt, utxo, { keyPair, network, sequence }) {
  const script = Buffer.from(utxo.scriptPubKey, "hex");
  const scriptType = classifyBitcoinOutputScript(script);
  if (!scriptType) {
    throw new Error(`Unsupported BTC input script type for utxo ${utxo.txid}:${utxo.vout}`);
  }
  const common = {
    hash: utxo.txid,
    index: utxo.vout,
    sequence,
  };
  if (scriptType === "p2tr") {
    psbt.addInput({
      ...common,
      witnessUtxo: {
        script,
        value: BigInt(utxo.valueSats),
      },
      tapInternalKey: toXOnlyPublicKey(keyPair.publicKey),
    });
    return "p2tr";
  }
  if (scriptType === "p2wpkh") {
    psbt.addInput({
      ...common,
      witnessUtxo: {
        script,
        value: BigInt(utxo.valueSats),
      },
    });
    return "p2wpkh";
  }
  if (scriptType === "p2sh") {
    const redeem = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network,
    });
    psbt.addInput({
      ...common,
      witnessUtxo: {
        script,
        value: BigInt(utxo.valueSats),
      },
      redeemScript: redeem.output,
    });
    return "p2sh-p2wpkh";
  }
  if (!utxo.rawTxHex) {
    throw new Error(`rawTxHex is required for legacy p2pkh utxo ${utxo.txid}:${utxo.vout}`);
  }
  psbt.addInput({
    ...common,
    nonWitnessUtxo: Buffer.from(utxo.rawTxHex, "hex"),
  });
  return "p2pkh";
}

function isTaprootPsbtInput(input) {
  if (input?.tapInternalKey) return true;
  const script = input?.witnessUtxo?.script;
  return script ? classifyBitcoinOutputScript(script) === "p2tr" : false;
}

function signPsbtWithKeyPair(psbt, keyPair) {
  for (let index = 0; index < psbt.inputCount; index += 1) {
    const input = psbt.data.inputs[index];
    if (isTaprootPsbtInput(input)) {
      if (!input.tapInternalKey) {
        psbt.updateInput(index, {
          tapInternalKey: toXOnlyPublicKey(keyPair.publicKey),
        });
      }
      psbt.signTaprootInput(index, taprootSignerForKeyPair(keyPair, input.tapMerkleRoot || null));
      continue;
    }
    psbt.signInput(index, keyPair);
  }
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
    return (await this.getAddressInfo(chain)).address;
  }

  async getAddressType(chain = "bitcoin") {
    return addressTypeForChain(chain);
  }

  async getAddressInfo(chain = "bitcoin", addressType = null) {
    const network = networkForChain(chain);
    const normalizedAddressType = normalizeBitcoinAddressType(addressType || addressTypeForChain(chain));
    return {
      chain,
      addressType: normalizedAddressType,
      address: deriveBitcoinAddress(await this.keyPair(chain), network, normalizedAddressType),
    };
  }

  async getDerivedAddresses(chain = "bitcoin") {
    const network = networkForChain(chain);
    const keyPair = await this.keyPair(chain);
    return Object.fromEntries(
      SUPPORTED_BITCOIN_ADDRESS_TYPES.map((addressType) => [
        addressType,
        deriveBitcoinAddress(keyPair, network, addressType),
      ]),
    );
  }

  async feeRateSatVb(intent) {
    if (Number.isFinite(intent.btc?.feeRateSatVb)) return Number(intent.btc.feeRateSatVb);
    const response = await this.feeClient.getRecommendedFees();
    return Number(response.body.halfHourFee ?? response.body.fastestFee ?? response.body.hourFee);
  }

  async signPsbtIntent(intent) {
    const chain = intent.chain || "bitcoin";
    const keyPair = await this.keyPair(chain);
    const psbt = parsePsbt(intent.btc?.psbtHex, networkForChain(chain));
    signPsbtWithKeyPair(psbt, keyPair);
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
        addressType: addressTypeForChain(chain),
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
    const config = bitcoinChainConfig(chain);
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
      outputs,
      changeAddress,
      network,
    });

    const psbt = new bitcoin.Psbt({ network });
    const sourceAddressTypes = new Set();
    for (const utxo of selection.selected) {
      sourceAddressTypes.add(
        addPsbtInputForUtxo(psbt, utxo, {
          keyPair,
          network,
          sequence: intent.btc?.enableRbf === false ? undefined : config.replaceByFeeSequence,
        }),
      );
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

    signPsbtWithKeyPair(psbt, keyPair);
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
        addressType: addressTypeForChain(chain),
        changeAddressType: scriptTypeForAddress(changeAddress, network),
        sourceAddressTypes: [...sourceAddressTypes],
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
