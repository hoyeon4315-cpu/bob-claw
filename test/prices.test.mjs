import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPricesUsd, overlayObservedPricesUsd } from "../src/market/prices.mjs";

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
