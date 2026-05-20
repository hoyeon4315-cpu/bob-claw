import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDexGatewayArbitrageSummary,
  buildEthGatewayArbitrageSummary,
  buildGoldGatewayArbitrageSummary,
  buildMultiFamilyGatewayArbitrageSummary,
  buildStableGatewayArbitrageSummary,
} from "../src/strategy/dex-gateway-arbitrage.mjs";
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
  assert.equal(
    summary.loops.some((item) => item.blockers.includes("missing_source_entry_quote")),
    true,
  );
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
          tradeReadiness: "ethereum_l1_policy_override_disabled",
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
  assert.equal(summary.closestLoop.blockers.includes("gateway_ethereum_l1_policy_override_disabled"), true);
});

test("gold-gateway arbitrage measures BTC<->XAUT loop with identical full-cost formula", () => {
  const summary = buildGoldGatewayArbitrageSummary({
    scoreSnapshot: {
      generatedAt: "2026-05-20T12:00:00.000Z",
      scores: [
        {
          routeKey: "bitcoin:0x0->ethereum:0x68749665",
          amount: "100000",
          srcChain: "bitcoin",
          dstChain: "ethereum",
          srcAsset: { ticker: "BTC", family: "btc", decimals: 8 },
          dstAsset: { ticker: "XAUT", family: "other", decimals: 6, priceKey: "xaut" },
          inputAmount: 0.001,
          executableOutputUsd: 9.2,
          knownCostUsd: 0.25,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0.02 },
        },
      ],
    },
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-05-20T12:00:01.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        gatewayRouteKey: "bitcoin:0x0->ethereum:0x68749665",
        gatewayAmount: "100000",
        inputValueUsd: 8.5,
        gasEstimateValueUsd: 0.03,
        outputAmount: "100000",
      }),
    ],
  });

  assert.equal(summary.routeCount, 1);
  assert.equal(summary.entryQuoteCount, 1);
  assert.equal(summary.exactAmountMatchCount, 1);
  assert.equal(summary.bestLoop.routeKey, "bitcoin:0x0->ethereum:0x68749665");
  // 9.2 - 8.5 - 0.25 - 0.03 == 0.42
  assert.ok(Math.abs(summary.bestLoop.measuredLoopNetUsd - 0.42) < 1e-9);
});

test("stable-gateway arbitrage measures BTC<->oUSDT loop with identical full-cost formula", () => {
  const summary = buildStableGatewayArbitrageSummary({
    scoreSnapshot: {
      generatedAt: "2026-05-20T12:00:00.000Z",
      scores: [
        {
          routeKey: "bitcoin:0x0->base:0x1217BfE6",
          amount: "100000",
          srcChain: "bitcoin",
          dstChain: "base",
          srcAsset: { ticker: "BTC", family: "btc", decimals: 8 },
          dstAsset: { ticker: "oUSDT", family: "stablecoin", decimals: 6, priceKey: "usd_stable" },
          inputAmount: 0.001,
          executableOutputUsd: 9.0,
          knownCostUsd: 0.2,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-05-20T12:00:01.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        gatewayRouteKey: "bitcoin:0x0->base:0x1217BfE6",
        gatewayAmount: "100000",
        inputValueUsd: 8.4,
        gasEstimateValueUsd: 0.02,
        outputAmount: "100000",
      }),
    ],
  });

  assert.equal(summary.routeCount, 1);
  assert.equal(summary.bestLoop.routeKey, "bitcoin:0x0->base:0x1217BfE6");
  // 9.0 - 8.4 - 0.2 - 0.02 == 0.38
  assert.ok(Math.abs(summary.bestLoop.measuredLoopNetUsd - 0.38) < 1e-9);
});

test("gold and stable scanners emit identical blocker codes when entry quote is missing", () => {
  const baseInput = {
    scoreSnapshot: {
      generatedAt: "2026-05-20T12:00:00.000Z",
      scores: [
        {
          routeKey: "bitcoin:0x0->ethereum:0x68749665",
          amount: "100000",
          srcChain: "bitcoin",
          dstChain: "ethereum",
          srcAsset: { ticker: "BTC", family: "btc", decimals: 8 },
          dstAsset: { ticker: "XAUT", family: "other", decimals: 6, priceKey: "xaut" },
          inputAmount: 0.001,
          executableOutputUsd: null,
          knownCostUsd: 0.25,
          tradeReadiness: "insufficient_data",
          dataGaps: ["stale_src_gas_snapshot"],
          routeStats: { failureRate: 0.02 },
        },
        {
          routeKey: "bitcoin:0x0->base:0x1217BfE6",
          amount: "100000",
          srcChain: "bitcoin",
          dstChain: "base",
          srcAsset: { ticker: "BTC", family: "btc", decimals: 8 },
          dstAsset: { ticker: "oUSDT", family: "stablecoin", decimals: 6, priceKey: "usd_stable" },
          inputAmount: 0.001,
          executableOutputUsd: null,
          knownCostUsd: 0.2,
          tradeReadiness: "insufficient_data",
          dataGaps: ["stale_src_gas_snapshot"],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
    dexQuotes: [],
  };

  const goldSummary = buildGoldGatewayArbitrageSummary(baseInput);
  const stableSummary = buildStableGatewayArbitrageSummary(baseInput);

  for (const summary of [goldSummary, stableSummary]) {
    assert.equal(summary.bestLoop, null);
    const loop = summary.closestLoop;
    assert.ok(loop.blockers.includes("missing_source_entry_quote"));
    assert.ok(loop.blockers.includes("missing_destination_exit_quote"));
    assert.ok(loop.blockers.includes("gateway_stale_src_gas_snapshot"));
  }
});

test("multi-family arbitrage summary emits one row per requested family with same cost columns", () => {
  const scoreSnapshot = {
    generatedAt: "2026-05-20T12:00:00.000Z",
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
      {
        routeKey: "bitcoin:0x0->ethereum:0x68749665",
        amount: "100000",
        srcChain: "bitcoin",
        dstChain: "ethereum",
        srcAsset: { ticker: "BTC", family: "btc", decimals: 8 },
        dstAsset: { ticker: "XAUT", family: "other", decimals: 6, priceKey: "xaut" },
        inputAmount: 0.001,
        executableOutputUsd: 9.2,
        knownCostUsd: 0.25,
        tradeReadiness: "reject_no_net_edge",
        dataGaps: [],
        routeStats: { failureRate: 0.02 },
      },
      {
        routeKey: "bitcoin:0x0->base:0x1217BfE6",
        amount: "100000",
        srcChain: "bitcoin",
        dstChain: "base",
        srcAsset: { ticker: "BTC", family: "btc", decimals: 8 },
        dstAsset: { ticker: "oUSDT", family: "stablecoin", decimals: 6, priceKey: "usd_stable" },
        inputAmount: 0.001,
        executableOutputUsd: 9.0,
        knownCostUsd: 0.2,
        tradeReadiness: "reject_no_net_edge",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
    ],
  };

  const dexQuotes = [
    trustedOdosQuote({
      observedAt: "2026-05-20T12:00:01.000Z",
      source: "gateway_src_entry_leg",
      chain: "base",
      gatewayRouteKey: "base:0xwbtc->bob:0xwbtc",
      gatewayAmount: "10000",
      inputValueUsd: 7.5,
      gasEstimateValueUsd: 0.02,
      outputAmount: "10000",
    }),
    trustedOdosQuote({
      observedAt: "2026-05-20T12:00:01.000Z",
      source: "gateway_src_entry_leg",
      chain: "base",
      gatewayRouteKey: "bitcoin:0x0->ethereum:0x68749665",
      gatewayAmount: "100000",
      inputValueUsd: 8.5,
      gasEstimateValueUsd: 0.03,
      outputAmount: "100000",
    }),
    trustedOdosQuote({
      observedAt: "2026-05-20T12:00:01.000Z",
      source: "gateway_src_entry_leg",
      chain: "base",
      gatewayRouteKey: "bitcoin:0x0->base:0x1217BfE6",
      gatewayAmount: "100000",
      inputValueUsd: 8.4,
      gasEstimateValueUsd: 0.02,
      outputAmount: "100000",
    }),
  ];

  const summary = buildMultiFamilyGatewayArbitrageSummary({ scoreSnapshot, dexQuotes });

  assert.deepEqual(summary.requestedFamilies, ["wbtc", "stable", "gold"]);
  assert.equal(summary.families.length, 3);
  const byFamily = new Map(summary.families.map((row) => [row.family, row]));
  for (const family of ["wbtc", "stable", "gold"]) {
    assert.ok(byFamily.has(family), `family ${family} missing`);
    const row = byFamily.get(family);
    assert.equal(row.routeCount, 1, `${family} routeCount`);
    assert.equal(row.exactAmountMatchCount, 1, `${family} exactAmountMatchCount`);
    assert.ok(Number.isFinite(row.bestLoop?.measuredLoopNetUsd), `${family} measuredLoopNetUsd present`);
  }
  assert.equal(
    summary.families[0].bestLoop.measuredLoopNetUsd >= summary.families[2].bestLoop.measuredLoopNetUsd,
    true,
  );
});
