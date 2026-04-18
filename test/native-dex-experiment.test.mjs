import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNativeDexExperimentPlan, executeNativeDexExperimentPlan } from "../src/executor/helpers/native-dex-experiment.mjs";
import { WRAPPED_NATIVE_TOKENS } from "../src/assets/tokens.mjs";

function odosClientFixture() {
  return {
    quote: async () => ({
      latencyMs: 111,
      body: {
        inAmounts: ["100000000000000"],
        outAmounts: ["250000"],
        inValues: [0.235],
        outValues: [0.234],
        netOutValue: 0.232,
        gasEstimate: 200000,
        gasEstimateValue: 0.003,
        priceImpact: 0,
        percentDiff: -0.1,
        pathId: "path-123",
        blockNumber: 1,
      },
    }),
    assemble: async () => ({
      latencyMs: 55,
      body: {
        transaction: {
          to: "0x7777777777777777777777777777777777777777",
          data: "0xabcdef",
          value: "0",
          gas: "210000",
        },
      },
    }),
  };
}

test("native dex experiment plan builds wrap, approval, and swap steps", async () => {
  const plan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T06:00:01.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 12,
      gasUnits: 100_000,
      gasUnitsHex: "0x186a0",
      rpcFallbacksTried: 0,
    }),
    chain: "base",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].id, "wrap_native");
  assert.equal(plan.steps[0].intent.metadata.capCheckAmountUsd, 0);
  assert.equal(plan.steps[1].intent.approval.mode, "per_tx");
  assert.equal(plan.steps[1].intent.metadata.capCheckAmountUsd, 0);
  assert.equal(plan.minimumOutputAmount, "248750");
});

test("native dex experiment plan surfaces routing failures cleanly", async () => {
  const plan = await buildNativeDexExperimentPlan({
    client: {
      quote: async () => {
        const error = new Error("Error getting quote, please try again");
        error.details = {
          body: {
            detail: "Routing unavailable for token [0x1234]",
          },
        };
        throw error;
      },
    },
    chain: "avalanche",
    amount: "10000000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "wbtc.oft",
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "routing_unavailable");
  assert.equal(plan.steps.length, 0);
});

test("native dex experiment plan supports newly added bsc and ethereum wrapped-native routes", async () => {
  const estimateGasImpl = async (chain) => ({
    observedAt: "2026-04-16T06:00:01.000Z",
    chain,
    rpcUrl: `https://${chain}-rpc.example`,
    latencyMs: 12,
    gasUnits: 100_000,
    gasUnitsHex: "0x186a0",
    rpcFallbacksTried: 0,
  });

  const bscPlan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl,
    chain: "bsc",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });
  const ethereumPlan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl,
    chain: "ethereum",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });
  const unichainPlan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl,
    chain: "unichain",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });

  assert.equal(bscPlan.planStatus, "ready");
  assert.equal(bscPlan.wrappedInputToken, WRAPPED_NATIVE_TOKENS.bsc);
  assert.equal(ethereumPlan.planStatus, "ready");
  assert.equal(ethereumPlan.wrappedInputToken, WRAPPED_NATIVE_TOKENS.ethereum);
  assert.equal(unichainPlan.planStatus, "ready");
  assert.equal(unichainPlan.outputAsset.ticker, "USDC");
});

test("native dex experiment execution waits for output token delivery proof", async () => {
  const plan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T06:00:01.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 12,
      gasUnits: 100_000,
      gasUnitsHex: "0x186a0",
      rpcFallbacksTried: 0,
    }),
    chain: "base",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });

  let stepIndex = 0;
  let readCount = 0;
  const execution = await executeNativeDexExperimentPlan({
    plan,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    destinationSettlementTimeoutMs: 1_000,
    destinationPollIntervalMs: 0,
    readErc20BalanceImpl: async () => {
      readCount += 1;
      return {
        rpcUrl: "https://base-rpc.example",
        balance: BigInt(readCount > 1 ? 300000 : 0),
      };
    },
    sendCommand: async () => ({
      status: "ok",
      broadcast: {
        txHash: `0xhash${stepIndex++}`,
      },
      receipt: {
        hash: `0xhash${stepIndex}`,
        status: 1,
      },
    }),
  });

  assert.equal(execution.stepResults.length, 3);
  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.destinationProof.requiredDelta, "248750");
});
