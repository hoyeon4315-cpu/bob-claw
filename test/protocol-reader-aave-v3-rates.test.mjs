import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aaveRayToBps,
  readAaveV3ReserveRates,
} from "../src/protocol-readers/readers/aave-v3.mjs";

const RAY = 10n ** 27n;

test("aaveRayToBps converts Aave ray APR to basis points", () => {
  assert.equal(aaveRayToBps(RAY / 20n), 500);
  assert.equal(aaveRayToBps(0n), 0);
  assert.equal(aaveRayToBps(null), null);
});

test("readAaveV3ReserveRates exposes liquidity and variable borrow APR bps", async () => {
  const result = await readAaveV3ReserveRates({
    chain: "base",
    poolAddress: "0xPool",
    assetAddress: "0xAsset",
    now: new Date("2026-05-12T00:00:00.000Z"),
    _providerFactory: () => ({
      getReserveData: async () => ({
        currentLiquidityRate: RAY / 25n,
        currentVariableBorrowRate: RAY / 10n,
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.chain, "base");
  assert.equal(result.assetAddress, "0xAsset");
  assert.equal(result.supplyAprBps, 400);
  assert.equal(result.variableBorrowAprBps, 1000);
  assert.equal(result.observedAt, "2026-05-12T00:00:00.000Z");
});
