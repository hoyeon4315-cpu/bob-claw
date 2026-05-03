import { test } from "node:test";
import assert from "node:assert/strict";
import { markCompoundV2Position } from "../src/treasury/protocol-position-adapters/compound-v2.mjs";

const WALLET_ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const C_TOKEN_ADDRESS = "0xcToken";
const ASSET_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OBSERVED_AT = "2026-05-03T12:00:00.000Z";

function basePosition(overrides = {}) {
  return {
    positionId: "moonwell-pos",
    opportunityId: "moonwell-op",
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    protocolId: "moonwell",
    bindingKind: "compound_v2_supply_withdraw",
    cTokenAddress: C_TOKEN_ADDRESS,
    assetAddress: ASSET_ADDRESS,
    assetDecimals: 6,
    assetSymbol: "USDC",
    ...overrides,
  };
}

test("markCompoundV2Position converts cToken balance through exchange rate", async () => {
  const mark = await markCompoundV2Position({
    position: basePosition(),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 10_000_000_000n;
      if (functionName === "exchangeRateStored") return 2_000_000_000_000_000n;
      return 0n;
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.event, "position_marked");
  assert.equal(mark.adapterId, "compound-v2");
  assert.equal(mark.shareBalance, "10000000000");
  assert.equal(mark.assetBalance, "20000000");
  assert.equal(mark.assetAmount, 20);
  assert.equal(mark.valueUsd, 20);
  assert.equal(mark.valueBtc, 20 / 103000);
  assert.equal(mark.markSource, "onchain_compound_exchange_rate");
});

test("markCompoundV2Position throws a clear error when cTokenAddress is missing", async () => {
  await assert.rejects(
    () => markCompoundV2Position({
      position: basePosition({ cTokenAddress: undefined }),
      walletAddress: WALLET_ADDRESS,
      contractReader: async () => 0n,
      priceReader: async () => 1,
      btcPriceUsd: 103000,
      observedAt: OBSERVED_AT,
    }),
    /cTokenAddress is required/,
  );
});

test("markCompoundV2Position falls back to exchangeRateCurrent only when explicitly allowed", async () => {
  await assert.rejects(
    () => markCompoundV2Position({
      position: basePosition(),
      walletAddress: WALLET_ADDRESS,
      contractReader: async ({ functionName }) => {
        if (functionName === "balanceOf") return 10_000_000_000n;
        if (functionName === "exchangeRateStored") throw new Error("stored unavailable");
        if (functionName === "exchangeRateCurrent") return 2_000_000_000_000_000n;
        return 0n;
      },
      priceReader: async () => 1,
      btcPriceUsd: 103000,
      observedAt: OBSERVED_AT,
    }),
    /stored unavailable/,
  );

  const mark = await markCompoundV2Position({
    position: basePosition({ positionId: "moonwell-current-fallback" }),
    walletAddress: WALLET_ADDRESS,
    allowStateChangingExchangeRate: true,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 10_000_000_000n;
      if (functionName === "exchangeRateStored") throw new Error("stored unavailable");
      if (functionName === "exchangeRateCurrent") return 2_000_000_000_000_000n;
      return 0n;
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.assetBalance, "20000000");
  assert.equal(mark.valueUsd, 20);
});

test("markCompoundV2Position returns zero value when borrow fully offsets supply and price is unavailable", async () => {
  let priceCalls = 0;
  const mark = await markCompoundV2Position({
    position: basePosition({
      isBorrowingLoop: true,
      borrowAssetAddress: ASSET_ADDRESS,
      borrowMarketAddress: C_TOKEN_ADDRESS,
    }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 10_000_000_000n;
      if (functionName === "exchangeRateStored") return 2_000_000_000_000_000n;
      if (functionName === "borrowBalanceStored") return 20_000_000n;
      return 0n;
    },
    priceReader: async () => {
      priceCalls += 1;
      return null;
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
  assert.equal(priceCalls, 0);
});

test("markCompoundV2Position throws when borrow metadata names a different asset", async () => {
  await assert.rejects(
    () => markCompoundV2Position({
      position: basePosition({
        isBorrowingLoop: true,
        borrowAssetAddress: "0xDifferentBorrowAsset",
        borrowMarketAddress: "0xBorrowMarket",
      }),
      walletAddress: WALLET_ADDRESS,
      contractReader: async ({ functionName }) => {
        if (functionName === "balanceOf") return 10_000_000_000n;
        if (functionName === "exchangeRateStored") return 2_000_000_000_000_000n;
        return 0n;
      },
      priceReader: async () => 1,
      btcPriceUsd: 103000,
      observedAt: OBSERVED_AT,
    }),
    /cross-asset borrow metadata is unsupported/,
  );
});

test("markCompoundV2Position subtracts same-asset borrow using borrowMarketAddress", async () => {
  const calls = [];
  const mark = await markCompoundV2Position({
    position: basePosition({
      positionId: "same-asset-borrow",
      borrowAssetAddress: ASSET_ADDRESS,
      borrowMarketAddress: "0xBorrowMarket",
    }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ address, functionName }) => {
      calls.push({ address, functionName });
      if (functionName === "balanceOf") return 10_000_000_000n;
      if (functionName === "exchangeRateStored") return 2_000_000_000_000_000n;
      if (functionName === "borrowBalanceStored") return 5_000_000n;
      return 0n;
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.assetBalance, "15000000");
  assert.equal(mark.debtBalance, "5000000");
  assert.equal(mark.assetAmount, 15);
  assert.equal(mark.valueUsd, 15);
  assert.deepEqual(
    calls.find((call) => call.functionName === "borrowBalanceStored"),
    { address: "0xBorrowMarket", functionName: "borrowBalanceStored" },
  );
});
