import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDexEnvironmentSummary } from "../src/strategy/dex-environment.mjs";
import { trustedOdosQuote } from "./helpers/trusted-odos-quote.mjs";

test("dex environment flags stale, thin-liquidity, and single-sample BTC execution legs", () => {
  const summary = buildDexEnvironmentSummary({
    now: "2026-04-11T14:30:00.000Z",
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-04-11T13:00:00.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        inputTicker: "USDC",
        inputDecimals: 6,
        outputToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
        outputTicker: "wBTC.OFT",
        outputDecimals: 8,
        inputAmount: "7375000",
        outputAmount: "10000",
        inputValueUsd: 7.375,
        gasEstimateValueUsd: 0.004,
        priceImpactPct: 0.2,
        gatewayRouteKey: "base:0xwbtc->bitcoin:0xbtc",
        gatewayAmount: "10000",
      }),
      trustedOdosQuote({
        observedAt: "2026-04-11T13:10:00.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        inputTicker: "USDC",
        inputDecimals: 6,
        outputToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
        outputTicker: "wBTC.OFT",
        outputDecimals: 8,
        inputAmount: "7385000",
        outputAmount: "10000",
        inputValueUsd: 7.385,
        gasEstimateValueUsd: 0.005,
        priceImpactPct: 0.3,
        gatewayRouteKey: "base:0xwbtc->bitcoin:0xbtc",
        gatewayAmount: "10000",
      }),
      trustedOdosQuote({
        observedAt: "2026-04-11T14:25:00.000Z",
        source: "gateway_src_entry_leg",
        chain: "ethereum",
        inputToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        inputTicker: "USDC",
        inputDecimals: 6,
        outputToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        outputTicker: "WBTC",
        outputDecimals: 8,
        inputAmount: "7374000",
        outputAmount: "10000",
        inputValueUsd: 7.374,
        gasEstimateValueUsd: 0.05,
        priceImpactPct: 12,
        gatewayRouteKey: "ethereum:0xwbtc->bitcoin:0xbtc",
        gatewayAmount: "10000",
      }),
    ],
  });

  assert.equal(summary.monitoredRouteCount, 2);
  assert.equal(summary.staleLegCount, 1);
  assert.equal(summary.thinLiquidityLegCount, 1);
  assert.equal(summary.singleSampleLegCount, 0);
  assert.equal(summary.refreshNeededRouteCount, 1);
  assert.equal(summary.topRiskRoute.routeKey, "base:0xwbtc->bitcoin:0xbtc");
  assert.equal(summary.routes.some((item) => item.classification === "thin_liquidity"), true);
});
