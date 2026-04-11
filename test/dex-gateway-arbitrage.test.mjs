import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDexGatewayArbitrageSummary } from "../src/strategy/dex-gateway-arbitrage.mjs";

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
      {
        observedAt: "2026-04-11T14:00:01.000Z",
        source: "gateway_src_entry_leg",
        gatewayRouteKey: "base:0xwbtc->bob:0xwbtc",
        gatewayAmount: "10000",
        inputValueUsd: 7.5,
        gasEstimateValueUsd: 0.02,
        outputAmount: "10000",
      },
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
      {
        observedAt: "2026-04-11T14:00:01.000Z",
        source: "gateway_src_entry_leg",
        gatewayRouteKey: "base:0xwbtc->bob:0xwbtc",
        gatewayAmount: "10000",
        inputValueUsd: 7.4,
        gasEstimateValueUsd: 0.02,
        outputAmount: "9500",
      },
    ],
  });

  assert.equal(summary.bestLoop, null);
  assert.equal(summary.closestLoop.routeKey, "base:0xwbtc->bob:0xwbtc");
  assert.equal(summary.closestLoop.blockers.includes("entry_amount_mismatch"), true);
  assert.equal(summary.closestLoop.blockers.includes("gateway_stale_src_gas_snapshot"), true);
  assert.equal(summary.loops.some((item) => item.blockers.includes("missing_source_entry_quote")), true);
});
