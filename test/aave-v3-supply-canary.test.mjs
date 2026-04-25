import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAaveV3SupplyCanaryPlan,
  executeAaveV3SupplyCanaryPlan,
} from "../src/executor/helpers/aave-v3-supply-canary.mjs";

test("aave v3 representative helper mirrors candidate fields into the protocol canary plan", async () => {
  const plan = await buildAaveV3SupplyCanaryPlan({
    candidate: {
      templateId: "optimism:stablecoin_lending_carry",
      chain: "optimism",
      protocolId: "aave-v3",
      bindingKind: "aave_v3_pool_supply_withdraw",
      assetAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      assetDecimals: 6,
      poolAddress: "0x1111111111111111111111111111111111111111",
      aTokenAddress: "0x3333333333333333333333333333333333333333",
      aTokenSymbol: "aOptUSDCn",
    },
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "1000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(plan.templateId, "optimism:stablecoin_lending_carry");
  assert.equal(plan.poolAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(plan.shareTokenAddress, "0x3333333333333333333333333333333333333333");
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "aave_supply");
  assert.equal(plan.amountUsd, 1);
});

test("aave v3 representative helper reuses the protocol canary executor", () => {
  assert.equal(executeAaveV3SupplyCanaryPlan.name, "executeAaveProtocolCanaryPlan");
});
