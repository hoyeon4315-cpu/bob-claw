import assert from "node:assert/strict";
import { test } from "node:test";
import { ETHEREUM_WBTC_TOKEN, tokenAsset, ZERO_TOKEN } from "../src/assets/tokens.mjs";
import { ETHEREUM_L1_PHASE_DISABLED_REASON } from "../src/risk/ethereum-l1-policy.mjs";
import { scoreGatewayQuote } from "../src/scoring/gateway-score.mjs";

const USDC_ETHEREUM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

const prices = {
  btc: 50_000,
  tokenByKey: {
    btc: 50_000,
    wbtc: 50_000,
    usd_stable: 1,
    ethereum: 3_000,
  },
  nativeByChain: {
    bob: 3_000,
    base: 3_000,
    ethereum: 3_000,
  },
};

function quote(route, overrides = {}) {
  return {
    observedAt: "2026-04-10T12:00:00.000Z",
    route,
    routeKey: `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`,
    quoteType: "layerZero",
    amount: "10000",
    inputAmount: "10000",
    outputAmount: "10000",
    txValueWei: "0",
    estimatedTimeInSecs: 60,
    latencyMs: 100,
    ...overrides,
  };
}

test("scores cross-asset Gateway quotes with token-specific decimals", () => {
  const route = { srcChain: "bitcoin", dstChain: "ethereum", srcToken: ZERO_TOKEN, dstToken: USDC_ETHEREUM };
  const score = scoreGatewayQuote(
    quote(route, {
      quoteType: "onramp",
      inputAmount: "10000",
      outputAmount: "5000000",
    }),
    prices,
    {
      srcAsset: tokenAsset(route.srcChain, route.srcToken),
      dstAsset: tokenAsset(route.dstChain, route.dstToken),
      priceHaircutBps: 0,
      allowEthereumL1Routes: true,
    },
  );

  assert.equal(score.inputAmount, 0.0001);
  assert.equal(score.outputAmount, 5);
  assert.equal(score.inputUsd, 5);
  assert.equal(score.outputUsd, 5);
  assert.equal(score.netEdgeUsd, 0);
  assert.equal(score.tradeReadiness, "insufficient_data");
  assert.equal(score.dataGaps.includes("bitcoin_network_fee_not_modelled"), true);
});

test("bitcoin fee snapshot removes generic bitcoin fee gap and enters known cost", () => {
  const route = { srcChain: "bitcoin", dstChain: "ethereum", srcToken: ZERO_TOKEN, dstToken: USDC_ETHEREUM };
  const score = scoreGatewayQuote(
    quote(route, {
      quoteType: "onramp",
      inputAmount: "10000",
      outputAmount: "5000000",
    }),
    prices,
    {
      srcAsset: tokenAsset(route.srcChain, route.srcToken),
      dstAsset: tokenAsset(route.dstChain, route.dstToken),
      priceHaircutBps: 0,
      allowEthereumL1Routes: true,
      bitcoinFee: {
        observedAt: "2026-04-10T11:59:00.000Z",
        selectedFeeRateSatVb: 4,
        vbytes: 180,
        estimatedFeeSats: 720,
        estimatedFeeUsd: 0.52,
        model: "estimated_single_input_single_output",
      },
    },
  );

  assert.equal(score.dataGaps.includes("bitcoin_network_fee_not_modelled"), false);
  assert.equal(score.bitcoinFeeUsd, 0.52);
  assert.equal(score.knownCostUsd, 0.52);
  assert.equal(score.netEdgeUsd, -0.52);
  assert.equal(score.tradeReadiness, "observe_only_slow_settlement");
});

test("bridge movement with equal wrapped BTC output is rejected after gas cost", () => {
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const score = scoreGatewayQuote(quote(route), prices, {
    executionGasUsd: 0.25,
    gasObservedAt: "2026-04-10T11:59:00.000Z",
    now: "2026-04-10T12:00:00.000Z",
    priceHaircutBps: 0,
  });

  assert.equal(score.inputUsd, 5);
  assert.equal(score.outputUsd, 5);
  assert.equal(score.knownCostUsd, 0.5);
  assert.equal(score.netEdgeUsd, -0.5);
  assert.equal(score.tradeReadiness, "reject_no_net_edge");
});

test("bitcoin fee snapshot is not charged to non-native-bitcoin routes", () => {
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const score = scoreGatewayQuote(quote(route), prices, {
    executionGasUsd: 0.25,
    gasObservedAt: "2026-04-10T11:59:00.000Z",
    now: "2026-04-10T12:00:00.000Z",
    priceHaircutBps: 0,
    bitcoinFee: {
      observedAt: "2026-04-10T11:59:00.000Z",
      selectedFeeRateSatVb: 4,
      vbytes: 180,
      estimatedFeeSats: 720,
      estimatedFeeUsd: 0.52,
      model: "estimated_single_input_single_output",
    },
  });

  assert.equal(score.bitcoinFeeUsd, null);
  assert.equal(score.bitcoinFee, null);
  assert.equal(score.knownCostUsd, 0.5);
  assert.equal(score.netEdgeUsd, -0.5);
});

test("exact execution gas requirement blocks EVM candidates when only fallback gas exists", () => {
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const score = scoreGatewayQuote(
    quote(route, {
      outputAmount: "10020",
    }),
    prices,
    {
      executionGasUsd: 0.001,
      executionGasSource: "fallback_gas_units",
      requireExactExecutionGas: true,
      gasObservedAt: "2026-04-10T11:59:00.000Z",
      now: "2026-04-10T12:00:00.000Z",
      priceHaircutBps: 0,
    },
  );

  assert.equal(score.dataGaps.includes("exact_src_execution_gas_not_estimated"), true);
  assert.equal(score.tradeReadiness, "insufficient_data");
});

test("exact gas allowance reverts surface as an actionable data gap", () => {
  const route = { srcChain: "base", dstChain: "bitcoin", srcToken: USDC_BASE, dstToken: ZERO_TOKEN };
  const score = scoreGatewayQuote(
    quote(route, {
      quoteType: "offramp",
      inputAmount: "250000000",
      outputAmount: "329665",
    }),
    prices,
    {
      srcAsset: tokenAsset(route.srcChain, route.srcToken),
      dstAsset: tokenAsset(route.dstChain, route.dstToken),
      executionGasUsd: 0.01,
      executionGasSource: "fallback_gas_units",
      exactExecutionGasFailureReason: "erc20_allowance_insufficient",
      requireExactExecutionGas: true,
      bitcoinFee: {
        observedAt: "2026-04-10T11:59:00.000Z",
        selectedFeeRateSatVb: 4,
        vbytes: 180,
        estimatedFeeSats: 720,
        estimatedFeeUsd: 0.52,
        model: "estimated_single_input_single_output",
      },
    },
  );

  assert.equal(score.tradeReadiness, "insufficient_data");
  assert.equal(score.exactExecutionGasFailureReason, "erc20_allowance_insufficient");
  assert.equal(score.dataGaps.includes("exact_src_execution_gas_allowance_insufficient"), true);
  assert.equal(score.dataGaps.includes("exact_src_execution_gas_reverted"), false);
});

test("missing decimals block net edge classification", () => {
  const route = {
    srcChain: "base",
    dstChain: "bob",
    srcToken: "0x9999999999999999999999999999999999999999",
    dstToken: WBTC_OFT,
  };
  const score = scoreGatewayQuote(quote(route), prices, {
    executionGasUsd: 0.01,
    gasObservedAt: "2026-04-10T11:59:00.000Z",
    now: "2026-04-10T12:00:00.000Z",
  });

  assert.equal(score.tradeReadiness, "insufficient_data");
  assert.equal(score.dataGaps.includes("missing_src_token_decimals"), true);
  assert.equal(score.dataGaps.includes("missing_src_token_price"), true);
});

test("implausible output value ratio blocks quote hallucinations", () => {
  const route = { srcChain: "bitcoin", dstChain: "base", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT };
  const score = scoreGatewayQuote(
    quote(route, {
      quoteType: "onramp",
      inputAmount: "10000",
      outputAmount: "6358276000000",
    }),
    prices,
    {
      srcAsset: tokenAsset(route.srcChain, route.srcToken),
      dstAsset: tokenAsset(route.dstChain, route.dstToken),
      priceHaircutBps: 0,
    },
  );

  assert.equal(score.tradeReadiness, "insufficient_data");
  assert.equal(score.dataGaps.includes("implausible_quote_value_ratio"), true);
});

test("high route failure rate blocks otherwise positive candidates", () => {
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const score = scoreGatewayQuote(
    quote(route, {
      outputAmount: "10020",
    }),
    prices,
    {
      executionGasUsd: 0.001,
      gasObservedAt: "2026-04-10T11:59:00.000Z",
      now: "2026-04-10T12:00:00.000Z",
      priceHaircutBps: 0,
      routeStats: { quoteCount: 7, failureCount: 3, failureRate: 0.3 },
    },
  );

  assert.equal(score.netEdgeUsd > 0, true);
  assert.equal(score.tradeReadiness, "reject_high_failure_rate");
});

test("ethereum L1 routes stay observe-only by default until explicitly approved", () => {
  const route = { srcChain: "ethereum", dstChain: "base", srcToken: ETHEREUM_WBTC_TOKEN, dstToken: WBTC_OFT };
  const blocked = scoreGatewayQuote(
    quote(route, {
      outputAmount: "10220",
    }),
    prices,
    {
      executionGasUsd: 0.001,
      gasObservedAt: "2026-04-10T11:59:00.000Z",
      now: "2026-04-10T12:00:00.000Z",
      priceHaircutBps: 0,
      minProfitUsd: 0.1,
    },
  );
  const approved = scoreGatewayQuote(
    quote(route, {
      outputAmount: "10220",
    }),
    prices,
    {
      executionGasUsd: 0.001,
      gasObservedAt: "2026-04-10T11:59:00.000Z",
      now: "2026-04-10T12:00:00.000Z",
      priceHaircutBps: 0,
      minProfitUsd: 0.1,
      allowEthereumL1Routes: true,
    },
  );

  assert.equal(blocked.tradeReadiness, ETHEREUM_L1_PHASE_DISABLED_REASON);
  assert.equal(approved.tradeReadiness, "shadow_candidate_review_only");
});

test("DEX output quote supplies executable net edge", () => {
  const route = { srcChain: "bitcoin", dstChain: "ethereum", srcToken: ZERO_TOKEN, dstToken: USDC_ETHEREUM };
  const score = scoreGatewayQuote(
    quote(route, {
      quoteType: "onramp",
      inputAmount: "10000",
      outputAmount: "5000000",
    }),
    prices,
    {
      srcAsset: tokenAsset(route.srcChain, route.srcToken),
      dstAsset: tokenAsset(route.dstChain, route.dstToken),
      priceHaircutBps: 0,
      dexOutputQuote: {
        provider: "odos",
        observedAt: "2026-04-10T11:59:00.000Z",
        chain: "ethereum",
        outputTicker: "USDC",
        outputAmount: "4990000",
        outputValueUsd: 4.99,
        netOutputValueUsd: 4.9,
        gasEstimateValueUsd: 0.09,
        priceImpactPct: 0.01,
      },
      now: "2026-04-10T12:00:00.000Z",
    },
  );

  assert.equal(score.dex.provider, "odos");
  assert.equal(score.executableOutputUsd, 4.9);
  assert.equal(score.executableNetEdgeUsd, -0.09999999999999964);
});

test("native BTC destination uses Gateway output value as executable destination value", () => {
  const route = { srcChain: "ethereum", dstChain: "bitcoin", srcToken: USDC_ETHEREUM, dstToken: ZERO_TOKEN };
  const score = scoreGatewayQuote(
    quote(route, {
      quoteType: "offramp",
      inputAmount: "5000000",
      outputAmount: "10050",
    }),
    prices,
    {
      srcAsset: tokenAsset(route.srcChain, route.srcToken),
      dstAsset: tokenAsset(route.dstChain, route.dstToken),
      priceHaircutBps: 0,
      executionGasUsd: 0.01,
      executionGasSource: "eth_estimateGas",
      requireExactExecutionGas: true,
      bitcoinFee: {
        observedAt: "2026-04-10T11:59:00.000Z",
        selectedFeeRateSatVb: 4,
        vbytes: 180,
        estimatedFeeSats: 720,
        estimatedFeeUsd: 0.02,
        model: "estimated_single_input_single_output",
      },
    },
  );

  assert.equal(score.outputUsd, 5.025);
  assert.equal(score.executableOutputUsd, 5.025);
  assert.equal(score.executableNetEdgeUsd, -0.014999999999999646);
  assert.equal(score.dataGaps.includes("bitcoin_network_fee_not_modelled"), false);
});

test("non-BTC destinations still require a DEX output quote for executable value", () => {
  const route = { srcChain: "bitcoin", dstChain: "ethereum", srcToken: ZERO_TOKEN, dstToken: USDC_ETHEREUM };
  const score = scoreGatewayQuote(
    quote(route, {
      quoteType: "onramp",
      inputAmount: "10000",
      outputAmount: "5000000",
    }),
    prices,
    {
      srcAsset: tokenAsset(route.srcChain, route.srcToken),
      dstAsset: tokenAsset(route.dstChain, route.dstToken),
      priceHaircutBps: 0,
      bitcoinFee: {
        observedAt: "2026-04-10T11:59:00.000Z",
        selectedFeeRateSatVb: 4,
        vbytes: 180,
        estimatedFeeSats: 720,
        estimatedFeeUsd: 0.02,
        model: "estimated_single_input_single_output",
      },
      allowEthereumL1Routes: true,
    },
  );

  assert.equal(score.outputUsd, 5);
  assert.equal(score.executableOutputUsd, null);
  assert.equal(score.executableNetEdgeUsd, null);
});

test("treasury refill costs are surfaced alongside route economics", () => {
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const score = scoreGatewayQuote(
    quote(route, {
      outputAmount: "10020",
    }),
    prices,
    {
      executionGasUsd: 0.001,
      gasObservedAt: "2026-04-10T11:59:00.000Z",
      now: "2026-04-10T12:00:00.000Z",
      priceHaircutBps: 0,
      executionRefillExpectedCostUsd: 0.03,
      reserveReplenishmentExpectedCostUsd: 0.02,
      expectedFailureCostUsd: 0.01,
      capitalFragmentationDragUsd: 0.02,
      effectiveSystemNetPnlUsd: -0.072,
    },
  );

  assert.equal(score.netEdgeUsd > 0, true);
  assert.equal(score.treasuryExecutionRefillCostUsd, 0.03);
  assert.equal(score.treasuryReserveReplenishmentCostUsd, 0.02);
  assert.equal(score.expectedFailureCostUsd, 0.01);
  assert.equal(score.capitalFragmentationDragUsd, 0.02);
  assert.equal(score.treasuryAdjustedNetEdgeUsd < score.netEdgeUsd, true);
  assert.equal(score.treasuryAdjustedExecutableNetEdgeUsd, null);
  assert.equal(score.effectiveSystemKnownCostUsd > score.treasuryAdjustedKnownCostUsd, true);
  assert.equal(score.effectiveSystemNetPnlUsd, -0.072);
  assert.equal(score.effectiveSystemBreakEvenPct > score.treasuryAdjustedBreakEvenPct, true);
  assert.equal(score.tradeReadiness, "reject_no_net_edge");
});
