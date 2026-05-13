import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPendleYtEntryPlan,
  executePendleYtEntryPlan,
  registerPendleBinding,
} from "../src/strategy/registry/plugins/yield-tokenization/pendle-binding.mjs";
import {
  getBindingRegistration,
  isSupportedBindingKind,
  supportedBindingKinds,
  resolvePlanBuilder,
  resolvePlanExecutor,
  resolveExitExecutor,
  resolveIntentType,
} from "../src/executor/protocol-binding-registry.mjs";
import { evGate } from "../src/executor/policy/ev-gate.mjs";

describe("pendle-binding registration", () => {
  it("registers pendle_yt_buy_sell_redeem binding", () => {
    registerPendleBinding();
    assert.equal(isSupportedBindingKind("pendle_yt_buy_sell_redeem"), true);
  });

  it("registration has correct metadata", () => {
    const reg = getBindingRegistration("pendle_yt_buy_sell_redeem");
    assert.equal(reg.bindingKind, "pendle_yt_buy_sell_redeem");
    assert.equal(reg.family, "pendle_yt");
    assert.equal(reg.intentType, "pendle_yt_entry");
  });

  it("resolvers return functions", () => {
    assert.equal(typeof resolvePlanBuilder("pendle_yt_buy_sell_redeem"), "function");
    assert.equal(typeof resolvePlanExecutor("pendle_yt_buy_sell_redeem"), "function");
    assert.equal(typeof resolveExitExecutor("pendle_yt_buy_sell_redeem"), "function");
    assert.equal(resolveIntentType("pendle_yt_buy_sell_redeem"), "pendle_yt_entry");
  });

  it("does not hardcode market addresses", () => {
    const reg = getBindingRegistration("pendle_yt_buy_sell_redeem");
    const json = JSON.stringify(reg);
    assert.ok(!json.includes("0x"), "binding must not hardcode addresses");
  });
});

describe("pendle YT entry execution", () => {
  it("does not send the swap when the exact approval is rejected", async () => {
    const plan = await buildPendleYtEntryPlan({
      queueItem: pendleQueueItem(),
      senderAddress: SENDER,
      amount: "5000000",
      fetchPendleConvertImpl: async (request) => ({
        action: "swap",
        requiredApprovals: [{ token: request.inputToken, amount: request.amount }],
        routes: [
          {
            tx: {
              to: "0x888888888889758F76e7103c6CbF23ABbF58F946",
              data: "0x1234",
              value: "0",
            },
            outputs: [{ token: BASE_YT, amount: "1000000000000000000" }],
          },
        ],
      }),
      readErc20AllowanceImpl: async () => ({ allowance: "0" }),
      estimateGasImpl: async () => ({ gasUnits: 250000 }),
      now: "2026-05-13T00:00:00.000Z",
    });
    const sent = [];

    await assert.rejects(
      () =>
        executePendleYtEntryPlan({
          plan,
          sendCommand: async ({ message }) => {
            sent.push(message.intent.intentType);
            return {
              status: "rejected",
              error: { name: "PolicyRejected", message: "expected_net_unmeasured" },
            };
          },
          readErc20BalanceImpl: async (chain, token) => ({
            balance: token === BASE_USDC ? 5000000n : 0n,
            rpcUrl: "https://mainnet.base.org",
          }),
          readNativeBalanceImpl: async () => ({ balanceWei: 1000000000000000n, rpcUrl: "https://mainnet.base.org" }),
          exitAfterProof: false,
        }),
      /approve_asset_to_pendle_router failed: expected_net_unmeasured/,
    );

    assert.deepEqual(sent, ["approve_exact"]);
  });

  it("marks a Pendle entry delivered when YT balance proof settles", async () => {
    const plan = await buildPendleYtEntryPlan({
      queueItem: pendleQueueItem(),
      senderAddress: SENDER,
      amount: "5000000",
      fetchPendleConvertImpl: async (request) => ({
        action: "swap",
        requiredApprovals: [{ token: request.inputToken, amount: request.amount }],
        routes: [
          {
            tx: {
              to: "0x888888888889758F76e7103c6CbF23ABbF58F946",
              data: "0x1234",
              value: "0",
            },
            outputs: [{ token: BASE_YT, amount: "1000000000000000000" }],
          },
        ],
      }),
      readErc20AllowanceImpl: async () => ({ allowance: "5000000" }),
      now: "2026-05-13T00:00:00.000Z",
    });
    let shareReads = 0;

    const execution = await executePendleYtEntryPlan({
      plan,
      sendCommand: async () => ({
        status: "ok",
        broadcast: { txHash: "0xabc", nonce: 1 },
        receipt: { status: 1 },
      }),
      readErc20BalanceImpl: async (chain, token) => {
        if (token === BASE_USDC) return { balance: 5000000n, rpcUrl: "https://mainnet.base.org" };
        if (token === BASE_YT) {
          shareReads += 1;
          return { balance: shareReads === 1 ? 0n : 1n, rpcUrl: "https://mainnet.base.org" };
        }
        return { balance: 0n, rpcUrl: "https://mainnet.base.org" };
      },
      readNativeBalanceImpl: async () => ({ balanceWei: 1000000000000000n, rpcUrl: "https://mainnet.base.org" }),
      settlementTimeoutMs: 50,
      pollIntervalMs: 1,
      sleepImpl: async () => {},
    });

    assert.equal(execution.status, "executed");
    assert.equal(execution.settlementStatus, "delivered");
    assert.equal(execution.swapTxHash, "0xabc");
    assert.equal(execution.positionProof.status, "delivered");
  });
});

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_APXUSD = "0xd993935e13851dd7517af10687ec7e5022127228";
const BASE_MARKET = "0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e";
const BASE_YT = "0xf90c9350ed4a91121167ad40a79ec5852c6018e2";
const SENDER = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";

function pendleQueueItem(overrides = {}) {
  return {
    opportunityId: "pendle-direct:8453:0x6ae9cf67d57e49c55f900933f5dcfc4b63461d6e",
    chain: "base",
    protocolId: "pendle",
    mappedStrategyId: "pendle-yt-canary",
    validationMode: "tiny_live_canary_only",
    aprPct: 15.59547513083861,
    campaignRemainingHours: 855,
    protocolBindingPlan: {
      bindingKind: "pendle_yt_buy_sell_redeem",
      resolvedBinding: {
        marketAddress: BASE_MARKET,
        ytTokenAddress: BASE_YT,
        assetAddress: BASE_APXUSD,
        assetDecimals: 18,
        entryTokenAddresses: [BASE_USDC],
      },
    },
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        token: BASE_USDC,
        actual: "29376610",
        estimatedUsd: 29.37661,
      },
    },
    ...overrides,
  };
}

describe("pendle YT entry planning", () => {
  it("builds a Pendle Hosted SDK convert plan for a zap input token", async () => {
    const plan = await buildPendleYtEntryPlan({
      queueItem: pendleQueueItem(),
      senderAddress: SENDER,
      amount: "10000000",
      fetchPendleConvertImpl: async (request) => ({
        action: "swap",
        requiredApprovals: [{ token: request.inputToken, amount: request.amount }],
        routes: [
          {
            tx: {
              to: "0x888888888889758F76e7103c6CbF23ABbF58F946",
              data: "0x1234",
              value: "0",
            },
            outputs: [{ token: BASE_YT, amount: "1000000000000000000" }],
            data: { priceImpact: 0.001 },
          },
        ],
      }),
      readErc20AllowanceImpl: async () => ({ allowance: "0" }),
      estimateGasImpl: async () => ({ gasUnits: 250000 }),
      now: "2026-05-13T00:00:00.000Z",
    });

    assert.equal(plan.planStatus, "ready");
    assert.equal(plan.entryPlanner, "pendle_hosted_sdk_convert_v3");
    assert.equal(plan.asset.token, BASE_USDC);
    assert.equal(plan.underlyingAsset.token, BASE_APXUSD);
    assert.deepEqual(
      plan.steps.map((step) => step.id),
      ["approve_asset_to_pendle_router", "swap_asset_to_yt"],
    );
    assert.equal(plan.steps[1].intent.tx.to, "0x888888888889758F76e7103c6CbF23ABbF58F946");
    assert.equal(plan.steps[1].intent.metadata.pendleMarketAddress, BASE_MARKET);
    const approvalVerdict = evGate(plan.steps[0].intent, null, { now: "2026-05-13T00:00:00.000Z" });
    assert.equal(approvalVerdict.allow, true);
    assert.equal(approvalVerdict.evidence.bypassReason, "parent_ev_approved_exact_approval");
  });

  it("reports a blocked Pendle plan when Hosted SDK convert cannot build tx data", async () => {
    const plan = await buildPendleYtEntryPlan({
      queueItem: pendleQueueItem(),
      senderAddress: SENDER,
      amount: "10000000",
      fetchPendleConvertImpl: async () => {
        throw new Error("Pendle SDK convert failed: 500 quote unavailable");
      },
      now: "2026-05-13T00:00:00.000Z",
    });

    assert.equal(plan.planStatus, "blocked");
    assert.match(plan.blockedReason, /^pendle_sdk_convert_unavailable:/);
    assert.equal(plan.assetAddress, BASE_APXUSD);
    assert.equal(plan.inputTokenAddress, BASE_USDC);
  });
});
