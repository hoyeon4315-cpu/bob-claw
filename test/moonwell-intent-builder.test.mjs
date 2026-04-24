import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMoonwellWrappedBtcLoopIntent } from "../src/executor/helpers/moonwell-intent-builder.mjs";

test("buildMoonwellWrappedBtcLoopIntent omits borrow step when borrowUnits is not supplied", async () => {
  const plan = await buildMoonwellWrappedBtcLoopIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    amountUsd: 5,
    collateralUnits: "8333",
    borrowUnits: null,
    collateralAssetAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    borrowAssetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    collateralMTokenAddress: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
    borrowMTokenAddress: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
    comptrollerAddress: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
    estimateGasImpl: () => ({ gasUnits: 21_000 }),
    now: "2026-04-24T00:00:00.000Z",
  });

  assert.deepEqual(plan.steps.map((step) => step.id), [
    "approve_collateral_to_mtoken",
    "enter_markets",
    "mint_collateral",
  ]);
  assert.equal(plan.borrowUnits, null);
});
