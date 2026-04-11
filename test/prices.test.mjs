import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPriceSnapshot, emptyPricesUsd, overlayObservedPricesUsd, pricesFromSnapshot } from "../src/market/prices.mjs";

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
