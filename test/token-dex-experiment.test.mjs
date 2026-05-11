import assert from "node:assert/strict";
import { test } from "node:test";
import { ZERO_TOKEN } from "../src/assets/tokens.mjs";
import { buildTokenDexExperimentPlan, executeTokenDexExperimentPlan } from "../src/executor/helpers/token-dex-experiment.mjs";

function odosClientFixture() {
  return {
    quote: async () => ({
      latencyMs: 111,
      body: {
        inAmounts: ["10000"],
        outAmounts: ["9900"],
        inValues: [7.5],
        outValues: [7.4],
        netOutValue: 7.35,
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

function pancakeProviderFixture() {
  return {
    name: "pancake_swap",
    quote: async () => ({
      provider: "pancake_swap",
      chain: "bsc",
      chainId: 56,
      inputToken: "0x55d398326f99059fF775485246999027B3197955",
      outputToken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      inputAmount: "100000000000000000",
      outputAmount: "100000000000000",
      inputValueUsd: 0.1,
      fee: 500,
      slippageBps: 50,
      pathId: "pancake_v3:test",
      executionTrust: "on_chain_verified",
    }),
    assemble: async ({ quote }) => ({
      ...quote,
      txTo: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
      txData: "0xabcdef",
      txValueWei: "0",
      txGasLimit: null,
    }),
  };
}

test("token dex experiment plan builds approval and swap steps", async () => {
  const plan = await buildTokenDexExperimentPlan({
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
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "wbtc.oft",
    outputToken: "cbbtc",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].id, "approve_input_token");
  assert.equal(plan.steps[0].intent.metadata.capCheckAmountUsd, 0);
  assert.equal(plan.steps[1].id, "swap_input_to_output");
  assert.equal(plan.outputAsset.ticker, "cbBTC");
  assert.equal(plan.minimumOutputAmount, "9850");
  assert.equal(plan.slippageBps, 50);
  assert.equal(plan.gasSnapshot.gasPriceWei, "100");
});

test("token dex experiment plan uses Pancake direct gas fallback after pre-approval swap revert", async () => {
  let estimateCount = 0;
  const plan = await buildTokenDexExperimentPlan({
    providers: [pancakeProviderFixture()],
    estimateGasImpl: async () => {
      estimateCount += 1;
      if (estimateCount === 2) throw new Error("execution reverted: allowance");
      return {
        observedAt: "2026-04-16T06:00:01.000Z",
        chain: "bsc",
        rpcUrl: "https://bsc-rpc.example",
        latencyMs: 12,
        gasUnits: 45_000,
        gasUnitsHex: "0xafc8",
        rpcFallbacksTried: 0,
      };
    },
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "bsc",
      rpcUrl: "https://bsc-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
    }),
    chain: "bsc",
    amount: "100000000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "usdt",
    outputToken: "wrapped_native",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(estimateCount, 2);
  assert.equal(plan.steps[1].id, "swap_input_to_output");
  assert.equal(plan.steps[1].intent.tx.gasLimit, "540000");
  assert.equal(plan.steps[1].intent.metadata.provider, "pancake_swap");
});

test("token dex experiment plan uses approve gas fallback when RPC estimation reverts", async () => {
  let estimateCount = 0;
  const plan = await buildTokenDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl: async () => {
      estimateCount += 1;
      if (estimateCount === 1) throw new Error("execution reverted: approve");
      return {
        observedAt: "2026-04-16T06:00:01.000Z",
        chain: "ethereum",
        rpcUrl: "https://ethereum-rpc.example",
        latencyMs: 12,
        gasUnits: 100_000,
        gasUnitsHex: "0x186a0",
        rpcFallbacksTried: 0,
      };
    },
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "ethereum",
      rpcUrl: "https://ethereum-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
    }),
    chain: "ethereum",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "usdt",
    outputToken: "native",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(estimateCount, 2);
  assert.equal(plan.steps[0].id, "approve_input_token");
  assert.equal(plan.steps[0].intent.tx.gasLimit, "120000");
});

test("token dex experiment resets partial allowance before exact approval", async () => {
  const plan = await buildTokenDexExperimentPlan({
    client: odosClientFixture(),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T06:00:01.000Z",
      chain: "ethereum",
      rpcUrl: "https://ethereum-rpc.example",
      latencyMs: 12,
      gasUnits: 100_000,
      gasUnitsHex: "0x186a0",
      rpcFallbacksTried: 0,
    }),
    readErc20AllowanceImpl: async () => ({
      allowance: 5_000n,
      rpcUrl: "https://ethereum-rpc.example",
    }),
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "ethereum",
      rpcUrl: "https://ethereum-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
    }),
    chain: "ethereum",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "usdt",
    outputToken: "wrapped_native",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].id, "reset_input_allowance");
  assert.equal(plan.steps[0].intent.approval.amount, "0");
  assert.equal(plan.steps[1].id, "approve_input_token");
  assert.equal(plan.steps[1].intent.approval.amount, "10000");
  assert.equal(plan.steps[2].id, "swap_input_to_output");
});

test("token dex experiment plan supports native output unwrap", async () => {
  const plan = await buildTokenDexExperimentPlan({
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
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "cbbtc",
    outputToken: "native",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.outputAsset.ticker, "ETH");
  assert.equal(plan.outputToken, ZERO_TOKEN);
  assert.equal(plan.wrappedOutputToken, "0x4200000000000000000000000000000000000006");
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[2].id, "unwrap_wrapped_native");
});

test("token dex experiment applies approval gas floor after low successful estimate", async () => {
  const plan = await buildTokenDexExperimentPlan({
    strategyId: "native-gas-refill",
    client: odosClientFixture(),
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T06:00:01.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 12,
      gasUnits: 43_000,
      gasUnitsHex: "0xa7f8",
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
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "cbbtc",
    outputToken: "native",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.steps[0].id, "approve_input_token");
  assert.equal(plan.steps[0].intent.metadata.capCheckAmountUsd, 0);
  assert.equal(plan.steps[0].intent.tx.gasLimit, "120000");
});

test("token dex experiment plan directly unwraps wrapped-native input to native output", async () => {
  let quoteCalled = false;
  let estimateCalls = 0;
  const plan = await buildTokenDexExperimentPlan({
    providers: [{
      name: "should_not_quote",
      quote: async () => {
        quoteCalled = true;
        throw new Error("quote should not be requested for direct unwrap");
      },
    }],
    estimateGasImpl: async () => {
      estimateCalls += 1;
      return {
        observedAt: "2026-04-16T06:00:01.000Z",
        chain: "bsc",
        rpcUrl: "https://bsc-rpc.example",
        latencyMs: 12,
        gasUnits: 45_000,
        gasUnitsHex: "0xafc8",
        rpcFallbacksTried: 0,
      };
    },
    gasSnapshotImpl: async () => ({
      observedAt: "2026-04-16T06:00:02.000Z",
      chain: "bsc",
      rpcUrl: "https://bsc-rpc.example",
      latencyMs: 9,
      blockNumber: 1,
      gasPriceWei: "100",
      baseFeeWei: "80",
      priorityFeeWei: "20",
    }),
    chain: "bsc",
    amount: "5000000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "wrapped_native",
    outputToken: "native",
    now: "2026-04-16T06:00:00.000Z",
  });

  assert.equal(quoteCalled, false);
  assert.equal(estimateCalls, 1);
  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.inputAsset.ticker, "WBNB");
  assert.equal(plan.outputAsset.ticker, "BNB");
  assert.equal(plan.outputToken, ZERO_TOKEN);
  assert.equal(plan.wrappedOutputToken, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
  assert.equal(plan.minimumOutputAmount, "5000000000000000");
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].id, "unwrap_wrapped_native");
  assert.equal(plan.steps[0].intent.tx.gasLimit, "54000");
});

test("token dex experiment plan surfaces routing failures cleanly", async () => {
  const plan = await buildTokenDexExperimentPlan({
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
    chain: "base",
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "wbtc.oft",
    outputToken: "cbbtc",
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "routing_unavailable");
  assert.equal(plan.steps.length, 0);
});

test("token dex experiment execution waits for output token delivery proof", async () => {
  const plan = await buildTokenDexExperimentPlan({
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
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "wbtc.oft",
    outputToken: "cbbtc",
  });

  let stepIndex = 0;
  let inputReadCount = 0;
  let outputReadCount = 0;
  const execution = await executeTokenDexExperimentPlan({
    plan,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    destinationSettlementTimeoutMs: 1_000,
    destinationPollIntervalMs: 0,
    readErc20BalanceImpl: async (_chain, token) => {
      if (String(token).toLowerCase() === String(plan.inputToken).toLowerCase()) {
        inputReadCount += 1;
        return {
          rpcUrl: "https://base-rpc.example",
          balance: BigInt(inputReadCount > 1 ? 0 : 10000),
        };
      }
      outputReadCount += 1;
      return {
        rpcUrl: "https://base-rpc.example",
        balance: BigInt(outputReadCount > 1 ? 9900 : 0),
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

  assert.equal(execution.stepResults.length, 2);
  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.destinationProof.requiredDelta, "9850");
  assert.equal(execution.sourceBalanceBefore.balance.toString(), "10000");
  assert.equal(execution.sourceBalanceAfter.balance.toString(), "0");
  assert.equal(execution.destinationBalanceAfter.balance.toString(), "9900");
});

test("token dex experiment native output proof subtracts same-wallet gas fees", async () => {
  const plan = await buildTokenDexExperimentPlan({
    providers: [{
      name: "should_not_quote",
      quote: async () => {
        throw new Error("quote should not be requested for direct unwrap");
      },
    }],
    estimateGasImpl: async () => ({
      observedAt: "2026-04-16T06:00:01.000Z",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      latencyMs: 12,
      gasUnits: 45_000,
      gasUnitsHex: "0xafc8",
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
    amount: "5000000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "wrapped_native",
    outputToken: "native",
  });

  let nativeReads = 0;
  const execution = await executeTokenDexExperimentPlan({
    plan,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    destinationSettlementTimeoutMs: 1,
    destinationPollIntervalMs: 0,
    readErc20BalanceImpl: async () => ({
      rpcUrl: "https://base-rpc.example",
      balance: 5_000_000_000_000_000n,
    }),
    readNativeBalanceImpl: async () => {
      nativeReads += 1;
      return {
        rpcUrl: "https://base-rpc.example",
        balanceWei: nativeReads > 1 ? 5_000_000_000_999_900n : 1_000_000n,
      };
    },
    sendCommand: async () => ({
      status: "ok",
      broadcast: { txHash: "0xunwrap" },
      receipt: {
        hash: "0xunwrap",
        status: 1,
        fee: "100",
      },
    }),
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.destinationProof.requiredDelta, "4999999999999900");
  assert.equal(execution.destinationProof.observedDelta, "4999999999999900");
});

test("token dex experiment blocks before signing when source token balance is too low", async () => {
  const plan = await buildTokenDexExperimentPlan({
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
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "wbtc.oft",
    outputToken: "cbbtc",
  });

  let signerCalls = 0;
  await assert.rejects(
    executeTokenDexExperimentPlan({
      plan,
      readErc20BalanceImpl: async (_chain, token) => ({
        rpcUrl: "https://base-rpc.example",
        balance: BigInt(String(token).toLowerCase() === String(plan.inputToken).toLowerCase() ? 9999 : 0),
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
      assert.equal(error.partialExecution.sourceBalanceBefore.balance.toString(), "9999");
      assert.equal(error.partialExecution.error.requiredAmount, "10000");
      return true;
    },
  );
  assert.equal(signerCalls, 0);
});

test("token dex experiment execution surfaces partial step results on signer revert", async () => {
  const plan = await buildTokenDexExperimentPlan({
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
    amount: "10000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    inputToken: "wbtc.oft",
    outputToken: "cbbtc",
  });

  await assert.rejects(
    executeTokenDexExperimentPlan({
      plan,
      readErc20BalanceImpl: async (_chain, token) => ({
        rpcUrl: "https://base-rpc.example",
        balance: BigInt(String(token).toLowerCase() === String(plan.inputToken).toLowerCase() ? 10000 : 0),
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
