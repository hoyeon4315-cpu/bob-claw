#!/usr/bin/env node

import * as bitcoin from "bitcoinjs-lib";
import { getBitcoinChainConfig } from "../config/chains.mjs";
import {
  SUPPORTED_BITCOIN_ADDRESS_TYPES,
  classifyBitcoinOutputScript,
  createBtcLocalKeySigner,
  estimateBitcoinTxVbytes,
} from "../executor/signer/btc-local-signer.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    chain: options.chain || "bitcoin",
    destination: options.destination || null,
    feeRateSatVb: options["fee-rate-sat-vb"] ? Number(options["fee-rate-sat-vb"]) : null,
    sourceTypes: options["source-types"]
      ? options["source-types"].split(",").map((item) => item.trim()).filter(Boolean)
      : null,
    execute: flags.has("--execute"),
    json: flags.has("--json"),
  };
}

function normalizeSourceTypes(sourceTypes, activeAddressType) {
  const allowed = SUPPORTED_BITCOIN_ADDRESS_TYPES.filter((addressType) => addressType !== activeAddressType);
  const requested = sourceTypes || allowed;
  for (const addressType of requested) {
    if (!allowed.includes(addressType)) {
      throw new Error(`Unsupported migration source type: ${addressType}`);
    }
  }
  return requested;
}

async function loadSignerControlledUtxos({ signer, chain, addressType, network }) {
  const addressInfo = await signer.getAddressInfo(chain, addressType);
  const utxoResponse = await signer.feeClient.getAddressUtxos(addressInfo.address);
  const confirmedUtxos = utxoResponse.utxos.filter((utxo) => utxo.status?.confirmed);
  const scriptPubKey = Buffer.from(bitcoin.address.toOutputScript(addressInfo.address, network)).toString("hex");
  const utxos = await Promise.all(
    confirmedUtxos.map(async (utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      valueSats: Number(utxo.value),
      scriptPubKey,
      confirmations: 1,
      rawTxHex:
        addressType === "p2pkh"
          ? (await signer.feeClient.getTransactionHex(utxo.txid)).txHex
          : null,
    })),
  );
  const totalSats = utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
  return {
    addressType,
    address: addressInfo.address,
    utxoCount: utxos.length,
    totalSats,
    utxos,
  };
}

function summaryLines(result) {
  return [
    `chain=${result.chain}`,
    `activeAddress=${result.activeAddress.address}`,
    `activeAddressType=${result.activeAddress.addressType}`,
    `destination=${result.destination.address}`,
    `destinationScriptType=${result.destination.scriptType}`,
    `sourceTypes=${result.sourceAddresses.map((item) => item.addressType).join(",") || "none"}`,
    `inputSats=${result.totals.inputSats}`,
    `estimatedFeeSats=${result.totals.estimatedFeeSats}`,
    `outputSats=${result.totals.outputSats}`,
    `planStatus=${result.planStatus}`,
    `blockedReason=${result.blockedReason || "none"}`,
    result.broadcast?.txHash ? `txHash=${result.broadcast.txHash}` : null,
  ].filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chainConfig = getBitcoinChainConfig(args.chain);
  if (!chainConfig) {
    throw new Error(`Unsupported BTC chain: ${args.chain}`);
  }
  const network = bitcoin.networks[chainConfig.network];
  if (!network) {
    throw new Error(`Unsupported BTC network: ${chainConfig.network}`);
  }
  const signer = createBtcLocalKeySigner();
  const activeAddress = await signer.getAddressInfo(args.chain);
  const sourceTypes = normalizeSourceTypes(args.sourceTypes, activeAddress.addressType);
  const sourceAddresses = await Promise.all(
    sourceTypes.map((addressType) => loadSignerControlledUtxos({
      signer,
      chain: args.chain,
      addressType,
      network,
    })),
  );
  const allUtxos = sourceAddresses.flatMap((entry) => entry.utxos);
  const inputSats = allUtxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
  const destinationAddress = args.destination || activeAddress.address;
  const destinationScriptType = classifyBitcoinOutputScript(bitcoin.address.toOutputScript(destinationAddress, network));
  if (!destinationScriptType) {
    throw new Error(`Unsupported destination BTC address: ${destinationAddress}`);
  }
  const feeRateSatVb = Number.isFinite(args.feeRateSatVb)
    ? args.feeRateSatVb
    : await signer.feeRateSatVb({ btc: {} });
  const inputScriptTypes = allUtxos.map((utxo) => classifyBitcoinOutputScript(Buffer.from(utxo.scriptPubKey, "hex")));
  const estimatedFeeSats = Math.ceil(
    estimateBitcoinTxVbytes({
      inputScriptTypes,
      outputScriptTypes: [destinationScriptType],
    }) * feeRateSatVb,
  );
  const outputSats = inputSats - estimatedFeeSats;
  const blockedReason =
    allUtxos.length === 0
      ? "no_confirmed_legacy_utxos"
      : outputSats <= 0
        ? "insufficient_value_after_fee"
        : null;
  const intent = blockedReason
    ? null
    : {
        intentId: `btc-address-migrate:${args.chain}:${Date.now()}`,
        strategyId: "btc-address-migrate",
        chain: args.chain,
        family: "btc",
        intentType: "btc_transfer",
        amountUsd: null,
        mode: "live",
        observedAt: new Date().toISOString(),
        executionReason: "operator_migration",
        metadata: {
          sourceAddressTypes: sourceTypes,
          destinationAddress,
        },
        btc: {
          feeRateSatVb,
          outputs: [{ address: destinationAddress, valueSats: outputSats }],
          utxos: allUtxos,
        },
      };
  const signed = args.execute && intent ? await signer.signIntent(intent) : null;
  const broadcast = args.execute && signed ? await signer.broadcastSignedIntent(signed) : null;
  const result = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    chain: args.chain,
    activeAddress,
    destination: {
      address: destinationAddress,
      scriptType: destinationScriptType,
    },
    sourceAddresses,
    totals: {
      inputSats,
      estimatedFeeSats,
      outputSats,
      feeRateSatVb,
    },
    planStatus: blockedReason ? "blocked" : "ready",
    blockedReason,
    signed,
    broadcast,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(summaryLines(result).join("\n"));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
