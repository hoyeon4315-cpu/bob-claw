import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import {
  buildAaveV3SupplyCanaryPlan,
  executeAaveV3SupplyCanaryPlan,
} from "../src/executor/helpers/aave-v3-supply-canary.mjs";

const AAVE_POOL_INTERFACE = new Interface([
  "function getConfiguration(address asset) view returns (uint256)",
  "function getReserveData(address asset) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))",
]);

function activeReserveConfiguration() {
  return (6n << 48n) | (1n << 56n);
}

function reserveDataResult() {
  return [
    activeReserveConfiguration(),
    1n,
    0n,
    1n,
    0n,
    0n,
    0,
    1,
    "0x3333333333333333333333333333333333333333",
    "0x0000000000000000000000000000000000000000",
    "0x5555555555555555555555555555555555555555",
    "0x6666666666666666666666666666666666666666",
    0n,
    0n,
    0n,
  ];
}

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
    simulateTransactionCallImpl: async (_chain, tx) => {
      if (tx.data.startsWith(AAVE_POOL_INTERFACE.getFunction("getReserveData").selector)) {
        return {
          returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getReserveData", [reserveDataResult()]),
        };
      }
      return {
        returnData: AAVE_POOL_INTERFACE.encodeFunctionResult("getConfiguration", [activeReserveConfiguration()]),
      };
    },
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
