import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCrossAssetArbitrageSummary,
  buildEthCrossAssetArbitrageSummary,
} from "../src/strategy/cross-asset-arbitrage.mjs";

test("cross-asset arbitrage identifies profitable closed stable-btc-stable loops", () => {
  const summary = buildCrossAssetArbitrageSummary({
    generatedAt: "2026-04-11T13:00:00.000Z",
    scores: [
      {
        routeKey: "base:0xusdc->bitcoin:0xbtc",
        amount: "4000000",
        srcChain: "base",
        dstChain: "bitcoin",
        srcAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        dstAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        inputAmount: 4,
        outputAmount: 0.0001,
        inputUsd: 4.01,
        outputUsd: 7.1,
        knownCostUsd: 0.1,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
      },
      {
        routeKey: "bitcoin:0xbtc->base:0xusdc",
        amount: "10000",
        srcChain: "bitcoin",
        dstChain: "base",
        srcAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        dstAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        inputAmount: 0.0001,
        outputAmount: 4.5,
        inputUsd: 7.3,
        outputUsd: 4.5,
        knownCostUsd: 0.1,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
      },
    ],
  });

  assert.equal(summary.exactAssetPairCount, 1);
  assert.equal(summary.matchedLoopCount, 1);
  assert.equal(summary.closedLoopCount, 1);
  assert.equal(summary.profitableClosedLoopCount, 1);
  assert.equal(summary.bestLoop.entryRouteKey, "base:0xusdc->bitcoin:0xbtc");
  assert.equal(summary.bestLoop.exitRouteKey, "bitcoin:0xbtc->base:0xusdc");
  assert.equal(summary.bestLoop.closedLoop, true);
  assert.equal(summary.bestLoop.exactAmountMatch, true);
  assert.equal(summary.bestLoop.loopNetEdgeUsd > 0, true);
});

test("cross-asset arbitrage reports closest loop when BTC amount does not match", () => {
  const summary = buildCrossAssetArbitrageSummary({
    generatedAt: "2026-04-11T13:00:00.000Z",
    scores: [
      {
        routeKey: "base:0xusdc->bitcoin:0xbtc",
        amount: "4000000",
        srcChain: "base",
        dstChain: "bitcoin",
        srcAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        dstAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        inputAmount: 4,
        outputAmount: 0.00004398,
        inputUsd: 4.03,
        outputUsd: 3.19,
        knownCostUsd: 0.11,
        tradeReadiness: "insufficient_data",
        dataGaps: ["stale_src_gas_snapshot"],
      },
      {
        routeKey: "bitcoin:0xbtc->base:0xusdc",
        amount: "10000",
        srcChain: "bitcoin",
        dstChain: "base",
        srcAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        dstAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        inputAmount: 0.0001,
        outputAmount: 6.3,
        inputUsd: 7.3,
        outputUsd: 6.3,
        knownCostUsd: 0.18,
        tradeReadiness: "observe_only_slow_settlement",
        dataGaps: [],
      },
    ],
  });

  assert.equal(summary.matchedLoopCount, 0);
  assert.equal(summary.closedLoopCount, 0);
  assert.equal(summary.profitableClosedLoopCount, 0);
  assert.equal(summary.bestLoop, null);
  assert.equal(summary.closestLoop.entryRouteKey, "base:0xusdc->bitcoin:0xbtc");
  assert.equal(summary.closestLoop.exitRouteKey, "bitcoin:0xbtc->base:0xusdc");
  assert.equal(summary.closestLoop.blockers.includes("amount_mismatch"), true);
});

test("cross-asset arbitrage tracks amount ladder coverage across stable loop pairs", () => {
  const summary = buildCrossAssetArbitrageSummary({
    generatedAt: "2026-04-11T13:00:00.000Z",
    scores: [
      {
        routeKey: "base:0xusdc->bitcoin:0xbtc",
        amount: "4000000",
        srcChain: "base",
        dstChain: "bitcoin",
        srcAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        dstAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        inputAmount: 4,
        outputAmount: 0.00005,
        inputUsd: 4.05,
        outputUsd: 3.7,
        knownCostUsd: 0.1,
        tradeReadiness: "insufficient_data",
        dataGaps: [],
      },
      {
        routeKey: "base:0xusdc->bitcoin:0xbtc",
        amount: "8000000",
        srcChain: "base",
        dstChain: "bitcoin",
        srcAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        dstAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        inputAmount: 8,
        outputAmount: 0.0001,
        inputUsd: 8.05,
        outputUsd: 7.4,
        knownCostUsd: 0.12,
        tradeReadiness: "insufficient_data",
        dataGaps: [],
      },
      {
        routeKey: "bitcoin:0xbtc->base:0xusdc",
        amount: "5000",
        srcChain: "bitcoin",
        dstChain: "base",
        srcAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        dstAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        inputAmount: 0.00005,
        outputAmount: 3.6,
        inputUsd: 3.7,
        outputUsd: 3.6,
        knownCostUsd: 0.1,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
      },
      {
        routeKey: "bitcoin:0xbtc->base:0xusdc",
        amount: "10000",
        srcChain: "bitcoin",
        dstChain: "base",
        srcAsset: { ticker: "BTC", family: "btc", token: "0xbtc" },
        dstAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        inputAmount: 0.0001,
        outputAmount: 7.5,
        inputUsd: 7.4,
        outputUsd: 7.5,
        knownCostUsd: 0.1,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
      },
    ],
  });

  assert.equal(summary.amountLadderPairCount, 1);
  assert.equal(summary.bestAmountLadderPair.entryAmountLevelCount, 2);
  assert.equal(summary.bestAmountLadderPair.exitAmountLevelCount, 2);
  assert.equal(summary.bestAmountLadderPair.exactMatchCount, 2);
  assert.equal(summary.bestAmountLadderPair.positiveLoopCount, 1);
});

test("cross-asset arbitrage can summarize mixed stable-eth-stable loops", () => {
  const summary = buildEthCrossAssetArbitrageSummary({
    generatedAt: "2026-04-11T13:00:00.000Z",
    scores: [
      {
        routeKey: "base:0xusdc->base:0xweth",
        amount: "250000000",
        srcChain: "base",
        dstChain: "base",
        srcAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        dstAsset: { ticker: "WETH", family: "native_or_wrapped", token: "0xweth", priceKey: "ethereum" },
        inputAmount: 250,
        outputAmount: 0.1,
        inputUsd: 250,
        outputUsd: 252,
        knownCostUsd: 0.4,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
      },
      {
        routeKey: "base:0xweth->base:0xusdc",
        amount: "100000000000000000",
        srcChain: "base",
        dstChain: "base",
        srcAsset: { ticker: "WETH", family: "native_or_wrapped", token: "0xweth", priceKey: "ethereum" },
        dstAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
        inputAmount: 0.1,
        outputAmount: 255,
        inputUsd: 252,
        outputUsd: 255,
        knownCostUsd: 0.3,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
      },
    ],
  });

  assert.equal(summary.assetFamily, "eth");
  assert.equal(summary.exactAssetPairCount, 1);
  assert.equal(summary.profitableClosedLoopCount, 1);
  assert.equal(summary.bestLoop.closedLoop, true);
  assert.equal(summary.bestLoop.loopNetEdgeUsd > 0, true);
});
