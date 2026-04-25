import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyRouteFamily,
  usdToTokenAmount,
  buildScanSummary,
  scanQuoteSurface,
} from "../src/cli/scan-quote-surface.mjs";

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const UNI_BTC = "0x236f8c0a61dA474dB21B693fB2ea7AAB0c803894";
const SOLVBTC = "0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETH_BSC = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";

// ── Route family classification ──────────────────────────────────────────────

test("classifyRouteFamily returns btc_wrap for BTC-to-BTC routes", () => {
  assert.equal(
    classifyRouteFamily({ srcChain: "bitcoin", dstChain: "bob", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT }),
    "btc_wrap",
  );
  assert.equal(
    classifyRouteFamily({ srcChain: "ethereum", dstChain: "base", srcToken: WBTC, dstToken: WBTC_OFT }),
    "btc_wrap",
  );
  assert.equal(
    classifyRouteFamily({ srcChain: "bob", dstChain: "base", srcToken: UNI_BTC, dstToken: SOLVBTC }),
    "btc_wrap",
  );
});

test("classifyRouteFamily returns btc_swap when only one side is BTC", () => {
  assert.equal(
    classifyRouteFamily({ srcChain: "base", dstChain: "bob", srcToken: USDC_BASE, dstToken: WBTC_OFT }),
    "btc_swap",
  );
  assert.equal(
    classifyRouteFamily({ srcChain: "bitcoin", dstChain: "base", srcToken: ZERO_TOKEN, dstToken: USDC_BASE }),
    "btc_swap",
  );
});

test("classifyRouteFamily returns stablecoin_swap for stablecoin routes", () => {
  assert.equal(
    classifyRouteFamily({ srcChain: "base", dstChain: "ethereum", srcToken: USDC_BASE, dstToken: USDT_ETH }),
    "stablecoin_swap",
  );
});

test("classifyRouteFamily returns native_swap for native/wrapped routes", () => {
  assert.equal(
    classifyRouteFamily({ srcChain: "ethereum", dstChain: "bsc", srcToken: ZERO_TOKEN, dstToken: ETH_BSC }),
    "native_swap",
  );
});

test("classifyRouteFamily returns other for unrecognized token pairs", () => {
  assert.equal(
    classifyRouteFamily({
      srcChain: "ethereum",
      dstChain: "base",
      srcToken: "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
      dstToken: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
    }),
    "other",
  );
});

// ── USD → token amount conversion ────────────────────────────────────────────

test("usdToTokenAmount converts USD to BTC sats correctly", () => {
  const asset = { priceKey: "btc", decimals: 8 };
  const prices = { btc: 100_000, tokenByKey: { btc: 100_000 }, nativeByChain: {} };
  const amount = usdToTokenAmount(100, asset, prices);
  // $100 at $100k/BTC = 0.001 BTC = 100_000 sats
  assert.equal(amount, "100000");
});

test("usdToTokenAmount converts USD to USDC (6 decimals) correctly", () => {
  const asset = { priceKey: "usd_stable", decimals: 6 };
  const prices = { btc: null, tokenByKey: { usd_stable: 1 }, nativeByChain: {} };
  const amount = usdToTokenAmount(25, asset, prices);
  // $25 at $1/USDC = 25 USDC = 25_000_000 units
  assert.equal(amount, "25000000");
});

test("usdToTokenAmount converts USD to ETH (18 decimals) correctly", () => {
  const asset = { priceKey: "ethereum", decimals: 18 };
  const prices = { btc: null, tokenByKey: { ethereum: 2500 }, nativeByChain: {} };
  const amount = usdToTokenAmount(50, asset, prices);
  // $50 at $2500/ETH = 0.02 ETH = 2e16 wei
  assert.equal(amount, "20000000000000000");
});

test("usdToTokenAmount returns null for missing price", () => {
  const asset = { priceKey: "unknown_key", decimals: 18 };
  const prices = { btc: null, tokenByKey: {}, nativeByChain: {} };
  assert.equal(usdToTokenAmount(100, asset, prices), null);
});

test("usdToTokenAmount returns null for missing decimals", () => {
  const asset = { priceKey: "btc", decimals: null };
  const prices = { btc: 100_000, tokenByKey: { btc: 100_000 }, nativeByChain: {} };
  assert.equal(usdToTokenAmount(100, asset, prices), null);
});

// ── Summary calculation ──────────────────────────────────────────────────────

test("buildScanSummary computes correct statistics from mock ladder results", () => {
  const ladder = [
    { success: true, latencyMs: 400, netHaircutPct: 0.35, estimatedTimeInSecs: 60 },
    { success: true, latencyMs: 500, netHaircutPct: 0.50, estimatedTimeInSecs: 60 },
    { success: true, latencyMs: 800, netHaircutPct: 1.20, estimatedTimeInSecs: 120 },
    { success: false, latencyMs: null, netHaircutPct: null, estimatedTimeInSecs: null, error: "timeout" },
  ];

  const summary = buildScanSummary(ladder);

  assert.equal(summary.quotesAttempted, 4);
  assert.equal(summary.quotesSucceeded, 3);
  assert.equal(summary.failureRate, 0.25);
  assert.equal(summary.bestHaircutPct, 0.35);
  assert.equal(summary.worstHaircutPct, 1.20);
  assert.equal(summary.medianLatencyMs, 500);
  assert.equal(summary.p95LatencyMs, 800);
  assert.equal(summary.estimatedTimeInSecs, 120);
  assert.equal(summary.policyViable, false);
});

test("buildScanSummary marks policyViable when best haircut is below threshold", () => {
  const ladder = [
    { success: true, latencyMs: 300, netHaircutPct: 0.10, estimatedTimeInSecs: 30 },
    { success: true, latencyMs: 350, netHaircutPct: 0.20, estimatedTimeInSecs: 30 },
  ];

  const summary = buildScanSummary(ladder);

  assert.equal(summary.policyViable, true);
  assert.equal(summary.bestHaircutPct, 0.10);
  assert.equal(summary.failureRate, 0);
});

test("buildScanSummary handles all-failure ladder gracefully", () => {
  const ladder = [
    { success: false, latencyMs: null, netHaircutPct: null, error: "timeout" },
    { success: false, latencyMs: null, netHaircutPct: null, error: "rate_limit" },
  ];

  const summary = buildScanSummary(ladder);

  assert.equal(summary.quotesAttempted, 2);
  assert.equal(summary.quotesSucceeded, 0);
  assert.equal(summary.failureRate, 1);
  assert.equal(summary.bestHaircutPct, null);
  assert.equal(summary.worstHaircutPct, null);
  assert.equal(summary.medianLatencyMs, null);
  assert.equal(summary.policyViable, false);
});

test("scanQuoteSurface narrows scanning to explicit route keys", async () => {
  const routes = [
    { srcChain: "ethereum", dstChain: "bsc", srcToken: ZERO_TOKEN, dstToken: ETH_BSC },
    { srcChain: "base", dstChain: "ethereum", srcToken: USDC_BASE, dstToken: USDT_ETH },
  ];
  const requestedRoutes = [];
  const result = await scanQuoteSurface({
    client: {
      async getRoutes() {
        return { body: routes };
      },
      async getQuote(params) {
        requestedRoutes.push(`${params.srcChain}:${params.srcToken}->${params.dstChain}:${params.dstToken}`);
        return {
          latencyMs: 25,
          body: {
            inputAmount: { amount: params.amount },
            outputAmount: { amount: params.amount },
            estimatedTimeInSecs: 30,
            tx: { value: "0" },
          },
        };
      },
    },
    store: {
      async append() {},
    },
    prices: { btc: null, tokenByKey: { ethereum: 2500, usd_stable: 1 }, nativeByChain: {} },
    routeKeyFilter: [`ethereum:${ZERO_TOKEN}->bsc:${ETH_BSC}`],
    usdLadder: [25],
    requestDelayMs: 0,
  });

  assert.equal(result.scannedRoutes, 1);
  assert.equal(result.records[0].routeKey, `ethereum:${ZERO_TOKEN}->bsc:${ETH_BSC}`);
  assert.deepEqual(requestedRoutes, [`ethereum:${ZERO_TOKEN}->bsc:${ETH_BSC}`]);
});
