import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import {
  buildWholeWalletRouteFundingPlan,
  estimateRecommendationProbeAmount,
  probeWholeWalletFundingRecommendations,
} from "../src/treasury/whole-wallet-route-funding.mjs";

test("whole-wallet route funding prefers same-chain same-family assets for missing route token", () => {
  const plan = buildWholeWalletRouteFundingPlan({
    scan: {
      native: [
        { chain: "base", token: "0x0000000000000000000000000000000000000000", ticker: "ETH", family: "native_or_wrapped", actualDecimal: 0.0001, estimatedUsd: 0.25 },
        { chain: "bob", token: "0x0000000000000000000000000000000000000000", ticker: "ETH", family: "native_or_wrapped", actualDecimal: 0.003, estimatedUsd: 7.2 },
      ],
      tokenBalances: [
        { chain: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", ticker: "cbBTC", family: "wrapped_btc", actualDecimal: 0.00018, estimatedUsd: 14 },
        { chain: "avalanche", token: WBTC_OFT_TOKEN, ticker: "wBTC.OFT", family: "wrapped_btc", actualDecimal: 0.0001, estimatedUsd: 7.8 },
      ],
    },
    readiness: {
      routeKey: "base:0x0555->ethereum:0x2260",
      amount: "10000",
      srcChain: "base",
      srcToken: WBTC_OFT_TOKEN,
      srcTicker: "wBTC.OFT",
      overallReady: false,
      native: { shortfallWei: "362368415018076" },
      token: { shortfall: "8756" },
    },
  });

  assert.equal(plan.status, "route_funding_required");
  assert.equal(plan.recommendations.tokenTopUps[0].ticker, "cbBTC");
  assert.equal(plan.recommendations.tokenTopUps[0].method, "same_chain_token_swap");
  assert.equal(plan.recommendations.nativeTopUps[0].ticker, "cbBTC");
  assert.equal(plan.recommendations.nativeTopUps[0].method, "same_chain_token_to_native_swap");
});

test("whole-wallet route funding reports already-ready route cleanly", () => {
  const plan = buildWholeWalletRouteFundingPlan({
    scan: {
      native: [],
      tokenBalances: [],
    },
    readiness: {
      routeKey: "avalanche:0x0555->ethereum:0x2260",
      amount: "10000",
      srcChain: "avalanche",
      srcToken: WBTC_OFT_TOKEN,
      srcTicker: "wBTC.OFT",
      overallReady: true,
      native: { shortfallWei: "0" },
      token: { shortfall: "0" },
    },
  });

  assert.equal(plan.status, "already_ready");
  assert.equal(plan.recommendations.nativeTopUps.length, 0);
  assert.equal(plan.recommendations.tokenTopUps.length, 0);
});

test("whole-wallet probe amount reuses token shortfall for same-family swap", () => {
  const plan = buildWholeWalletRouteFundingPlan({
    scan: {
      native: [
        { chain: "base", token: "0x0000000000000000000000000000000000000000", ticker: "ETH", family: "native_or_wrapped", actualDecimal: 0.0001, estimatedUsd: 0.25 },
      ],
      tokenBalances: [
        { chain: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", ticker: "cbBTC", family: "wrapped_btc", actualDecimal: 0.00018, estimatedUsd: 14 },
      ],
    },
    readiness: {
      routeKey: "base:0x0555->ethereum:0x2260",
      amount: "10000",
      srcChain: "base",
      srcToken: WBTC_OFT_TOKEN,
      srcTicker: "wBTC.OFT",
      overallReady: false,
      native: { shortfallWei: "362368415018076" },
      token: { shortfall: "8756" },
    },
  });

  const tokenAmount = estimateRecommendationProbeAmount({
    plan,
    recommendation: plan.recommendations.tokenTopUps[0],
    category: "token",
  });
  const nativeAmount = estimateRecommendationProbeAmount({
    plan,
    recommendation: plan.recommendations.nativeTopUps[0],
    category: "native",
  });

  assert.equal(tokenAmount, "8756");
  assert.equal(nativeAmount, "1282");
});

test("whole-wallet funding probe captures live preview mismatches", async () => {
  const plan = buildWholeWalletRouteFundingPlan({
    scan: {
      native: [
        { chain: "base", token: "0x0000000000000000000000000000000000000000", ticker: "ETH", family: "native_or_wrapped", actualDecimal: 0.0001, estimatedUsd: 0.25 },
      ],
      tokenBalances: [
        { chain: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", ticker: "cbBTC", family: "wrapped_btc", actualDecimal: 0.00018, estimatedUsd: 14 },
      ],
    },
    readiness: {
      routeKey: "base:0x0555->ethereum:0x2260",
      amount: "10000",
      srcChain: "base",
      srcToken: WBTC_OFT_TOKEN,
      srcTicker: "wBTC.OFT",
      overallReady: false,
      native: { shortfallWei: "362368415018076" },
      token: { shortfall: "8756" },
    },
  });

  const livePreview = await probeWholeWalletFundingRecommendations({
    plan,
    senderAddress: "0x1111111111111111111111111111111111111111",
    buildTokenDexPlanImpl: async ({ outputToken }) => ({
      planStatus: outputToken === WBTC_OFT_TOKEN ? "blocked" : "ready",
      blockedReason: outputToken === WBTC_OFT_TOKEN ? "odos_quote_failed" : null,
      quote: outputToken === WBTC_OFT_TOKEN ? null : { outputAmount: "400000000000000", outputValueUsd: 1.0, gasEstimateValueUsd: 0.003, observedAt: "2026-04-18T03:00:00.000Z", pathId: "path-1" },
      minimumOutputAmount: outputToken === WBTC_OFT_TOKEN ? null : "398000000000000",
    }),
  });

  assert.equal(livePreview.tokenProbe.status, "blocked");
  assert.equal(livePreview.tokenProbe.blockedReason, "odos_quote_failed");
  assert.equal(livePreview.nativeProbe.status, "ready");
  assert.equal(livePreview.nativeProbe.coversShortfall, true);
});
