import assert from "node:assert/strict";
import { test } from "node:test";
import { getMultiSourcePricesUsd } from "../src/market/prices.mjs";

test("multi-source prices backfill tokenized gold from DIA when CoinGecko omits it", async () => {
  const prices = await getMultiSourcePricesUsd({
    now: "2026-05-20T18:30:00.000Z",
    coingeckoFetcher: async () => ({
      btc: 100,
      tokenByKey: { btc: 100, wbtc: 100, ethereum: 10, usd_stable: 1, paxg: null, xaut: null },
      nativeByChain: { ethereum: 10 },
    }),
    coinbaseFetcher: async () => ({
      btc: 102,
      tokenByKey: { btc: 102, wbtc: 102, ethereum: 12, usd_stable: 1, paxg: null, xaut: null },
      nativeByChain: { ethereum: 12 },
    }),
    diaFetcher: async () => ({
      btc: null,
      tokenByKey: { paxg: 4500, xaut: 4510 },
      nativeByChain: {},
    }),
  });

  assert.equal(prices.tokenByKey.paxg, 4500);
  assert.equal(prices.tokenByKey.xaut, 4510);
  assert.equal(prices.sourceCount, 3);
  assert.equal(
    prices.oracleSamples.some((sample) => sample.source === "dia" && sample.key === "paxg"),
    true,
  );
  assert.equal(
    prices.oracleSamples.some((sample) => sample.source === "dia" && sample.key === "xaut"),
    true,
  );
});
