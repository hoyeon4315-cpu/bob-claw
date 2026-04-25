#!/usr/bin/env node

// Fetch BTC/USD spot from multiple public sources and write a snapshot
// shaped for src/risk/auto-kill-triggers.mjs oracle-divergence evaluation.
// Tolerates per-source failures so a single outage does not collapse the
// snapshot below the divergence trigger's minSourceCount.

import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_PATH = join("data", "oracles", "btc-latest.json");
const FETCH_TIMEOUT_MS = 8_000;

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    path: options.path || DEFAULT_PATH,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function coinbaseSample() {
  const body = await fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot");
  const priceUsd = Number(body?.data?.amount);
  if (!Number.isFinite(priceUsd)) throw new Error("coinbase: non-finite");
  return { source: "coinbase", priceUsd };
}

async function binanceSample() {
  const body = await fetchJson("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
  const priceUsd = Number(body?.price);
  if (!Number.isFinite(priceUsd)) throw new Error("binance: non-finite");
  return { source: "binance", priceUsd };
}

async function krakenSample() {
  const body = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
  const pair = body?.result && Object.values(body.result)[0];
  const priceUsd = Number(pair?.c?.[0]);
  if (!Number.isFinite(priceUsd)) throw new Error("kraken: non-finite");
  return { source: "kraken", priceUsd };
}

async function coingeckoSample() {
  const body = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
  const priceUsd = Number(body?.bitcoin?.usd);
  if (!Number.isFinite(priceUsd)) throw new Error("coingecko: non-finite");
  return { source: "coingecko", priceUsd };
}

async function gatherSamples() {
  const fetchers = [coinbaseSample, binanceSample, krakenSample, coingeckoSample];
  const settled = await Promise.allSettled(fetchers.map((fn) => fn()));
  const samples = [];
  const errors = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      samples.push(outcome.value);
    } else {
      errors.push({ source: fetchers[index].name.replace(/Sample$/, ""), error: String(outcome.reason?.message || outcome.reason) });
    }
  }
  return { samples, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { samples, errors } = await gatherSamples();
  const snapshot = {
    schemaVersion: 1,
    asset: "btc",
    observedAt: new Date().toISOString(),
    samples,
    errors,
  };

  if (args.write) {
    await mkdir(dirname(args.path), { recursive: true });
    await writeFile(args.path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(`samples=${samples.length} errors=${errors.length} path=${args.write ? args.path : "(not written)"}`);
  }

  if (samples.length === 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
