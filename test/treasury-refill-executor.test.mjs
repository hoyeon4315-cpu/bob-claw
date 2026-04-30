import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN, ZERO_TOKEN } from "../src/assets/tokens.mjs";
import {
  buildTreasuryRefillExecutionPlan,
  executeTreasuryRefillExecutionPlan,
  refillExecutorForJob,
} from "../src/executor/helpers/treasury-refill-job.mjs";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function nativeRefillJob(overrides = {}) {
  return {
    jobId: "job-native",
    type: "refill_native",
    chain: "soneium",
    asset: "ETH",
    token: ZERO_TOKEN,
    targetAmount: "1000000000000000",
    targetAmountDecimal: 0.001,
    estimatedAssetValueUsd: 2.2,
    executionMethod: "same_chain_token_to_native_swap",
    fundingSource: {
      source: {
        chain: "soneium",
        token: WBTC_OFT_TOKEN,
        ticker: "wBTC.OFT",
        actual: "25000",
        actualDecimal: 0.00025,
        estimatedUsd: 18.5,
      },
    },
    ...overrides,
  };
}

test("treasury refill executor builds same-chain token-to-native refill preview", async () => {
  let capturedInput = null;
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob(),
    senderAddress: ADDRESS,
    buildTokenDexPlanImpl: async (input) => {
      capturedInput = input;
      return {
      schemaVersion: 1,
      observedAt: "2026-04-19T00:00:00.000Z",
      planStatus: "ready",
      strategyId: input.strategyId,
      chain: input.chain,
      senderAddress: input.senderAddress,
      inputToken: input.inputToken,
      outputToken: ZERO_TOKEN,
      outputAsset: { ticker: "ETH" },
      amount: input.amount,
      amountUsd: 2.42,
      minimumOutputAmount: "1100000000000000",
      quote: { outputAmount: "1110000000000000" },
      steps: [{ id: "approve_input_token" }, { id: "swap_input_to_output" }, { id: "unwrap_wrapped_native" }],
    };
    },
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "token_dex_experiment");
  assert.equal(capturedInput.strategyId, "native-gas-refill");
  assert.equal(preparation.plan.strategyId, "native-gas-refill");
  assert.equal(preparation.plan.inputToken, WBTC_OFT_TOKEN);
  assert.equal(preparation.plan.outputToken, ZERO_TOKEN);
  assert.equal(preparation.plan.amount, "3271");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor blocks same-chain token-to-native refill when native gas bootstrap is insufficient", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob({
      chain: "ethereum",
      destinationNativeDecimal: 0.0001,
    }),
    senderAddress: ADDRESS,
    destinationNativeDecimal: 0.0001,
    buildTokenDexPlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-27T00:00:00.000Z",
      planStatus: "ready",
      strategyId: "token-dex-experiment",
      chain: input.chain,
      senderAddress: input.senderAddress,
      inputToken: input.inputToken,
      outputToken: ZERO_TOKEN,
      outputAsset: { ticker: "ETH" },
      amount: input.amount,
      amountUsd: 21.29,
      gasSnapshot: {
        gasPriceWei: "648013032",
        baseFeeWei: "647913032",
        priorityFeeWei: "100000",
      },
      minimumOutputAmount: "8863907018569562",
      quote: { outputAmount: "8908449264894033" },
      steps: [
        { id: "reset_input_allowance", intent: { tx: { gasLimit: "120000" } } },
        { id: "approve_input_token", intent: { tx: { gasLimit: "120000" } } },
        { id: "swap_input_to_output", intent: { tx: { gasLimit: "511104" } } },
        { id: "unwrap_wrapped_native", intent: { tx: { gasLimit: "60000" } } },
      ],
    }),
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.executor, "token_dex_experiment");
  assert.equal(preparation.blockedReason, "insufficient_native_gas_balance");
});

test("treasury refill executor maps cross-chain BTC-family native refill to Gateway consolidation with gas refill", async () => {
  let capturedInput = null;
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob({
      executionMethod: "cross_chain_bridge_or_swap",
      fundingSource: {
        source: {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          actual: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      },
    }),
    senderAddress: ADDRESS,
    buildGatewayBtcPlanImpl: async (input) => {
      capturedInput = input;
      return {
        schemaVersion: 1,
        observedAt: "2026-04-20T00:00:00.000Z",
        planStatus: "ready",
        strategyId: "gateway-btc-funding-transfer",
        route: {
          srcChain: input.srcChain,
          dstChain: input.dstChain,
          srcToken: input.srcToken,
          dstToken: input.dstToken,
        },
        amount: input.amount,
        gasRefill: input.gasRefill,
        amountUsd: 2.42,
        quote: {
          outputAmount: { amount: "900" },
          gasRefill: input.gasRefill,
        },
        gasPreflight: { gasUnits: 100000 },
        intent: { strategyId: "gateway-btc-funding-transfer" },
      };
    },
  });

  assert.equal(refillExecutorForJob({
    executionMethod: "cross_chain_bridge_or_swap",
    type: "refill_native",
    fundingSource: { source: { chain: "base", token: WBTC_OFT_TOKEN } },
  }), "gateway_btc_consolidation");
  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "gateway_btc_consolidation");
  assert.equal(capturedInput.dstToken, WBTC_OFT_TOKEN);
  assert.equal(capturedInput.gasRefill, "1000000000000000");
  assert.equal(preparation.plan.gasRefill, "1000000000000000");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor maps bitcoin-funded native refill to Gateway onramp with gas refill", async () => {
  let capturedInput = null;
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob({
      executionMethod: "cross_chain_bridge_or_swap",
      fundingSource: {
        source: {
          chain: "bitcoin",
          token: ZERO_TOKEN,
          ticker: "BTC",
          actual: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      },
    }),
    senderAddress: ADDRESS,
    bitcoinSenderAddress: "bc1qsource000000000000000000000000000000000",
    buildGatewayBtcOnrampPlanImpl: async (input) => {
      capturedInput = input;
      return {
      schemaVersion: 1,
      observedAt: "2026-04-20T00:00:00.000Z",
      planStatus: "ready",
      strategyId: "gateway-btc-onramp",
      senderAddress: input.senderAddress,
      recipient: input.recipient,
      dstChain: input.dstChain,
      dstToken: input.dstToken,
      amountSats: input.amountSats,
      gasRefill: input.gasRefill,
      quote: { outputAmount: { amount: "1000" } },
      intent: { strategyId: "gateway-btc-onramp" },
      };
    },
  });

  assert.equal(refillExecutorForJob({
    executionMethod: "cross_chain_bridge_or_swap",
    type: "refill_native",
    fundingSource: { source: { chain: "bitcoin" } },
  }), "gateway_btc_onramp");
  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "gateway_btc_onramp");
  assert.equal(preparation.plan.senderAddress, "bc1qsource000000000000000000000000000000000");
  assert.equal(preparation.plan.recipient, ADDRESS);
  assert.equal(preparation.plan.dstToken, WBTC_OFT_TOKEN);
  assert.equal(capturedInput.amountSats, "5000");
  assert.equal(preparation.plan.gasRefill, "1000000000000000");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor maps bitcoin-funded token refill to Gateway onramp", async () => {
  let capturedInput = null;
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-token-bitcoin-source",
      type: "refill_token",
      chain: "base",
      asset: "wBTC.OFT",
      token: WBTC_OFT_TOKEN,
      targetAmount: "9000",
      targetAmountDecimal: 0.00009,
      estimatedAssetValueUsd: 6.98,
      executionMethod: "cross_chain_bridge_or_swap",
      fundingSource: {
        source: {
          chain: "bitcoin",
          token: ZERO_TOKEN,
          ticker: "BTC",
          actual: "45799",
          actualDecimal: 0.00045799,
          estimatedUsd: 35.51,
        },
      },
    },
    senderAddress: ADDRESS,
    bitcoinSenderAddress: "bc1qsource000000000000000000000000000000000",
    buildGatewayBtcOnrampPlanImpl: async (input) => {
      capturedInput = input;
      return {
        schemaVersion: 1,
        observedAt: "2026-04-25T00:00:00.000Z",
        planStatus: "ready",
        strategyId: "gateway-btc-onramp",
        senderAddress: input.senderAddress,
        recipient: input.recipient,
        dstChain: input.dstChain,
        dstToken: input.dstToken,
        amountSats: input.amountSats,
        gasRefill: input.gasRefill,
        quote: { outputAmount: { amount: "9000" } },
        intent: { strategyId: "gateway-btc-onramp" },
      };
    },
  });

  assert.equal(refillExecutorForJob({
    executionMethod: "cross_chain_bridge_or_swap",
    type: "refill_token",
    fundingSource: { source: { chain: "bitcoin" } },
  }), "gateway_btc_onramp");
  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "gateway_btc_onramp");
  assert.equal(capturedInput.dstToken, WBTC_OFT_TOKEN);
  assert.equal(capturedInput.gasRefill, null);
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor blocks gateway onramp native refill when bitcoin source is below gateway minimum", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob({
      executionMethod: "cross_chain_bridge_or_swap",
      fundingSource: {
        source: {
          chain: "bitcoin",
          token: ZERO_TOKEN,
          ticker: "BTC",
          actual: "4000",
          actualDecimal: 0.00004,
          estimatedUsd: 3,
        },
      },
    }),
    senderAddress: ADDRESS,
    bitcoinSenderAddress: "bc1qsource000000000000000000000000000000000",
    buildGatewayBtcOnrampPlanImpl: async () => {
      throw new Error("builder must not run below minimum");
    },
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.executor, "gateway_btc_onramp");
  assert.equal(preparation.blockedReason, "source_inventory_below_gateway_minimum");
});

test("treasury refill executor maps BTC-family cross-chain token refill to Gateway consolidation", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-token",
      type: "refill_token",
      chain: "bob",
      asset: "wBTC.OFT",
      token: WBTC_OFT_TOKEN,
      targetAmount: "10000",
      targetAmountDecimal: 0.0001,
      estimatedAssetValueUsd: 7.4,
      executionMethod: "cross_chain_bridge_or_swap",
      fundingSource: {
        source: {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          actual: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      },
    },
    senderAddress: ADDRESS,
    buildGatewayBtcPlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-19T00:00:00.000Z",
      planStatus: "ready",
      strategyId: "gateway-btc-funding-transfer",
      route: {
        srcChain: input.srcChain,
        dstChain: input.dstChain,
        srcToken: input.srcToken,
        dstToken: input.dstToken,
      },
      amount: input.amount,
      amountUsd: 7.4,
      quote: { outputAmount: { amount: "10000" } },
      gasPreflight: { gasUnits: 100000 },
      intent: { strategyId: "gateway-btc-funding-transfer" },
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "gateway_btc_consolidation");
  assert.equal(preparation.plan.route.srcChain, "base");
  assert.equal(preparation.plan.route.dstChain, "bob");
  assert.equal(preparation.plan.amount, "10000");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor blocks bridge execution when quote cost exceeds discretionary ceiling", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob({
      executionMethod: "cross_chain_bridge_lifi",
      fundingSource: {
        expectedExecutionRefillCostUsd: 1.6,
        source: {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          actual: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      },
    }),
    senderAddress: ADDRESS,
    buildLifiBridgePlanImpl: async () => ({
      planStatus: "ready",
      minimumOutputAmount: "1000000000000000",
      expectedOutputAmount: "1000000000000000",
    }),
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.blockedReason, "bridge_quote_cost_above_discretionary_ceiling");
});

test("treasury refill executor allows explicit live override for bridge quote ceiling", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob({
      executionMethod: "cross_chain_bridge_lifi",
      liveInventoryDependencyOverride: true,
      fundingSource: {
        expectedExecutionRefillCostUsd: 1.25,
        source: {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          actual: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      },
    }),
    senderAddress: ADDRESS,
    buildLifiBridgePlanImpl: async () => ({
      planStatus: "ready",
      minimumOutputAmount: "1000000000000000",
      expectedOutputAmount: "1000000000000000",
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.discretionaryBudget.bypassed, true);
});

test("treasury refill executor bypasses new movement ceilings for strategy_realized_pnl jobs", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob({
      executionMethod: "cross_chain_bridge_lifi",
      classification: "strategy_realized_pnl",
      fundingSource: {
        expectedExecutionRefillCostUsd: 1.25,
        source: {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          actual: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      },
    }),
    senderAddress: ADDRESS,
    buildLifiBridgePlanImpl: async () => ({
      planStatus: "ready",
      minimumOutputAmount: "1000000000000000",
      expectedOutputAmount: "1000000000000000",
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.discretionaryBudget.bypassed, true);
});

test("treasury refill executor dispatches ready preparation to the selected executor", async () => {
  const execution = await executeTreasuryRefillExecutionPlan({
    preparation: {
      status: "ready",
      executor: "native_dex_experiment",
      plan: { planStatus: "ready", marker: "native" },
    },
    executeNativeDexPlanImpl: async ({ plan }) => ({ settlementStatus: "delivered", plan }),
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.plan.marker, "native");
});

test("treasury refill executor dispatches Gateway onramp preparations", async () => {
  const execution = await executeTreasuryRefillExecutionPlan({
    preparation: {
      status: "ready",
      executor: "gateway_btc_onramp",
      plan: { planStatus: "ready", marker: "onramp" },
    },
    executeGatewayBtcOnrampPlanImpl: async ({ plan }) => ({ settlementStatus: "delivered", plan }),
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.plan.marker, "onramp");
});

test("treasury refill executor dispatches Across bridge preparations", async () => {
  const execution = await executeTreasuryRefillExecutionPlan({
    preparation: {
      status: "ready",
      executor: "across_bridge",
      plan: { planStatus: "ready", marker: "across" },
    },
    executeAcrossBridgePlanImpl: async ({ plan }) => ({ settlementStatus: "delivered", plan }),
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.plan.marker, "across");
});

test("treasury refill executor builds verified Across token refill preview", async () => {
  let capturedInput = null;
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-across-base-optimism",
      type: "refill_token",
      chain: "optimism",
      asset: "USDC",
      token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      targetAmount: "1000000",
      targetAmountDecimal: 1,
      estimatedAssetValueUsd: 1,
      executionMethod: "cross_chain_bridge_across",
      fundingSource: {
        source: {
          chain: "base",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "1580760",
          actualDecimal: 1.58076,
          estimatedUsd: 1.58,
        },
      },
    },
    senderAddress: ADDRESS,
    buildAcrossBridgePlanImpl: async (input) => {
      capturedInput = input;
      return {
        schemaVersion: 1,
        observedAt: "2026-04-24T00:00:00.000Z",
        planStatus: "ready",
        strategyId: "across-bridge",
        srcChain: input.srcChain,
        dstChain: input.dstChain,
        ticker: input.ticker,
        senderAddress: input.senderAddress,
        recipient: input.recipient,
        amount: input.amount,
        amountUsd: 1,
        quote: { outputAmount: "1000000" },
        gasPreflight: { gasUnits: 100000 },
        intent: { strategyId: "across-bridge" },
        steps: [{ id: "approve_across_spokepool" }, { id: "across_deposit_v3" }],
      };
    },
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "across_bridge");
  assert.equal(preparation.coverage.coversTarget, true);
  assert.equal(capturedInput.srcChain, "base");
  assert.equal(capturedInput.dstChain, "optimism");
  assert.equal(capturedInput.ticker, "usdc");
  assert.equal(capturedInput.amount, "1000000");
});

test("treasury refill executor blocks unsupported Across source before builder", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-across-bsc-base",
      type: "refill_token",
      chain: "base",
      asset: "USDC",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      targetAmount: "1000000",
      targetAmountDecimal: 1,
      estimatedAssetValueUsd: 1,
      executionMethod: "cross_chain_bridge_across",
      fundingSource: {
        source: {
          chain: "bsc",
          token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
          actual: "5000000000000000000",
          actualDecimal: 5,
          estimatedUsd: 5,
        },
      },
    },
    senderAddress: ADDRESS,
    buildAcrossBridgePlanImpl: async () => {
      throw new Error("Across builder must not run for unsupported source");
    },
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.executor, "across_bridge");
  assert.equal(preparation.blockedReason, "across_ticker_unsupported");
});

test("treasury refill executor maps cross-chain intermediate swap to composite plan", async () => {
  assert.equal(refillExecutorForJob({
    executionMethod: "cross_chain_swap_via_btc_intermediate",
  }), "cross_chain_btc_intermediate");

  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-intermediate",
      type: "refill_token",
      chain: "base",
      asset: "wBTC.OFT",
      token: WBTC_OFT_TOKEN,
      targetAmount: "10000",
      targetAmountDecimal: 0.0001,
      estimatedAssetValueUsd: 7.4,
      executionMethod: "cross_chain_swap_via_btc_intermediate",
      fundingSource: {
        source: {
          chain: "bsc",
          token: "0x55d398326f99059fF775485246999027B3197955",
          actual: "3000000000000000000",
          actualDecimal: 300,
          estimatedUsd: 300,
        },
      },
    },
    senderAddress: ADDRESS,
    buildTokenDexPlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-19T00:00:00.000Z",
      planStatus: "ready",
      strategyId: "token-dex-experiment",
      chain: input.chain,
      senderAddress: input.senderAddress,
      inputToken: input.inputToken,
      outputToken: WBTC_OFT_TOKEN,
      outputAsset: { ticker: "wBTC.OFT" },
      amount: input.amount,
      minimumOutputAmount: "9500",
      steps: [{ id: "swap" }],
    }),
    buildGatewayBtcPlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-19T00:00:00.000Z",
      planStatus: "ready",
      strategyId: "gateway-btc-funding-transfer",
      route: {
        srcChain: input.srcChain,
        dstChain: input.dstChain,
        srcToken: input.srcToken,
        dstToken: input.dstToken,
      },
      amount: input.amount,
      amountUsd: 7.4,
      quote: { outputAmount: { amount: "10000" } },
      gasPreflight: { gasUnits: 100000 },
      intent: { strategyId: "gateway-btc-funding-transfer" },
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "cross_chain_btc_intermediate");
  assert.equal(preparation.plan.step1.type, "dex_swap");
  assert.equal(preparation.plan.step1.plan.chain, "bsc");
  assert.equal(preparation.plan.step2.type, "gateway_consolidation");
  assert.equal(preparation.plan.step2.plan.route.srcChain, "bsc");
  assert.equal(preparation.plan.step2.plan.route.dstChain, "base");
  assert.equal(preparation.plan.step2.plan.amount, "9500");
  assert.equal(preparation.coverage.coversTarget !== false, true);
});

test("treasury refill executor builds BSC USDT to Base USDC composite refill preview", async () => {
  let dexInput = null;
  let gatewayInput = null;
  const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const bscUsdt = "0x55d398326f99059fF775485246999027B3197955";
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-bsc-usdt-base-usdc",
      type: "refill_token",
      chain: "base",
      asset: "USDC",
      token: baseUsdc,
      targetAmount: "1000000",
      targetAmountDecimal: 1,
      estimatedAssetValueUsd: 1,
      executionMethod: "cross_chain_swap_via_btc_intermediate",
      fundingSource: {
        source: {
          chain: "bsc",
          token: bscUsdt,
          actual: "300000000000000000000",
          actualDecimal: 300,
          estimatedUsd: 300,
        },
      },
    },
    senderAddress: ADDRESS,
    buildTokenDexPlanImpl: async (input) => {
      dexInput = input;
      return {
        schemaVersion: 1,
        observedAt: "2026-04-24T00:00:00.000Z",
        planStatus: "ready",
        strategyId: "token-dex-experiment",
        chain: input.chain,
        senderAddress: input.senderAddress,
        inputToken: input.inputToken,
        outputToken: WBTC_OFT_TOKEN,
        amount: input.amount,
        minimumOutputAmount: "1500",
        steps: [{ id: "swap" }],
      };
    },
    buildGatewayBtcPlanImpl: async (input) => {
      gatewayInput = input;
      return {
        schemaVersion: 1,
        observedAt: "2026-04-24T00:00:00.000Z",
        planStatus: "ready",
        strategyId: "gateway-btc-funding-transfer",
        route: {
          srcChain: input.srcChain,
          dstChain: input.dstChain,
          srcToken: input.srcToken,
          dstToken: input.dstToken,
        },
        amount: input.amount,
        amountUsd: 1,
        quote: { outputAmount: { amount: "1000000" } },
        gasPreflight: { gasUnits: 100000 },
        intent: { strategyId: "gateway-btc-funding-transfer" },
      };
    },
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "cross_chain_btc_intermediate");
  assert.equal(dexInput.chain, "bsc");
  assert.equal(dexInput.inputToken, bscUsdt);
  assert.equal(dexInput.outputToken, "wbtc.oft");
  assert.equal(gatewayInput.srcChain, "bsc");
  assert.equal(gatewayInput.dstChain, "base");
  assert.equal(gatewayInput.dstToken, baseUsdc);
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor falls back to destination DEX when Gateway lacks stablecoin route", async () => {
  const gatewayCalls = [];
  const dexCalls = [];
  const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const bscUsdt = "0x55d398326f99059fF775485246999027B3197955";
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-bsc-usdt-base-usdc-fallback",
      type: "refill_token",
      chain: "base",
      asset: "USDC",
      token: baseUsdc,
      targetAmount: "68000000",
      targetAmountDecimal: 68,
      estimatedAssetValueUsd: 68,
      executionMethod: "cross_chain_swap_via_btc_intermediate",
      fundingSource: {
        source: {
          chain: "bsc",
          token: bscUsdt,
          actual: "300000000000000000000",
          actualDecimal: 300,
          estimatedUsd: 300,
        },
      },
    },
    senderAddress: ADDRESS,
    buildTokenDexPlanImpl: async (input) => {
      dexCalls.push(input);
      if (input.chain === "bsc") {
        return {
          schemaVersion: 1,
          observedAt: "2026-04-24T00:00:00.000Z",
          planStatus: "ready",
          chain: input.chain,
          inputToken: input.inputToken,
          outputToken: WBTC_OFT_TOKEN,
          amount: input.amount,
          minimumOutputAmount: "95000",
          steps: [{ id: "source_swap" }],
        };
      }
      return {
        schemaVersion: 1,
        observedAt: "2026-04-24T00:00:00.000Z",
        planStatus: "ready",
        chain: input.chain,
        inputToken: input.inputToken,
        outputToken: input.outputToken,
        amount: input.amount,
        minimumOutputAmount: "68100000",
        steps: [{ id: "destination_swap" }],
      };
    },
    buildGatewayBtcPlanImpl: async (input) => {
      gatewayCalls.push(input);
      if (input.dstToken === baseUsdc) {
        return {
          schemaVersion: 1,
          observedAt: "2026-04-24T00:00:00.000Z",
          planStatus: "blocked",
          blockedReason: "no_route",
          route: {
            srcChain: input.srcChain,
            dstChain: input.dstChain,
            srcToken: input.srcToken,
            dstToken: input.dstToken,
          },
        };
      }
      return {
        schemaVersion: 1,
        observedAt: "2026-04-24T00:00:00.000Z",
        planStatus: "ready",
        route: {
          srcChain: input.srcChain,
          dstChain: input.dstChain,
          srcToken: input.srcToken,
          dstToken: input.dstToken,
        },
        amount: input.amount,
        quote: { outputAmount: { amount: "94500" } },
        gasPreflight: { gasUnits: 100000 },
        intent: { strategyId: "gateway-btc-funding-transfer" },
      };
    },
  });

  assert.equal(preparation.status, "ready");
  assert.equal(gatewayCalls.length, 2);
  assert.equal(gatewayCalls[0].dstToken, baseUsdc);
  assert.equal(gatewayCalls[1].dstToken, WBTC_OFT_TOKEN);
  assert.equal(dexCalls[1].chain, "base");
  assert.equal(dexCalls[1].inputToken, WBTC_OFT_TOKEN);
  assert.equal(dexCalls[1].outputToken, baseUsdc);
  assert.equal(preparation.plan.step3.type, "destination_dex_swap");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor falls back to LI.FI when Gateway has no BTC-family route", async () => {
  const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const bscUsdt = "0x55d398326f99059fF775485246999027B3197955";
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-bsc-usdt-base-usdc-lifi",
      type: "refill_token",
      chain: "base",
      asset: "USDC",
      token: baseUsdc,
      targetAmount: "68000000",
      targetAmountDecimal: 68,
      estimatedAssetValueUsd: 68,
      executionMethod: "cross_chain_swap_via_btc_intermediate",
      fundingSource: {
        source: {
          chain: "bsc",
          token: bscUsdt,
          actual: "300000000000000000000",
          actualDecimal: 300,
          estimatedUsd: 300,
        },
      },
    },
    senderAddress: ADDRESS,
    buildTokenDexPlanImpl: async () => ({
      schemaVersion: 1,
      observedAt: "2026-04-24T00:00:00.000Z",
      planStatus: "ready",
      minimumOutputAmount: "95000",
      steps: [{ id: "source_swap" }],
    }),
    buildGatewayBtcPlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-24T00:00:00.000Z",
      planStatus: "blocked",
      blockedReason: "no_route",
      route: {
        srcChain: input.srcChain,
        dstChain: input.dstChain,
        srcToken: input.srcToken,
        dstToken: input.dstToken,
      },
    }),
    buildLifiBridgePlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-24T00:00:00.000Z",
      planStatus: "ready",
      srcChain: input.srcChain,
      dstChain: input.dstChain,
      srcToken: input.srcToken,
      dstToken: input.dstToken,
      amount: input.amount,
      minimumOutputAmount: "74400000",
      expectedOutputAmount: "74800000",
      steps: [{ id: "approve_lifi_spender" }, { id: "lifi_bridge" }],
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "lifi_bridge");
  assert.equal(preparation.plan.srcToken, bscUsdt);
  assert.equal(preparation.plan.dstToken, baseUsdc);
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor falls back to destination stable swap for wrapped BTC gateway refill", async () => {
  const bobUsdc = "0xe75D0fB2C24A55cA1e3F96781a2bCC7bdba058F0";
  const gatewayCalls = [];
  const dexCalls = [];
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-base-wbtc-oft-bob-usdc",
      type: "refill_token",
      chain: "bob",
      asset: "USDC",
      token: bobUsdc,
      targetAmount: "3000000",
      targetAmountDecimal: 3,
      estimatedAssetValueUsd: 3,
      executionMethod: "cross_chain_bridge_or_swap",
      fundingSource: {
        source: {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          actual: "26184",
          actualDecimal: 0.00026184,
          estimatedUsd: 20.74,
        },
      },
    },
    senderAddress: ADDRESS,
    buildGatewayBtcPlanImpl: async (input) => {
      gatewayCalls.push(input);
      if (input.dstToken === bobUsdc) {
        return {
          schemaVersion: 1,
          observedAt: "2026-04-27T00:00:00.000Z",
          planStatus: "blocked",
          blockedReason: "no_route",
          route: {
            srcChain: input.srcChain,
            dstChain: input.dstChain,
            srcToken: input.srcToken,
            dstToken: input.dstToken,
          },
        };
      }
      return {
        schemaVersion: 1,
        observedAt: "2026-04-27T00:00:00.000Z",
        planStatus: "ready",
        route: {
          srcChain: input.srcChain,
          dstChain: input.dstChain,
          srcToken: input.srcToken,
          dstToken: input.dstToken,
        },
        amount: input.amount,
        quote: { outputAmount: { amount: "3200000" } },
        gasPreflight: { gasUnits: 100000 },
        intent: { strategyId: "gateway-btc-funding-transfer" },
      };
    },
    buildTokenDexPlanImpl: async (input) => {
      dexCalls.push(input);
      return {
        schemaVersion: 1,
        observedAt: "2026-04-27T00:00:00.000Z",
        planStatus: "ready",
        strategyId: "token-dex-experiment",
        chain: input.chain,
        senderAddress: input.senderAddress,
        inputToken: input.inputToken,
        outputToken: input.outputToken,
        amount: input.amount,
        minimumOutputAmount: "3000000",
        quote: { outputAmount: "3020000" },
        steps: [{ id: "swap_input_to_output" }],
      };
    },
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "gateway_btc_consolidation");
  assert.equal(gatewayCalls.length, 2);
  assert.equal(gatewayCalls[0].dstToken, bobUsdc);
  assert.equal(gatewayCalls[1].dstToken, WBTC_OFT_TOKEN);
  assert.equal(dexCalls.length, 1);
  assert.equal(dexCalls[0].chain, "bob");
  assert.equal(dexCalls[0].inputToken, WBTC_OFT_TOKEN);
  assert.equal(dexCalls[0].outputToken, bobUsdc);
  assert.equal(preparation.plan.step2.type, "destination_dex_swap");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor dispatches LI.FI fallback preparations", async () => {
  const execution = await executeTreasuryRefillExecutionPlan({
    preparation: {
      status: "ready",
      executor: "lifi_bridge",
      plan: { planStatus: "ready", marker: "lifi" },
    },
    executeLifiBridgePlanImpl: async ({ plan }) => ({ settlementStatus: "delivered", plan }),
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.plan.marker, "lifi");
});

test("treasury refill executor can prepare direct LI.FI refill candidates", async () => {
  const baseCbbtc = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-direct-lifi",
      type: "refill_token",
      chain: "unichain",
      asset: "wBTC.OFT",
      token: WBTC_OFT_TOKEN,
      targetAmount: "9000",
      targetAmountDecimal: 0.00009,
      estimatedAssetValueUsd: 7,
      executionMethod: "cross_chain_bridge_lifi",
      fundingSource: {
        source: {
          chain: "base",
          token: baseCbbtc,
          actual: "33053",
          actualDecimal: 0.00033053,
          estimatedUsd: 25,
        },
      },
    },
    senderAddress: ADDRESS,
    buildLifiBridgePlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-25T00:00:00.000Z",
      planStatus: "ready",
      srcChain: input.srcChain,
      dstChain: input.dstChain,
      srcToken: input.srcToken,
      dstToken: input.dstToken,
      amount: input.amount,
      minimumOutputAmount: "9100",
      steps: [{ id: "lifi_bridge" }],
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "lifi_bridge");
  assert.equal(preparation.plan.srcToken, baseCbbtc);
  assert.equal(preparation.plan.dstToken, WBTC_OFT_TOKEN);
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor allows high-coverage partial LI.FI refills", async () => {
  const baseCbbtc = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-direct-lifi-partial",
      type: "refill_token",
      chain: "bera",
      asset: "wBTC.OFT",
      token: WBTC_OFT_TOKEN,
      targetAmount: "10000",
      targetAmountDecimal: 0.0001,
      estimatedAssetValueUsd: 8,
      executionMethod: "cross_chain_bridge_lifi",
      fundingSource: {
        source: {
          chain: "base",
          token: baseCbbtc,
          actual: "33053",
          actualDecimal: 0.00033053,
          estimatedUsd: 25,
        },
      },
    },
    senderAddress: ADDRESS,
    buildLifiBridgePlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-25T00:00:00.000Z",
      planStatus: "ready",
      srcChain: input.srcChain,
      dstChain: input.dstChain,
      srcToken: input.srcToken,
      dstToken: input.dstToken,
      amount: input.amount,
      minimumOutputAmount: "8700",
      steps: [{ id: "lifi_bridge" }],
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "lifi_bridge");
  assert.equal(preparation.coverage.coversTarget, false);
  assert.equal(preparation.coverage.partialRefill, true);
  assert.equal(preparation.coverage.coverageBps, "8700");
});

test("treasury refill executor still blocks low-coverage partial LI.FI refills", async () => {
  const baseCbbtc = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-direct-lifi-low-partial",
      type: "refill_token",
      chain: "bera",
      asset: "wBTC.OFT",
      token: WBTC_OFT_TOKEN,
      targetAmount: "10000",
      targetAmountDecimal: 0.0001,
      estimatedAssetValueUsd: 8,
      executionMethod: "cross_chain_bridge_lifi",
      fundingSource: {
        source: {
          chain: "base",
          token: baseCbbtc,
          actual: "33053",
          actualDecimal: 0.00033053,
          estimatedUsd: 25,
        },
      },
    },
    senderAddress: ADDRESS,
    buildLifiBridgePlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-25T00:00:00.000Z",
      planStatus: "ready",
      srcChain: input.srcChain,
      dstChain: input.dstChain,
      srcToken: input.srcToken,
      dstToken: input.dstToken,
      amount: input.amount,
      minimumOutputAmount: "8400",
      steps: [{ id: "lifi_bridge" }],
    }),
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.blockedReason, "executor_output_below_refill_target");
  assert.equal(preparation.coverage.partialRefill, false);
  assert.equal(preparation.coverage.coverageBps, "8400");
});

test("treasury refill executor blocks composite plan when DEX step fails", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-intermediate-blocked",
      type: "refill_token",
      chain: "base",
      asset: "wBTC.OFT",
      token: WBTC_OFT_TOKEN,
      targetAmount: "10000",
      targetAmountDecimal: 0.0001,
      estimatedAssetValueUsd: 7.4,
      executionMethod: "cross_chain_swap_via_btc_intermediate",
      fundingSource: {
        source: {
          chain: "bsc",
          token: "0x55d398326f99059fF775485246999027B3197955",
          actual: "3000000000000000000",
          actualDecimal: 300,
          estimatedUsd: 300,
        },
      },
    },
    senderAddress: ADDRESS,
    buildTokenDexPlanImpl: async () => ({
      schemaVersion: 1,
      observedAt: "2026-04-19T00:00:00.000Z",
      planStatus: "blocked",
      blockedReason: "dex_quote_failed",
      steps: [],
    }),
    buildGatewayBtcPlanImpl: async () => ({
      schemaVersion: 1,
      observedAt: "2026-04-19T00:00:00.000Z",
      planStatus: "ready",
    }),
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.executor, "cross_chain_btc_intermediate");
  assert.equal(preparation.blockedReason, "dex_quote_failed");
});

test("treasury refill executor executes composite plan sequentially", async () => {
  const executionOrder = [];
  const execution = await executeTreasuryRefillExecutionPlan({
    preparation: {
      status: "ready",
      executor: "cross_chain_btc_intermediate",
      plan: {
        planStatus: "ready",
        step1: {
          type: "dex_swap",
          plan: { planStatus: "ready", marker: "dex-step" },
        },
        step2: {
          type: "gateway_consolidation",
          plan: { planStatus: "ready", marker: "gateway-step" },
        },
      },
    },
    executeTokenDexPlanImpl: async ({ plan }) => {
      executionOrder.push("dex");
      return { settlementStatus: "delivered", plan };
    },
    executeGatewayBtcPlanImpl: async ({ plan }) => {
      executionOrder.push("gateway");
      return { settlementStatus: "delivered", plan };
    },
  });

  assert.deepEqual(executionOrder, ["dex", "gateway"]);
  assert.equal(execution.executor, "cross_chain_btc_intermediate");
  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.step1Result.plan.marker, "dex-step");
  assert.equal(execution.step2Result.plan.marker, "gateway-step");
});

test("treasury refill executor executes composite fallback destination swap", async () => {
  const executionOrder = [];
  const execution = await executeTreasuryRefillExecutionPlan({
    preparation: {
      status: "ready",
      executor: "cross_chain_btc_intermediate",
      plan: {
        planStatus: "ready",
        step1: {
          type: "dex_swap",
          plan: { planStatus: "ready", marker: "source-dex-step" },
        },
        step2: {
          type: "gateway_consolidation",
          plan: { planStatus: "ready", marker: "gateway-step" },
        },
        step3: {
          type: "destination_dex_swap",
          plan: { planStatus: "ready", marker: "destination-dex-step" },
        },
      },
    },
    executeTokenDexPlanImpl: async ({ plan }) => {
      executionOrder.push(plan.marker);
      return { settlementStatus: "delivered", plan };
    },
    executeGatewayBtcPlanImpl: async ({ plan }) => {
      executionOrder.push(plan.marker);
      return { settlementStatus: "delivered", plan };
    },
  });

  assert.deepEqual(executionOrder, ["source-dex-step", "gateway-step", "destination-dex-step"]);
  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.step3Result.plan.marker, "destination-dex-step");
});
