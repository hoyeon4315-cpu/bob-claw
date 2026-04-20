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
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: nativeRefillJob(),
    senderAddress: ADDRESS,
    buildTokenDexPlanImpl: async (input) => ({
      schemaVersion: 1,
      observedAt: "2026-04-19T00:00:00.000Z",
      planStatus: "ready",
      strategyId: "token-dex-experiment",
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
    }),
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "token_dex_experiment");
  assert.equal(preparation.plan.inputToken, WBTC_OFT_TOKEN);
  assert.equal(preparation.plan.outputToken, ZERO_TOKEN);
  assert.equal(preparation.plan.amount, "3271");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("treasury refill executor blocks cross-chain native refill until a native executor exists", async () => {
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
  });

  assert.equal(refillExecutorForJob({ executionMethod: "cross_chain_bridge_or_swap", type: "refill_native" }), null);
  assert.equal(preparation.status, "blocked");
  assert.match(preparation.blockedReason, /unsupported_refill_execution_method/);
});

test("treasury refill executor maps bitcoin-funded native refill to Gateway onramp with gas refill", async () => {
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
    buildGatewayBtcOnrampPlanImpl: async (input) => ({
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
    }),
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
  assert.equal(preparation.plan.gasRefill, "1000000000000000");
  assert.equal(preparation.coverage.coversTarget, true);
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
