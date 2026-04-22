import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backfillMissingNativePricesUsd,
  buildPriceSnapshot,
  emptyPricesUsd,
  overlayObservedPricesUsd,
  priceForAssetUsd,
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

test("missing BSC native price can be backfilled from Coinbase spot data", async () => {
  const prices = await backfillMissingNativePricesUsd({
    btc: null,
    tokenByKey: { usd_stable: 1 },
    nativeByChain: { bsc: null },
  }, {
    spotFetcher: async (symbol) => (symbol === "BNB" ? 650.25 : null),
  });

  assert.equal(prices.nativeByChain.bsc, 650.25);
  assert.equal(prices.tokenByKey.bsc, 650.25);
  assert.equal(priceForAssetUsd({ priceKey: "bsc" }, prices), 650.25);
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
