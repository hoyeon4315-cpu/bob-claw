import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNoEdgePersistenceSummary } from "../src/strategy/no-edge-persistence.mjs";

test("no-edge persistence marks repeatedly negative routes as durable no-edge", () => {
  const summary = buildNoEdgePersistenceSummary({
    scoreSnapshot: {
      generatedAt: "2026-04-12T00:00:00.000Z",
      scores: [
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "10000",
          srcChain: "base",
          dstChain: "unichain",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          inputAmount: "10000",
          executableOutputUsd: 7.0,
          knownCostUsd: 0.2,
          tradeReadiness: "insufficient_data",
          dataGaps: [],
          routeStats: { failureRate: 0 },
        },
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "25000",
          srcChain: "base",
          dstChain: "unichain",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          inputAmount: "25000",
          executableOutputUsd: 17.1,
          knownCostUsd: 0.2,
          tradeReadiness: "insufficient_data",
          dataGaps: [],
          routeStats: { failureRate: 0 },
        },
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "50000",
          srcChain: "base",
          dstChain: "unichain",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          inputAmount: "50000",
          executableOutputUsd: 34.8,
          knownCostUsd: 0.2,
          tradeReadiness: "insufficient_data",
          dataGaps: [],
          routeStats: { failureRate: 0 },
        },
      ],
    },
    dexQuotes: [
      {
        source: "gateway_src_entry_leg",
        gatewayRouteKey: "base:0x0555->unichain:0x0555",
        gatewayAmount: "10000",
        observedAt: "2026-04-12T00:00:01.000Z",
        outputAmount: "10000",
        inputValueUsd: 7.4,
        gasEstimateValueUsd: 0.05,
      },
      {
        source: "gateway_src_entry_leg",
        gatewayRouteKey: "base:0x0555->unichain:0x0555",
        gatewayAmount: "25000",
        observedAt: "2026-04-12T00:00:01.000Z",
        outputAmount: "25000",
        inputValueUsd: 18.3,
        gasEstimateValueUsd: 0.05,
      },
      {
        source: "gateway_src_entry_leg",
        gatewayRouteKey: "base:0x0555->unichain:0x0555",
        gatewayAmount: "50000",
        observedAt: "2026-04-12T00:00:01.000Z",
        outputAmount: "50000",
        inputValueUsd: 36.5,
        gasEstimateValueUsd: 0.05,
      },
    ],
  });

  assert.equal(summary.routeCount, 1);
  assert.equal(summary.durableNoEdgeRouteCount, 1);
  assert.equal(summary.insufficientRouteEvidenceCount, 0);
  assert.equal(summary.bestRoute.classification, "durable_no_edge_route");
  assert.equal(summary.bestRoute.measuredLevelCount, 3);
});
