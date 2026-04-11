import assert from "node:assert/strict";
import { test } from "node:test";
import { ZERO_TOKEN, WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildDexRouteUniverseSummary } from "../src/strategy/dex-route-universe.mjs";

test("dex route universe separates fully measurable BTC-family routes from provider gaps", () => {
  const summary = buildDexRouteUniverseSummary({
    observedAt: "2026-04-11T14:00:00.000Z",
    routes: [
      {
        srcChain: "ethereum",
        dstChain: "base",
        srcToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        dstToken: WBTC_OFT_TOKEN,
      },
      {
        srcChain: "base",
        dstChain: "bob",
        srcToken: WBTC_OFT_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      {
        srcChain: "bitcoin",
        dstChain: "base",
        srcToken: ZERO_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      {
        srcChain: "base",
        dstChain: "bitcoin",
        srcToken: WBTC_OFT_TOKEN,
        dstToken: ZERO_TOKEN,
      },
    ],
  });

  assert.equal(summary.btcFamilyRouteCount, 4);
  assert.equal(summary.fullyMeasurableRouteCount, 1);
  assert.equal(summary.singleProviderGapCount, 3);
  assert.equal(summary.doubleProviderGapCount, 0);
  assert.equal(summary.topGapChain.chain, "bitcoin");
  assert.equal(summary.fullyMeasurableRoutes[0].routeKey, "ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c");
  assert.equal(summary.blockerCounts.some((item) => item.key === "dst_odos_chain_not_supported"), true);
});
