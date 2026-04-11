import assert from "node:assert/strict";
import { test } from "node:test";
import { chainPriceCaption, chainPriceExtremes, marketCoverage, referenceMarketPrice, routeSublineText } from "../dashboard/public/market-display.js";

test("market coverage is derived from chain prices instead of cached counters", () => {
  const coverage = marketCoverage({
    observedChainCount: 99,
    missingChainCount: 99,
    staleChainCount: 99,
    chainWbtcPrices: [
      { chain: "bitcoin", usd: 72_823, stale: true },
      { chain: "base", usd: 72_763, stale: true },
      { chain: "ethereum", usd: 72_743.12, stale: true },
      { chain: "bob", usd: null, stale: false },
      { chain: "sonic", usd: null, stale: false },
    ],
  });

  assert.deepEqual(coverage, {
    total: 4,
    observed: 2,
    missing: 2,
    stale: 2,
  });
});

test("reference market price inherits staleness from shared market age", () => {
  const reference = referenceMarketPrice({
    wbtcUsd: 72_663,
    ageMinutes: 214.5,
    chainPriceStaleMinutes: 60,
  });

  assert.deepEqual(reference, {
    ticker: "wBTC",
    usd: 72_663,
    stale: true,
  });
});

test("route subline replaces the old live-watch copy with coverage and reference price", () => {
  const text = routeSublineText({
    gateway: { updateDetected: false },
    market: {
      wbtcUsd: 72_663,
      ageMinutes: 10,
      chainPriceStaleMinutes: 60,
      chainWbtcPrices: [
        { chain: "bitcoin", usd: 72_823, stale: false },
        { chain: "base", usd: 72_763, stale: false },
        { chain: "ethereum", usd: 72_743.12, stale: true },
        { chain: "bob", usd: null, stale: false },
      ],
    },
  });

  assert.equal(text, "체인 실측 2/3 · 기준 wBTC $72.7k · stale 1");
});

test("price extremes still highlight high and low chains when every observed quote is stale", () => {
  const classes = chainPriceExtremes([
    { chain: "bitcoin", usd: 72_823, stale: true },
    { chain: "base", usd: 72_763, stale: true },
    { chain: "ethereum", usd: 72_743.12, stale: true },
  ]);

  assert.equal(classes.get("bitcoin"), "price-high");
  assert.equal(classes.get("ethereum"), "price-low");
});

test("missing quoteable chains show reference price with wait-state note", () => {
  const caption = chainPriceCaption(
    { chain: "sonic", usd: null, coverageReason: "eligible_quote_not_run" },
    "sonic",
    { wbtcUsd: 72_663, ageMinutes: 10, chainPriceStaleMinutes: 60 },
  );

  assert.deepEqual(caption, {
    value: "$72.7k",
    delta: "기준 wBTC",
    note: "실측 대기",
    stale: false,
    variant: "reference",
  });
});

test("unsupported chains show reference price with unsupported note", () => {
  const caption = chainPriceCaption(
    { chain: "bob", usd: null, coverageReason: "odos_chain_not_supported" },
    "bob",
    { wbtcUsd: 72_663, ageMinutes: 10, chainPriceStaleMinutes: 60 },
  );

  assert.deepEqual(caption, {
    value: "$72.7k",
    delta: "기준 wBTC",
    note: "DEX 미지원",
    stale: false,
    variant: "reference",
  });
});
