#!/usr/bin/env node

import { buildBitcoinFeeSnapshot, DEFAULT_BTC_TX_VBYTES, MempoolClient } from "../bitcoin/fees.mjs";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { getCoinGeckoPricesUsd } from "../market/prices.mjs";

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    vbytes: options.vbytes ? Number(options.vbytes) : DEFAULT_BTC_TX_VBYTES,
  };
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 4 : 6)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new MempoolClient();
  const store = new JsonlStore(config.dataDir);
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;
  const [prices, fees] = await Promise.all([getCoinGeckoPricesUsd(), client.getRecommendedFees()]);
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    ...buildBitcoinFeeSnapshot({
      fees: fees.body,
      btcUsd: prices.btc,
      latencyMs: fees.latencyMs,
      vbytes: args.vbytes,
    }),
  };
  await store.append("bitcoin-fee-snapshots", snapshot);
  console.log(
    [
      "bitcoin",
      `feeRate=${snapshot.selectedFeeRateSatVb}sat/vB`,
      `vbytes=${snapshot.vbytes}`,
      `feeSats=${snapshot.estimatedFeeSats}`,
      `fee=${formatUsd(snapshot.estimatedFeeUsd)}`,
      `btcUsd=${prices.btc}`,
      `latency=${snapshot.latencyMs}ms`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
