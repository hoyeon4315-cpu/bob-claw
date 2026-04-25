import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import { buildSwapIntent } from "../src/executor/helpers/swap-intent-builder.mjs";

const ERC20 = new Interface(["function approve(address spender,uint256 amount)"]);

function fakeProvider() {
  return {
    name: "fake_dex",
    supportsChain: () => true,
    async quote(params) {
      return {
        pathId: "path-1",
        chain: params.chain,
        inputToken: params.inputToken,
        outputToken: params.outputToken,
        inputAmount: params.amount,
        outputAmount: "123",
      };
    },
    async assemble() {
      return {
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0xabcdef",
        txValueWei: "0",
        outputAmount: "123",
      };
    },
  };
}

test("buildSwapIntent builds approve and DEX swap intents using committed strategy caps", async () => {
  const inputToken = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const outputToken = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const plan = await buildSwapIntent({
    strategyId: "destination_wrapped_btc_rotation",
    chain: "base",
    amountUsd: 10,
    inputToken,
    outputToken,
    inputDecimals: 6,
    providers: [fakeProvider()],
    senderAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    estimateGasImpl: () => {
      throw new Error("skip gas");
    },
    now: "2026-04-24T00:00:00.000Z",
  });

  assert.equal(plan.steps.length, 2);
  assert.equal(plan.inputAmount, "10000000");
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "dex_swap");
  assert.equal(plan.steps[1].intent.tx.to, "0x1111111111111111111111111111111111111111");
  assert.equal(plan.steps[1].intent.tx.data, "0xabcdef");
  assert.equal(plan.steps[1].intent.metadata.capCheckAmountUsd, 10);

  const decodedApprove = ERC20.decodeFunctionData("approve", plan.steps[0].intent.tx.data);
  assert.equal(decodedApprove[0], "0x1111111111111111111111111111111111111111");
  assert.equal(decodedApprove[1].toString(), "10000000");
});

test("buildSwapIntent can use explicit inputAmount for auto capital rebalance", async () => {
  const plan = await buildSwapIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    amountUsd: 5,
    inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    outputToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    inputAmount: "5000000",
    inputDecimals: 6,
    providers: [fakeProvider()],
    senderAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    estimateGasImpl: () => ({ gasUnits: 21_000 }),
  });

  assert.equal(plan.inputAmount, "5000000");
  assert.equal(plan.steps[0].intent.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(plan.steps[1].intent.metadata.capStrategyId, "wrapped-btc-loop-base-moonwell");
});
