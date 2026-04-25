import assert from "node:assert/strict";
import { test } from "node:test";
import { SOLVBTC_TOKEN, ZERO_TOKEN, WBTC_OFT_TOKEN, classifyGatewayAssetUniverse, isBtcFamilyRoute, tokenAsset } from "../src/assets/tokens.mjs";
import { buildDexRouteUniverseSummary, buildEthRouteUniverseSummary } from "../src/strategy/dex-route-universe.mjs";

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

test("btc family route classification includes solvBTC as wrapped BTC proxy", () => {
  assert.equal(SOLVBTC_TOKEN, "0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f");
  assert.equal(tokenAsset("base", SOLVBTC_TOKEN).decimals, 18);
  assert.equal(
    isBtcFamilyRoute({
      srcChain: "bitcoin",
      dstChain: "base",
      srcToken: ZERO_TOKEN,
      dstToken: SOLVBTC_TOKEN,
    }),
    true,
  );
});

test("gateway asset watchlist distinguishes observed btc wrappers from missing watch targets and unknown tokens", () => {
  const summary = classifyGatewayAssetUniverse([
    {
      srcChain: "bitcoin",
      dstChain: "base",
      srcToken: ZERO_TOKEN,
      dstToken: SOLVBTC_TOKEN,
    },
    {
      srcChain: "bob",
      dstChain: "bitcoin",
      srcToken: "0x236f8c0a61dA474dB21B693fB2ea7AAB0c803894",
      dstToken: ZERO_TOKEN,
    },
    {
      srcChain: "bob",
      dstChain: "base",
      srcToken: "0x9999999999999999999999999999999999999999",
      dstToken: WBTC_OFT_TOKEN,
    },
  ]);

  assert.equal(summary.observedBtcLikeAssets.some((item) => item.ticker === "solvBTC"), true);
  assert.equal(summary.observedBtcLikeAssets.some((item) => item.ticker === "uniBTC"), true);
  assert.equal(summary.watchlistObserved.some((item) => item.ticker === "solvBTC"), true);
  assert.equal(summary.watchlistObserved.some((item) => item.ticker === "uniBTC"), true);
  assert.equal(summary.watchlistMissing.some((item) => item.ticker === "xSolvBTC"), true);
  assert.equal(summary.watchlistMissing.some((item) => item.ticker === "tBTC"), true);
  assert.equal(
    summary.watchlistMissing.find((item) => item.ticker === "xSolvBTC")?.source?.url,
    "https://www.gobob.xyz/blog/btc-to-wbtc",
  );
  assert.equal(
    summary.watchlistObserved.find((item) => item.ticker === "solvBTC")?.source?.label,
    "BOB introduces 1-click Bitcoin DeFi to Xverse Earn",
  );
  assert.deepEqual(summary.unknownAssets.map((item) => item.token), ["0x9999999999999999999999999999999999999999"]);
});

test("eth route universe isolates pure ETH-family routes from broader ETH-related inventory", () => {
  const summary = buildEthRouteUniverseSummary({
    observedAt: "2026-04-11T14:00:00.000Z",
    routes: [
      {
        srcChain: "base",
        dstChain: "ethereum",
        srcToken: ZERO_TOKEN,
        dstToken: ZERO_TOKEN,
      },
      {
        srcChain: "bitcoin",
        dstChain: "base",
        srcToken: ZERO_TOKEN,
        dstToken: ZERO_TOKEN,
      },
      {
        srcChain: "base",
        dstChain: "bob",
        srcToken: WBTC_OFT_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
    ],
  });

  assert.equal(summary.family, "eth");
  assert.equal(summary.ethFamilyRouteCount, 1);
  assert.equal(summary.fullyMeasurableRouteCount, 1);
  assert.equal(summary.fullyMeasurableRoutes[0].routeKey, `base:${ZERO_TOKEN}->ethereum:${ZERO_TOKEN}`);
});
