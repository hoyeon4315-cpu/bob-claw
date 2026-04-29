#!/usr/bin/env node

import { join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildPriceSnapshot, getCoinGeckoPricesUsd, latestPriceSnapshot, shouldPersistPriceSnapshot } from "../market/prices.mjs";

export async function runPriceSnapshot({
  dataDir = config.dataDir,
  now = new Date(),
  fetchPrices = getCoinGeckoPricesUsd,
  readJsonlImpl = readJsonl,
  store = new JsonlStore(dataDir),
  writeText = writeTextIfChanged,
} = {}) {
  const observedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const snapshot = buildPriceSnapshot(await fetchPrices(), {
    observedAt,
    source: "coingecko_or_fallback",
  });
  const latestPath = join(dataDir, "price-snapshot.json");
  await writeText(latestPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const previousSnapshot = latestPriceSnapshot(await readJsonlImpl(dataDir, "market-price-snapshots"));
  const decision = shouldPersistPriceSnapshot(previousSnapshot, snapshot);
  if (!decision.shouldPersist) {
    return { snapshot, decision, latestPath, appendPath: null };
  }
  const appendPath = await store.append("market-price-snapshots", snapshot);
  return { snapshot, decision, latestPath, appendPath };
}

async function main() {
  const result = await runPriceSnapshot();
  if (!result.decision.shouldPersist) {
    console.log(`skipped=${result.decision.reason}`);
    console.log(`latest=${result.latestPath}`);
    console.log(`observedAt=${result.snapshot.observedAt}`);
    console.log(`btcUsd=${result.snapshot.btcUsd ?? "n/a"}`);
    return;
  }
  console.log(`wrote=${result.appendPath}`);
  console.log(`latest=${result.latestPath}`);
  console.log(`reason=${result.decision.reason}`);
  console.log(`observedAt=${result.snapshot.observedAt}`);
  console.log(`btcUsd=${result.snapshot.btcUsd ?? "n/a"}`);
}

const entrypointHref = process.argv[1] ? new URL(`file://${resolve(process.argv[1])}`).href : null;
if (entrypointHref && import.meta.url === entrypointHref) {
  main().catch((error) => {
    if (error instanceof Error) {
      console.error(error.stack || error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}
