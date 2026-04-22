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
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
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
  assert.equal(plan.slippageBps, 50);
  assert.equal(plan.gasSnapshot.gasPriceWei, "100");
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

test("native dex experiment plan supports registered wrapped-native stable routes", async () => {
  const estimateGasImpl = async (chain) => ({
    observedAt: "2026-04-16T06:00:01.000Z",
    chain,
    rpcUrl: `https://${chain}-rpc.example`,
    latencyMs: 12,
    gasUnits: 100_000,
    gasUnitsHex: "0x186a0",
    rpcFallbacksTried: 0,
  });
  const gasSnapshotImpl = async (chain) => ({
    observedAt: "2026-04-16T06:00:02.000Z",
    chain,
    rpcUrl: `https://${chain}-rpc.example`,
    latencyMs: 9,
    blockNumber: 1,
    gasPriceWei: "100",
    baseFeeWei: "80",
    priorityFeeWei: "20",
  });

  const bscPlan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl,
    gasSnapshotImpl,
    chain: "bsc",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });
  const ethereumPlan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl,
    gasSnapshotImpl,
    chain: "ethereum",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });
  const unichainPlan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl,
    gasSnapshotImpl,
    chain: "unichain",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });
  const optimismPlan = await buildNativeDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl,
    gasSnapshotImpl,
    chain: "optimism",
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
  assert.equal(optimismPlan.planStatus, "ready");
  assert.equal(optimismPlan.outputToken, "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85");
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
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
    }),
    chain: "base",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });

  let stepIndex = 0;
  let nativeReadCount = 0;
  let outputReadCount = 0;
  const execution = await executeNativeDexExperimentPlan({
    plan,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    destinationSettlementTimeoutMs: 1_000,
    destinationPollIntervalMs: 0,
    readErc20BalanceImpl: async () => {
      outputReadCount += 1;
      return {
        rpcUrl: "https://base-rpc.example",
        balance: BigInt(outputReadCount > 1 ? 300000 : 0),
      };
    },
    readNativeBalanceImpl: async () => {
      nativeReadCount += 1;
      return {
        rpcUrl: "https://base-rpc.example",
        balanceWei: BigInt(nativeReadCount > 1 ? 0 : 100000000000000n).toString(),
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
  assert.equal(execution.sourceBalanceBefore.balance.toString(), "100000000000000");
  assert.equal(execution.sourceBalanceAfter.balance.toString(), "0");
  assert.equal(execution.destinationBalanceAfter.balance.toString(), "300000");
});

test("native dex experiment blocks before signing when native source balance is too low", async () => {
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
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
    }),
    chain: "base",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });

  let signerCalls = 0;
  await assert.rejects(
    executeNativeDexExperimentPlan({
      plan,
      readErc20BalanceImpl: async () => ({
        rpcUrl: "https://base-rpc.example",
        balance: 0n,
      }),
      readNativeBalanceImpl: async () => ({
        rpcUrl: "https://base-rpc.example",
        balanceWei: "99999999999999",
      }),
      sendCommand: async () => {
        signerCalls += 1;
        return { status: "ok", broadcast: { txHash: "0xshould-not-send" } };
      },
    }),
    (error) => {
      assert.equal(error.name, "InsufficientSourceBalance");
      assert.equal(error.partialExecution.settlementStatus, "blocked");
      assert.equal(error.partialExecution.blockedReason, "insufficient_source_balance");
      assert.equal(error.partialExecution.sourceBalanceBefore.balance.toString(), "99999999999999");
      assert.equal(error.partialExecution.error.requiredAmount, "100000000000000");
      return true;
    },
  );
  assert.equal(signerCalls, 0);
});

test("native dex experiment execution surfaces partial step results on signer revert", async () => {
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
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
    }),
    chain: "base",
    amount: "100000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    outputToken: "usdc",
  });

  await assert.rejects(
    executeNativeDexExperimentPlan({
      plan,
      readErc20BalanceImpl: async () => ({
        rpcUrl: "https://base-rpc.example",
        balance: 0n,
      }),
      readNativeBalanceImpl: async () => ({
        rpcUrl: "https://base-rpc.example",
        balanceWei: "100000000000000",
      }),
      sendCommand: async () => ({
        status: "error",
        broadcast: { txHash: "0xreverted" },
        error: {
          name: "EvmReceiptReverted",
          message: "Transaction reverted after broadcast",
        },
      }),
    }),
    (error) => {
      assert.equal(error.name, "EvmReceiptReverted");
      assert.equal(error.partialExecution.settlementStatus, "failed");
      assert.equal(error.partialExecution.stepResults.length, 1);
      assert.equal(error.partialExecution.stepResults[0].signerResult.broadcast.txHash, "0xreverted");
      return true;
    },
  );
});
