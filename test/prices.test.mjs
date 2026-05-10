import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backfillMissingNativePricesUsd,
  buildPriceSnapshot,
  emptyPricesUsd,
  getCoinGeckoPricesUsd,
  getMultiSourcePricesUsd,
  mergeMissingPricesUsd,
  mergePriceSourceSamples,
  overlayObservedPricesUsd,
  priceForAssetUsd,
  priceSamplesFromSnapshot,
  pricesFromSnapshot,
  shouldPersistPriceSnapshot,
} from "../src/market/prices.mjs";

test("observed snapshots backfill missing btc and ethereum prices", () => {
  const prices = overlayObservedPricesUsd(emptyPricesUsd(), {
    gasSnapshots: [
      { observedAt: "2026-04-11T01:47:15.396Z", chain: "ethereum", nativeUsd: 2242.72 },
      { observedAt: "2026-04-11T01:47:16.578Z", chain: "unichain", nativeUsd: 2242.72 },
    ],
    bitcoinFeeSnapshots: [
      { observedAt: "2026-04-10T18:50:40.365Z", btcUsd: 72988 },
    ],
  });

  assert.equal(prices.btc, 72988);
  assert.equal(prices.tokenByKey.btc, 72988);
  assert.equal(prices.tokenByKey.wbtc, 72988);
  assert.equal(prices.tokenByKey.ethereum, 2242.72);
  assert.equal(prices.nativeByChain.ethereum, 2242.72);
  assert.equal(prices.nativeByChain.base, 2242.72);
  assert.equal(prices.nativeByChain.bob, 2242.72);
});

test("missing live prices merge from a local fallback without overriding fresh values", () => {
  const merged = mergeMissingPricesUsd(
    {
      btc: null,
      tokenByKey: {
        btc: null,
        wbtc: null,
        ethereum: 2400,
        usd_stable: 1,
      },
      nativeByChain: {
        base: null,
        ethereum: 2400,
      },
    },
    {
      btc: 81000,
      tokenByKey: {
        btc: 81000,
        wbtc: 80950,
        ethereum: 2300,
        usd_stable: 1,
      },
      nativeByChain: {
        base: 2300,
        ethereum: 2300,
      },
    },
  );

  assert.equal(merged.btc, 81000);
  assert.equal(merged.tokenByKey.btc, 81000);
  assert.equal(merged.tokenByKey.wbtc, 80950);
  assert.equal(merged.tokenByKey.ethereum, 2400);
  assert.equal(merged.nativeByChain.base, 2300);
  assert.equal(merged.nativeByChain.ethereum, 2400);
});

test("missing BSC native price can be backfilled from Coinbase spot data", async () => {
  const prices = await backfillMissingNativePricesUsd({
    btc: null,
    tokenByKey: { usd_stable: 1 },
    nativeByChain: { avalanche: 10, bera: 1, bsc: null, sei: 0.06, sonic: 0.04 },
  }, {
    spotFetcher: async (symbol) => (symbol === "BNB" ? 650.25 : null),
  });

  assert.equal(prices.nativeByChain.bsc, 650.25);
  assert.equal(prices.tokenByKey.bsc, 650.25);
  assert.equal(priceForAssetUsd({ priceKey: "bsc" }, prices), 650.25);
});

test("missing SEI and Sonic native prices can be backfilled from free exchange tickers", async () => {
  const calls = [];
  const prices = await backfillMissingNativePricesUsd({
    btc: null,
    tokenByKey: { usd_stable: 1 },
    nativeByChain: { avalanche: 10, bera: 1, bsc: 600, sei: null, sonic: null },
  }, {
    spotFetcher: async () => null,
    binanceSpotFetcher: async (symbol) => {
      calls.push(`binance:${symbol}`);
      if (symbol === "SEIUSDT") return 0.06057;
      return null;
    },
    bybitSpotFetcher: async (symbol) => {
      calls.push(`bybit:${symbol}`);
      if (symbol === "SUSDT") return 0.04665;
      return null;
    },
  });

  assert.equal(prices.nativeByChain.sei, 0.06057);
  assert.equal(prices.tokenByKey.sei, 0.06057);
  assert.equal(prices.nativeByChain.sonic, 0.04665);
  assert.equal(prices.tokenByKey.sonic, 0.04665);
  assert.equal(priceForAssetUsd({ priceKey: "sei" }, prices), 0.06057);
  assert.equal(priceForAssetUsd({ priceKey: "sonic" }, prices), 0.04665);
  assert.ok(calls.includes("binance:SEIUSDT"));
  assert.ok(calls.includes("binance:SUSDT"));
  assert.ok(calls.includes("bybit:SUSDT"));
});

test("price snapshots round-trip into scoring price maps", () => {
  const snapshot = buildPriceSnapshot({
    btc: 72_988,
    tokenByKey: {
      btc: 72_988,
      wbtc: 72_950,
      ethereum: 2242.72,
    },
    nativeByChain: {
      bob: 2242.72,
      base: 2242.72,
    },
  }, {
    observedAt: "2026-04-11T02:00:00.000Z",
    source: "test",
  });

  const prices = pricesFromSnapshot(snapshot);
  assert.equal(snapshot.btcUsd, 72_988);
  assert.equal(snapshot.source, "test");
  assert.equal(prices.btc, 72_988);
  assert.equal(prices.tokenByKey.wbtc, 72_950);
  assert.equal(prices.nativeByChain.bob, 2242.72);
});

test("price snapshots skip unchanged appends within the recent window", () => {
  const previous = buildPriceSnapshot({
    btc: 72_988,
    tokenByKey: { btc: 72_988, wbtc: 72_988, ethereum: 2242.72 },
    nativeByChain: { bob: 2242.72, base: 2242.72 },
  }, {
    observedAt: "2026-04-11T02:00:00.000Z",
    source: "test",
  });
  const next = buildPriceSnapshot({
    btc: 72_988.1,
    tokenByKey: { btc: 72_988.1, wbtc: 72_988.1, ethereum: 2242.8 },
    nativeByChain: { bob: 2242.8, base: 2242.8 },
  }, {
    observedAt: "2026-04-11T02:05:00.000Z",
    source: "test",
  });

  assert.deepEqual(
    shouldPersistPriceSnapshot(previous, next, {
      now: "2026-04-11T02:05:00.000Z",
    }),
    { shouldPersist: false, reason: "recently_unchanged" },
  );
});

test("price snapshots persist when unchanged data ages out or materially moves", () => {
  const previous = buildPriceSnapshot({
    btc: 72_988,
    tokenByKey: { btc: 72_988, wbtc: 72_988, ethereum: 2242.72 },
    nativeByChain: { bob: 2242.72, base: 2242.72 },
  }, {
    observedAt: "2026-04-11T02:00:00.000Z",
    source: "test",
  });
  const staleNext = buildPriceSnapshot({
    btc: 72_988.1,
    tokenByKey: { btc: 72_988.1, wbtc: 72_988.1, ethereum: 2242.8 },
    nativeByChain: { bob: 2242.8, base: 2242.8 },
  }, {
    observedAt: "2026-04-11T02:20:00.000Z",
    source: "test",
  });
  const movedNext = buildPriceSnapshot({
    btc: 73_500,
    tokenByKey: { btc: 73_500, wbtc: 73_500, ethereum: 2300 },
    nativeByChain: { bob: 2300, base: 2300 },
  }, {
    observedAt: "2026-04-11T02:05:00.000Z",
    source: "test",
  });

  assert.deepEqual(
    shouldPersistPriceSnapshot(previous, staleNext, {
      now: "2026-04-11T02:20:00.000Z",
    }),
    { shouldPersist: true, reason: "stale_snapshot_rollover" },
  );
  assert.deepEqual(
    shouldPersistPriceSnapshot(previous, movedNext, {
      now: "2026-04-11T02:05:00.000Z",
    }),
    { shouldPersist: true, reason: "material_price_change" },
  );
});

test("price source samples merge by median and ignore stale samples", () => {
  const now = "2026-04-25T00:05:00.000Z";
  const samples = [
    ...priceSamplesFromSnapshot({
      btc: 100,
      tokenByKey: { btc: 100, wbtc: 100, usd_stable: 1 },
      nativeByChain: { ethereum: 10 },
    }, {
      source: "a",
      observedAt: now,
    }),
    ...priceSamplesFromSnapshot({
      btc: 102,
      tokenByKey: { btc: 102, wbtc: 102, usd_stable: 1 },
      nativeByChain: { ethereum: 12 },
    }, {
      source: "b",
      observedAt: now,
    }),
    ...priceSamplesFromSnapshot({
      btc: 500,
      tokenByKey: { btc: 500 },
      nativeByChain: { ethereum: 50 },
    }, {
      source: "stale",
      observedAt: "2026-04-24T00:00:00.000Z",
    }),
  ];
  const merged = mergePriceSourceSamples(samples, { now, maxSampleAgeMs: 300_000 });

  assert.equal(merged.btc, 101);
  assert.equal(merged.tokenByKey.wbtc, 101);
  assert.equal(merged.nativeByChain.ethereum, 11);
  assert.equal(merged.sourceCount, 2);
});

test("multi-source prices preserve oracle samples for divergence checks", async () => {
  const prices = await getMultiSourcePricesUsd({
    now: "2026-04-25T00:00:00.000Z",
    coingeckoFetcher: async () => ({
      btc: 100,
      tokenByKey: { btc: 100, wbtc: 100, ethereum: 10, usd_stable: 1 },
      nativeByChain: { ethereum: 10, base: 10 },
    }),
    coinbaseFetcher: async () => ({
      btc: 102,
      tokenByKey: { btc: 102, wbtc: 102, ethereum: 12, usd_stable: 1 },
      nativeByChain: { ethereum: 12, base: 12 },
    }),
  });

  assert.equal(prices.btc, 101);
  assert.equal(prices.nativeByChain.base, 11);
  assert.equal(prices.sourceCount, 2);
  assert.ok(prices.oracleSamples.length >= 2);
});

test("multi-source prices preserve oracle fields when every provider fails", async () => {
  const prices = await getMultiSourcePricesUsd({
    coingeckoFetcher: async () => {
      throw new Error("coingecko_down");
    },
    coinbaseFetcher: async () => {
      throw new Error("coinbase_down");
    },
  });

  assert.equal(prices.btc, null);
  assert.equal(prices.sourceCount, 0);
  assert.deepEqual(prices.oracleSamples, []);
});

test("CoinGecko rate limits fall back to exchange tickers for core BTC and ETH prices", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("api.coingecko.com")) {
      return { ok: false, status: 429, json: async () => ({}) };
    }
    if (target.includes("api.coinbase.com")) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    if (target.includes("api.binance.com") && target.includes("BTCUSDT")) {
      return { ok: true, json: async () => ({ price: "81000" }) };
    }
    if (target.includes("api.binance.com") && target.includes("ETHUSDT")) {
      return { ok: true, json: async () => ({ price: "3000" }) };
    }
    if (target.includes("api.binance.com") && target.includes("BNBUSDT")) {
      return { ok: true, json: async () => ({ price: "620" }) };
    }
    if (target.includes("api.binance.com") && target.includes("AVAXUSDT")) {
      return { ok: true, json: async () => ({ price: "35" }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const prices = await getCoinGeckoPricesUsd();
    assert.equal(prices.btc, 81_000);
    assert.equal(prices.tokenByKey.btc, 81_000);
    assert.equal(prices.tokenByKey.wbtc, 81_000);
    assert.equal(prices.tokenByKey.ethereum, 3_000);
    assert.equal(prices.nativeByChain.base, 3_000);
    assert.equal(prices.nativeByChain.bsc, 620);
    assert.equal(prices.nativeByChain.avalanche, 35);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
