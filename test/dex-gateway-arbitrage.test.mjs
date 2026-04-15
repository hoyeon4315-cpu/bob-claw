import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDexGatewayArbitrageSummary, buildEthGatewayArbitrageSummary } from "../src/strategy/dex-gateway-arbitrage.mjs";
import { trustedOdosQuote } from "./helpers/trusted-odos-quote.mjs";

test("dex-gateway arbitrage identifies profitable exact loop when stable entry and executable exit align", () => {
  const summary = buildDexGatewayArbitrageSummary({
    scoreSnapshot: {
      generatedAt: "2026-04-11T14:00:00.000Z",
      scores: [
        {
          routeKey: "base:0xwbtc->bob:0xwbtc",
          amount: "10000",
          srcChain: "base",
          dstChain: "bob",
          srcAsset: { ticker: "WBTC", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          inputAmount: 0.0001,
          executableOutputUsd: 8.1,
          knownCostUsd: 0.2,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-04-11T14:00:01.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        gatewayRouteKey: "base:0xwbtc->bob:0xwbtc",
        gatewayAmount: "10000",
        inputValueUsd: 7.5,
        gasEstimateValueUsd: 0.02,
        outputAmount: "10000",
      }),
    ],
  });

  assert.equal(summary.routeCount, 1);
  assert.equal(summary.entryQuoteCount, 1);
  assert.equal(summary.exactAmountMatchCount, 1);
  assert.equal(summary.profitableExactCount, 1);
  assert.equal(summary.bestLoop.routeKey, "base:0xwbtc->bob:0xwbtc");
  assert.equal(summary.bestLoop.measuredLoopNetUsd > 0, true);
});

test("dex-gateway arbitrage reports amount mismatch and missing entry quotes conservatively", () => {
  const summary = buildDexGatewayArbitrageSummary({
    scoreSnapshot: {
      generatedAt: "2026-04-11T14:00:00.000Z",
      scores: [
        {
          routeKey: "base:0xwbtc->bob:0xwbtc",
          amount: "10000",
          srcChain: "base",
          dstChain: "bob",
          srcAsset: { ticker: "WBTC", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          inputAmount: 0.0001,
          executableOutputUsd: 7.0,
          knownCostUsd: 0.2,
          tradeReadiness: "insufficient_data",
          dataGaps: ["stale_src_gas_snapshot"],
          routeStats: { failureRate: 0.01 },
        },
        {
          routeKey: "bob:0xwbtc->base:0xwbtc",
          amount: "10000",
          srcChain: "bob",
          dstChain: "base",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "WBTC", family: "wrapped_btc", decimals: 8 },
          inputAmount: 0.0001,
          executableOutputUsd: null,
          knownCostUsd: 0.3,
          tradeReadiness: "insufficient_data",
          dataGaps: ["missing_src_execution_gas"],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-04-11T14:00:01.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        gatewayRouteKey: "base:0xwbtc->bob:0xwbtc",
        gatewayAmount: "10000",
        inputValueUsd: 7.4,
        gasEstimateValueUsd: 0.02,
        outputAmount: "9500",
      }),
    ],
  });

  assert.equal(summary.bestLoop, null);
  assert.equal(summary.closestLoop.routeKey, "base:0xwbtc->bob:0xwbtc");
  assert.equal(summary.closestLoop.blockers.includes("entry_amount_mismatch"), true);
  assert.equal(summary.closestLoop.blockers.includes("gateway_stale_src_gas_snapshot"), true);
  assert.equal(summary.loops.some((item) => item.blockers.includes("missing_source_entry_quote")), true);
});

test("eth-gateway arbitrage identifies measurable ETH-family loops separately from BTC loops", () => {
  const summary = buildEthGatewayArbitrageSummary({
    scoreSnapshot: {
      generatedAt: "2026-04-11T14:00:00.000Z",
      scores: [
        {
          routeKey: "base:0x0->ethereum:0x0",
          amount: "10000",
          srcChain: "base",
          dstChain: "ethereum",
          srcAsset: { ticker: "ETH", family: "native_or_wrapped", decimals: 18, priceKey: "ethereum" },
          dstAsset: { ticker: "ETH", family: "native_or_wrapped", decimals: 18, priceKey: "ethereum" },
          inputAmount: 0.002,
          executableOutputUsd: 8.2,
          knownCostUsd: 0.2,
          tradeReadiness: "observe_only_ethereum_l1_phase_disabled",
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-04-11T14:00:01.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        gatewayRouteKey: "base:0x0->ethereum:0x0",
        gatewayAmount: "10000",
        inputValueUsd: 7.5,
        gasEstimateValueUsd: 0.02,
        outputAmount: "2000000000000000",
      }),
    ],
  });

  assert.equal(summary.routeCount, 1);
  assert.equal(summary.entryQuoteCount, 1);
  assert.equal(summary.closestLoop.routeKey, "base:0x0->ethereum:0x0");
  assert.equal(summary.closestLoop.blockers.includes("gateway_observe_only_ethereum_l1_phase_disabled"), true);
});
