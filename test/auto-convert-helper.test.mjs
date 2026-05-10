import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featureEnabled,
  buildConvertIntent,
} from "../src/executor/harvest/auto-convert-helper.mjs";

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
        outputAmount: "1230000",
      };
    },
    async assemble() {
      return {
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0xabcdef",
        txValueWei: "0",
        outputAmount: "1230000",
      };
    },
  };
}

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ autoConvert: true }), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ autoConvert: false }), false);
});

test("buildConvertIntent returns swap intent with expectedNetUsd", async () => {
  const intent = await buildConvertIntent({
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    toToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    amount: 100,
    chain: "base",
    slippageBps: 50,
    strategyId: "harvest-convert",
    senderAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    providers: [fakeProvider()],
    now: "2026-05-12T10:00:00.000Z",
  });
  assert.ok(intent);
  assert.equal(intent.intentType, "convert");
  assert.equal(intent.strategyId, "harvest-convert");
  assert.equal(intent.chain, "base");
  assert.equal(intent.amountUsd, 100);
  assert.ok(Number.isFinite(intent.expectedNetUsd));
  assert.ok(intent.expectedNetUsd > 0);
  if (intent.steps) {
    assert.ok(intent.steps.length >= 1);
  }
});

test("buildConvertIntent returns null for negative EV (zero amount)", async () => {
  const intent = await buildConvertIntent({
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    toToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    amount: 0,
    chain: "base",
  });
  assert.equal(intent, null);
});

test("buildConvertIntent no-op when feature disabled", async () => {
  const intent = await buildConvertIntent(
    {
      fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      toToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      amount: 100,
      chain: "base",
    },
    { profile: { autoConvert: false } },
  );
  assert.equal(intent, null);
});
