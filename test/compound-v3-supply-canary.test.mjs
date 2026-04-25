import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCompoundV3SupplyCanaryPlan,
  executeCompoundV3SupplyCanaryPlan,
} from "../src/executor/helpers/compound-v3-supply-canary.mjs";

const candidate = {
  templateId: "ethereum:stablecoin_lending_carry",
  chain: "ethereum",
  protocolId: "compound-v3",
  bindingKind: "compound_v3_comet_supply_withdraw",
  assetSymbol: "USDC",
  assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  assetDecimals: 6,
  cometSymbol: "cUSDCv3",
  cometAddress: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
};

test("compound v3 supply canary builds approve and Comet supply intents", async () => {
  const plan = await buildCompoundV3SupplyCanaryPlan({
    candidate,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "1000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.amountUsd, 1);
  assert.equal(plan.cometAddress, candidate.cometAddress);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "compound_v3_supply");
  assert.equal(plan.minimumRedeemAssetDelta, "950000");
});

test("compound v3 supply canary executes supply then withdraw with balance-delta proof", async () => {
  const plan = await buildCompoundV3SupplyCanaryPlan({
    candidate,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "100",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
  });
  const balances = new Map([
    [`${plan.asset.token.toLowerCase()}:0`, "1000"],
    [`${plan.shareAsset.token.toLowerCase()}:0`, "0"],
    [`${plan.shareAsset.token.toLowerCase()}:1`, "1"],
    [`${plan.asset.token.toLowerCase()}:1`, "900"],
    [`${plan.asset.token.toLowerCase()}:2`, "1000"],
    [`${plan.asset.token.toLowerCase()}:3`, "1000"],
    [`${plan.shareAsset.token.toLowerCase()}:2`, "0"],
  ]);
  const calls = new Map();

  const execution = await executeCompoundV3SupplyCanaryPlan({
    plan,
    sendCommand: async () => ({ status: "ok", broadcast: { txHash: "0xtx" } }),
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20BalanceImpl: async (_chain, token) => {
      const lower = token.toLowerCase();
      const index = calls.get(lower) || 0;
      calls.set(lower, index + 1);
      return { rpcUrl: "memory", balance: balances.get(`${lower}:${index}`) || "0" };
    },
    settlementTimeoutMs: 0,
    sleepImpl: async () => {},
    receiptIngest: null,
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.supplyProof.status, "delivered");
  assert.equal(execution.destinationProof.status, "delivered");
  assert.deepEqual(execution.stepResults.map((step) => step.id), [
    "approve_asset_to_comet",
    "supply_asset_to_comet",
    "withdraw_asset_from_comet",
  ]);
});
