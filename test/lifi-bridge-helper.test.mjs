import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN, ZERO_TOKEN } from "../src/assets/tokens.mjs";
import { buildLifiBridgePlan, executeLifiBridgePlan } from "../src/executor/helpers/lifi-bridge.mjs";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const YOUSD_TOKEN = "0x0000000f2eb9f69274678c76222b35eec7588a65";
const RLUSD_TOKEN = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";

function lifiFetch(body) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

async function buildYousdLifiPlan() {
  return buildLifiBridgePlan({
    srcChain: "base",
    dstChain: "ethereum",
    srcToken: YOUSD_TOKEN,
    dstToken: RLUSD_TOKEN,
    amount: "36751055",
    senderAddress: ADDRESS,
    now: "2026-05-07T09:10:00.000Z",
    fetchImpl: lifiFetch({
      id: "quote-yousd",
      tool: "mayan",
      action: {
        fromToken: { priceUSD: "1.05", decimals: 6 },
      },
      estimate: {
        approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        toAmountMin: "36700000000000000000",
        toAmount: "36750000000000000000",
        gasCosts: [{ amount: "30000000000000" }],
      },
      transactionRequest: {
        to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        data: "0x1234",
        value: "0",
        gasLimit: "300000",
      },
    }),
    priceReader: async () => ({
      tokenByKey: { usd_stable: 1, ethereum: 3_000 },
      nativeByChain: { base: 3_000, ethereum: 3_000 },
    }),
    estimateGasImpl: async () => ({ gasUnits: 30_000 }),
  });
}

async function buildUsdcLifiPlan() {
  return buildLifiBridgePlan({
    srcChain: "base",
    dstChain: "ethereum",
    srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    dstToken: RLUSD_TOKEN,
    amount: "100000000",
    senderAddress: ADDRESS,
    now: "2026-05-07T09:10:00.000Z",
    fetchImpl: lifiFetch({
      id: "quote-usdc",
      tool: "mayan",
      action: {
        fromToken: { priceUSD: "1.00", decimals: 6 },
      },
      estimate: {
        approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        toAmountMin: "99000000000000000000",
        toAmount: "100000000000000000000",
        gasCosts: [{ amount: "30000000000000" }],
      },
      transactionRequest: {
        to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        data: "0x1234",
        value: "0",
        gasLimit: "300000",
      },
    }),
    priceReader: async () => ({
      tokenByKey: { usd_stable: 1, ethereum: 3_000 },
      nativeByChain: { base: 3_000, ethereum: 3_000 },
    }),
    estimateGasImpl: async () => ({ gasUnits: 30_000 }),
  });
}

test("LI.FI bridge plan blocks unknown ERC20 source token decimals", async () => {
  const plan = await buildYousdLifiPlan();

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "missing_src_token_decimals");
  assert.equal(plan.amountUsd, null);
  assert.deepEqual(plan.steps, []);
});

test("LI.FI bridge approval cap-checks the transfer notional", async () => {
  const plan = await buildUsdcLifiPlan();

  assert.equal(plan.steps[0].id, "approve_lifi_spender");
  assert.equal(plan.amountUsd, 100);
  assert.equal(plan.steps[0].intent.metadata.capCheckAmountUsd, 105);
});

test("LI.FI bridge plan carries refill system economics into signer intents", async () => {
  const systemEconomics = {
    effectiveSystemNetPnlUsd: 6.2,
    routeInputUsd: 8.05,
    tradeReadiness: "insufficient_data",
  };
  const plan = await buildLifiBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    srcToken: WBTC_OFT_TOKEN,
    dstToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    amount: "4096",
    senderAddress: ADDRESS,
    now: "2026-05-13T11:30:00.000Z",
    systemEconomics,
    fetchImpl: lifiFetch({
      id: "quote-refill",
      tool: "across",
      action: {
        fromToken: { priceUSD: "80500", decimals: 8 },
      },
      estimate: {
        approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        toAmountMin: "2900000",
        toAmount: "3000000",
        gasCosts: [{ amount: "30000000000000" }],
      },
      transactionRequest: {
        to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        data: "0x1234",
        value: "0",
        gasLimit: "300000",
      },
    }),
    priceReader: async () => ({
      tokenByKey: { btc: 80500, usd_stable: 1 },
      nativeByChain: { base: 3_000, optimism: 3_000 },
    }),
    estimateGasImpl: async () => ({ gasUnits: 30_000 }),
  });

  assert.equal(plan.planStatus, "ready");
  assert.deepEqual(plan.steps[0].intent.systemEconomics, systemEconomics);
  assert.deepEqual(plan.steps[1].intent.systemEconomics, systemEconomics);
});

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
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["lifi_bridge"],
  );
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
