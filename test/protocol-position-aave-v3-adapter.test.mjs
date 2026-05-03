import { test } from "node:test";
import assert from "node:assert/strict";
import { markAaveV3Position } from "../src/treasury/protocol-position-adapters/aave-v3.mjs";

const WALLET_ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const ASSET_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const A_TOKEN_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48-atoken";
const OBSERVED_AT = "2026-05-03T12:00:00.000Z";

function basePosition(overrides = {}) {
  return {
    positionId: "aave-pos",
    opportunityId: "aave-op",
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "ethereum",
    protocolId: "aave-v3",
    bindingKind: "aave_v3_supply_withdraw",
    assetAddress: ASSET_ADDRESS,
    aTokenAddress: A_TOKEN_ADDRESS,
    assetDecimals: 6,
    assetSymbol: "USDC",
    ...overrides,
  };
}

test("markAaveV3Position subtracts debt from supplied value when debt token exists", async () => {
  const mark = await markAaveV3Position({
    position: basePosition({
      variableDebtTokenAddress: "0xDebt",
    }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ address, functionName }) => {
      if (functionName !== "balanceOf") throw new Error("unexpected function");
      if (address === A_TOKEN_ADDRESS) return 20_000_000n;
      if (address === "0xDebt") return 5_000_000n;
      return 0n;
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.event, "position_marked");
  assert.equal(mark.adapterId, "aave-v3");
  assert.equal(mark.assetBalance, "15000000");
  assert.equal(mark.debtBalance, "5000000");
  assert.equal(mark.assetAmount, 15);
  assert.equal(mark.assetPriceUsd, 1);
  assert.equal(mark.valueUsd, 15);
  assert.equal(mark.valueBtc, 15 / 103000);
  assert.equal(mark.markSource, "onchain_aave_token_balances");
});

test("markAaveV3Position throws a clear error when aTokenAddress is missing", async () => {
  await assert.rejects(
    () => markAaveV3Position({
      position: basePosition({ aTokenAddress: undefined }),
      walletAddress: WALLET_ADDRESS,
      contractReader: async () => 0n,
      priceReader: async () => 1,
      btcPriceUsd: 103000,
      observedAt: OBSERVED_AT,
    }),
    /aTokenAddress is required/,
  );
});

test("markAaveV3Position returns zero value when debt fully offsets supply and price is unavailable", async () => {
  const mark = await markAaveV3Position({
    position: basePosition({
      variableDebtTokenAddress: "0xVariableDebt",
      stableDebtTokenAddress: "0xStableDebt",
    }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ address, functionName }) => {
      if (functionName !== "balanceOf") throw new Error("unexpected function");
      if (address === A_TOKEN_ADDRESS) return 20_000_000n;
      if (address === "0xVariableDebt") return 12_000_000n;
      if (address === "0xStableDebt") return 8_000_000n;
      return 0n;
    },
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.assetBalance, "0");
  assert.equal(mark.debtBalance, "20000000");
  assert.equal(mark.assetAmount, 0);
  assert.equal(mark.assetPriceUsd, null);
  assert.equal(mark.valueUsd, 0);
  assert.equal(mark.valueBtc, 0);
});
