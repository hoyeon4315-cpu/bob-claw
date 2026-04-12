import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBtcProxySpreadSummary } from "../src/strategy/btc-proxy-spreads.mjs";

const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const SOLVBTC = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDC_AVAX = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";

test("btc proxy spread summary reports profitable inventory spread and rebalance-adjusted spread", () => {
  const summary = buildBtcProxySpreadSummary({
    dexQuotes: [
      {
        observedAt: "2026-04-12T00:00:00.000Z",
        quoteType: "stable_to_token",
        source: "gateway_src_entry_leg",
        chain: "ethereum",
        inputToken: USDC_ETH,
        inputTicker: "USDC",
        outputToken: WBTC,
        outputTicker: "WBTC",
        targetTokenAmount: "10000",
        outputAmount: "10120",
        inputValueUsd: 7.05,
        gasEstimateValueUsd: 0.02,
      },
      {
        observedAt: "2026-04-12T00:00:01.000Z",
        quoteType: "token_to_stable",
        source: "gateway_dst_leg",
        chain: "base",
        inputToken: WBTC_OFT,
        inputTicker: "wBTC.OFT",
        outputToken: USDC_BASE,
        outputTicker: "USDC",
        inputAmount: "10000",
        netOutputValueUsd: 7.6,
        gasEstimateValueUsd: 0.01,
      },
    ],
    routes: [
      {
        srcChain: "avalanche",
        dstChain: "base",
        srcToken: WBTC_OFT,
        dstToken: WBTC_OFT,
      },
      {
        srcChain: "ethereum",
        dstChain: "base",
        srcToken: WBTC,
        dstToken: WBTC_OFT,
      },
    ],
    scoreSnapshot: {
      scores: [
        {
          routeKey: "ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
          amount: "10000",
          knownCostUsd: 0.18,
          tradeReadiness: "shadow_candidate_review_only",
          dataGaps: [],
        },
      ],
    },
  });

  assert.equal(summary.opportunityCount, 1);
  assert.equal(summary.rawPositiveCount, 1);
  assert.equal(summary.rebalancePositiveCount, 1);
  assert.equal(summary.policyReadyCount, 1);
  assert.equal(summary.bestRebalanceOpportunity.proxyGroup, "wbtc");
  assert.equal(summary.bestRebalanceOpportunity.buyChain, "ethereum");
  assert.equal(summary.bestRebalanceOpportunity.sellChain, "base");
  assert.equal(Number(summary.bestRebalanceOpportunity.rawSpreadUsd.toFixed(2)), 0.53);
  assert.equal(Number(summary.bestRebalanceOpportunity.rebalanceAdjustedSpreadUsd.toFixed(2)), 0.35);
  assert.equal(summary.bestRebalanceOpportunity.policyReadyAfterRebalance, true);
});

test("btc proxy spread summary reports blockers when amount coverage or rebalance data is missing", () => {
  const summary = buildBtcProxySpreadSummary({
    dexQuotes: [
      {
        observedAt: "2026-04-12T00:00:00.000Z",
        quoteType: "stable_to_token",
        source: "gateway_src_entry_leg",
        chain: "avalanche",
        inputToken: USDC_AVAX,
        inputTicker: "USDC",
        outputToken: WBTC_OFT,
        outputTicker: "wBTC.OFT",
        targetTokenAmount: "10000",
        outputAmount: "9799",
        inputValueUsd: 7.3,
        gasEstimateValueUsd: 0.03,
      },
      {
        observedAt: "2026-04-12T00:00:01.000Z",
        quoteType: "token_to_stable",
        source: "gateway_dst_leg",
        chain: "base",
        inputToken: WBTC_OFT,
        inputTicker: "wBTC.OFT",
        outputToken: USDC_BASE,
        outputTicker: "USDC",
        inputAmount: "10000",
        netOutputValueUsd: 7.2,
        gasEstimateValueUsd: 0.01,
      },
    ],
    routes: [],
    scoreSnapshot: { scores: [] },
  });

  assert.equal(summary.opportunityCount, 1);
  assert.equal(summary.policyReadyCount, 0);
  assert.equal(summary.bestRebalanceOpportunity.blockers.includes("amount_mismatch"), true);
  assert.equal(summary.bestRebalanceOpportunity.blockers.includes("non_positive_raw_spread"), true);
  assert.equal(summary.bestRebalanceOpportunity.blockers.includes("missing_rebalance_route"), true);
  assert.equal(summary.bestRebalanceOpportunity.rebalanceAdjustedSpreadUsd, null);
});

test("btc proxy spread summary separates observed proxy coverage from matched opportunity coverage", () => {
  const summary = buildBtcProxySpreadSummary({
    dexQuotes: [
      {
        observedAt: "2026-04-12T00:00:00.000Z",
        quoteType: "stable_to_token",
        source: "gateway_src_entry_leg",
        chain: "ethereum",
        inputToken: USDC_ETH,
        inputTicker: "USDC",
        outputToken: WBTC,
        outputTicker: "WBTC",
        targetTokenAmount: "10000",
        outputAmount: "10050",
        inputValueUsd: 7.1,
        gasEstimateValueUsd: 0.02,
      },
      {
        observedAt: "2026-04-12T00:00:01.000Z",
        quoteType: "token_to_stable",
        source: "gateway_dst_leg",
        chain: "base",
        inputToken: WBTC_OFT,
        inputTicker: "wBTC.OFT",
        outputToken: USDC_BASE,
        outputTicker: "USDC",
        inputAmount: "10000",
        netOutputValueUsd: 7.3,
        gasEstimateValueUsd: 0.01,
      },
      {
        observedAt: "2026-04-12T00:00:02.000Z",
        quoteType: "token_to_stable",
        source: "gateway_dst_leg",
        chain: "base",
        inputToken: SOLVBTC,
        inputTicker: "solvBTC",
        outputToken: USDC_BASE,
        outputTicker: "USDC",
        inputAmount: "10000",
        netOutputValueUsd: 7.25,
        gasEstimateValueUsd: 0.01,
      },
    ],
    routes: [
      {
        srcChain: "ethereum",
        dstChain: "base",
        srcToken: WBTC,
        dstToken: WBTC_OFT,
      },
    ],
    scoreSnapshot: {
      scores: [
        {
          routeKey: "ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
          amount: "10000",
          knownCostUsd: 0.1,
          tradeReadiness: "shadow_candidate_review_only",
          dataGaps: [],
        },
      ],
    },
  });

  assert.equal(summary.observedBuyProxyGroupCount, 1);
  assert.equal(summary.observedSellProxyGroupCount, 2);
  assert.equal(summary.proxyGroupCount, 1);
  assert.deepEqual(summary.unmatchedObservedProxyGroups, ["solvbtc"]);
  assert.equal(summary.observedSellProxyCoverage.some((item) => item.proxyGroup === "solvbtc"), true);
});
