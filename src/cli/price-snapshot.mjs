#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildPriceSnapshot, getCoinGeckoPricesUsd, latestPriceSnapshot, shouldPersistPriceSnapshot } from "../market/prices.mjs";

async function main() {
  const snapshot = buildPriceSnapshot(await getCoinGeckoPricesUsd(), {
    observedAt: new Date().toISOString(),
    source: "coingecko_or_fallback",
  });
  const previousSnapshot = latestPriceSnapshot(await readJsonl(config.dataDir, "market-price-snapshots"));
  const decision = shouldPersistPriceSnapshot(previousSnapshot, snapshot);
  if (!decision.shouldPersist) {
    console.log(`skipped=${decision.reason}`);
    console.log(`observedAt=${snapshot.observedAt}`);
    console.log(`btcUsd=${snapshot.btcUsd ?? "n/a"}`);
    return;
  }
  const path = await new JsonlStore(config.dataDir).append("market-price-snapshots", snapshot);
  console.log(`wrote=${path}`);
  console.log(`reason=${decision.reason}`);
  console.log(`observedAt=${snapshot.observedAt}`);
  console.log(`btcUsd=${snapshot.btcUsd ?? "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
