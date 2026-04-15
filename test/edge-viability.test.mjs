import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEdgeViabilitySummary, buildEdgeViabilityVerdict } from "../src/strategy/edge-viability.mjs";
import { ETHEREUM_L1_PHASE_DISABLED_REASON } from "../src/risk/ethereum-l1-policy.mjs";
import { trustedOdosQuote } from "./helpers/trusted-odos-quote.mjs";

test("edge viability quantifies the closest measured loop to the policy gate", () => {
  const summary = buildEdgeViabilitySummary({
    scoreSnapshot: {
      generatedAt: "2026-04-12T00:00:00.000Z",
      scores: [
        {
          routeKey: "ethereum:0x2260->unichain:0x0555",
          amount: "10000",
          srcChain: "ethereum",
          dstChain: "unichain",
          srcAsset: { ticker: "WBTC", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          inputAmount: "10000",
          executableOutputUsd: 7.2,
          knownCostUsd: 0.2,
          tradeReadiness: ETHEREUM_L1_PHASE_DISABLED_REASON,
          dataGaps: [],
          routeStats: { failureRate: 0 },
        },
        {
          routeKey: "base:0x0555->sonic:0x0555",
          amount: "10000",
          srcChain: "base",
          dstChain: "sonic",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          inputAmount: "10000",
          executableOutputUsd: 7.0,
          knownCostUsd: 0.2,
          tradeReadiness: "insufficient_data",
          dataGaps: [],
          routeStats: { failureRate: 0 },
        },
      ],
    },
    dexQuotes: [
      trustedOdosQuote({
        source: "gateway_src_entry_leg",
        chain: "ethereum",
        gatewayRouteKey: "ethereum:0x2260->unichain:0x0555",
        gatewayAmount: "10000",
        observedAt: "2026-04-12T00:00:01.000Z",
        outputAmount: "10000",
        inputValueUsd: 7.1,
        gasEstimateValueUsd: 0.05,
      }),
      trustedOdosQuote({
        source: "gateway_src_entry_leg",
        chain: "base",
        gatewayRouteKey: "base:0x0555->sonic:0x0555",
        gatewayAmount: "10000",
        observedAt: "2026-04-12T00:00:01.000Z",
        outputAmount: "10000",
        inputValueUsd: 7.4,
        gasEstimateValueUsd: 0.05,
      }),
    ],
  });

  assert.equal(summary.measuredLoopCount, 1);
  assert.equal(summary.policyBlockedLoopCount, 1);
  assert.equal(summary.positiveMeasuredCount, 0);
  assert.equal(summary.policyReadyCount, 0);
  assert.equal(summary.closestLoop.routeKey, "base:0x0555->sonic:0x0555");
  assert.equal(summary.closestLoop.requiredNetProfitUsd, 0.3);
  assert.equal(Number(summary.closestLoop.gapToPolicyUsd.toFixed(2)), 0.95);
  assert.equal(Number(summary.medianGapToPolicyUsd.toFixed(2)), 0.95);
});

test("edge viability verdict distinguishes incomplete coverage from measured no-edge", () => {
  const incomplete = buildEdgeViabilityVerdict({
    edgeViability: {
      measuredLoopCount: 4,
      positiveMeasuredCount: 0,
      policyReadyCount: 0,
      closestLoop: { gapToPolicyUsd: 0.12 },
    },
    dexRouteFocus: {
      missingGatewayQuoteCount: 2,
    },
  });
  const measuredNoEdge = buildEdgeViabilityVerdict({
    edgeViability: {
      measuredLoopCount: 20,
      positiveMeasuredCount: 0,
      policyReadyCount: 0,
      closestLoop: { gapToPolicyUsd: 0.89 },
    },
    dexRouteFocus: {
      missingGatewayQuoteCount: 0,
    },
  });

  assert.equal(incomplete.code, "coverage_still_incomplete");
  assert.equal(measuredNoEdge.code, "measured_no_edge");
});
