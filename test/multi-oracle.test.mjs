import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregatePrice, featureEnabled } from "../src/market/multi-oracle.mjs";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ multiOracle: false }), false);
});

test("two sources agree returns correct median and no flag", async () => {
  const result = await aggregatePrice({
    token: "btc",
    sources: ["coingecko", "uniswap_v3_twap"],
    fetchers: {
      coingecko: async () => 70000,
      uniswapV3Twap: async () => 70100,
    },
  });
  assert.equal(result.median, 70050);
  assert.ok(result.divergencePct < 1);
  assert.equal(result.flag, null);
});

test("divergence greater than 1% flags oracle_divergence", async () => {
  const result = await aggregatePrice({
    token: "btc",
    sources: ["coingecko", "uniswap_v3_twap"],
    fetchers: {
      coingecko: async () => 70000,
      uniswapV3Twap: async () => 75000,
    },
  });
  assert.equal(result.median, 72500);
  assert.ok(result.divergencePct > 1);
  assert.equal(result.flag, "oracle_divergence");
});

test("single source returns median as that source", async () => {
  const result = await aggregatePrice({
    token: "btc",
    sources: ["coingecko"],
    fetchers: {
      coingecko: async () => 70000,
    },
  });
  assert.equal(result.median, 70000);
  assert.equal(result.divergencePct, 0);
  assert.equal(result.flag, null);
});

test("no sources returns null median", async () => {
  const result = await aggregatePrice({
    token: "btc",
    sources: [],
    fetchers: {},
  });
  assert.equal(result.median, null);
  assert.equal(result.flag, null);
});
