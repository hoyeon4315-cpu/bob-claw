import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN, ZERO_TOKEN } from "../src/assets/tokens.mjs";
import { buildLifiBridgePlan, executeLifiBridgePlan } from "../src/executor/helpers/lifi-bridge.mjs";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function lifiFetch(body) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

test("LI.FI bridge plan skips ERC20 approval for native source assets", async () => {
  const estimateCalls = [];
  const plan = await buildLifiBridgePlan({
    srcChain: "bsc",
    dstChain: "base",
    srcToken: ZERO_TOKEN,
    dstToken: WBTC_OFT_TOKEN,
    amount: "8236895891095136",
    senderAddress: ADDRESS,
    fetchImpl: lifiFetch({
      id: "quote-native",
      tool: "across",
      action: {
        fromToken: { priceUSD: "626.93" },
      },
      estimate: {
        toAmountMin: "6324",
        toAmount: "6325",
        gasCosts: [{ amount: "37597551936000" }],
      },
      transactionRequest: {
        to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        data: "0x1234",
        value: "8236895891095136",
        gasLimit: "751936",
      },
    }),
    priceReader: async () => ({
      tokenByKey: { btc: 80_000, bsc: 626.93 },
      nativeByChain: { bsc: 626.93 },
    }),
    estimateGasImpl: async (chain, tx) => {
      estimateCalls.push({ chain, tx });
      return { gasUnits: 751_936 };
    },
  });

  assert.equal(plan.planStatus, "ready");
  assert.deepEqual(plan.steps.map((step) => step.id), ["lifi_bridge"]);
  assert.equal(estimateCalls.length, 0);
  assert.equal(plan.nativeSourceRequirementWei, "8274493443031136");
});

test("LI.FI execution blocks native source plans before signer when gas budget is short", async () => {
  const plan = {
    planStatus: "ready",
    srcChain: "bsc",
    dstChain: "base",
    srcToken: ZERO_TOKEN,
    dstToken: WBTC_OFT_TOKEN,
    srcAsset: { isNative: true, chain: "bsc", token: ZERO_TOKEN },
    dstAsset: { isNative: false, chain: "base", token: WBTC_OFT_TOKEN },
    senderAddress: ADDRESS,
    recipient: ADDRESS,
    amount: "8236895891095136",
    minimumOutputAmount: "6324",
    nativeSourceRequirementWei: "8274493443031136",
    steps: [
      {
        id: "lifi_bridge",
        intent: { tx: { to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", value: "8236895891095136" } },
      },
    ],
  };
  let signerCalled = false;

  await assert.rejects(
    () =>
      executeLifiBridgePlan({
        plan,
        sendCommand: async () => {
          signerCalled = true;
          return { status: "ok" };
        },
        readNativeBalanceImpl: async () => ({ balanceWei: "8236895891095136" }),
        readErc20BalanceImpl: async () => ({ balance: "0" }),
        receiptIngest: null,
      }),
    (error) => {
      assert.equal(error.name, "InsufficientNativeBalanceForLifiGas");
      assert.equal(error.partialExecution?.settlementStatus, "blocked");
      assert.equal(error.partialExecution?.blockedReason, "insufficient_native_balance_for_lifi_gas");
      return true;
    },
  );
  assert.equal(signerCalled, false);
});
