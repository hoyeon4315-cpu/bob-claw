import { test } from "node:test";
import assert from "node:assert/strict";
import { markErc4626Position } from "../src/treasury/protocol-position-adapters/erc4626.mjs";

const WALLET_ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const SHARE_TOKEN_ADDRESS = "0x0000000f2eB9f69274678c76222B35eEc7588a65";
const ASSET_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OBSERVED_AT = "2026-05-03T12:00:00.000Z";

function basePosition(overrides = {}) {
  return {
    positionId: "merkl:base:137:0x7e",
    opportunityId: "137",
    strategyId: "gateway_native_asset_conversion_sleeve",
    chain: "base",
    protocolId: "yo",
    bindingKind: "erc4626_vault_supply_withdraw",
    shareTokenAddress: SHARE_TOKEN_ADDRESS,
    assetAddress: ASSET_ADDRESS,
    ...overrides,
  };
}

test("markErc4626Position converts vault shares into current underlying USD", async () => {
  const calls = [];
  const contractReader = async ({ address, functionName, args }) => {
    calls.push({ address, functionName, args });
    if (functionName === "balanceOf") return 4_792_900n;
    if (functionName === "convertToAssets") return 5_015_801n;
    if (functionName === "asset") return ASSET_ADDRESS;
    if (functionName === "decimals") return 6;
    if (functionName === "symbol") return "USDC";
    throw new Error(`unexpected call ${functionName}`);
  };

  const mark = await markErc4626Position({
    position: basePosition(),
    walletAddress: WALLET_ADDRESS,
    contractReader,
    priceReader: async ({ symbol }) => (symbol === "USDC" ? 1 : null),
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.event, "position_marked");
  assert.equal(mark.adapterId, "erc4626");
  assert.equal(mark.assetBalance, "5015801");
  assert.equal(mark.assetAmount, 5.015801);
  assert.equal(mark.valueUsd, 5.015801);
  assert.equal(mark.valueBtc, 5.015801 / 103000);
  assert.equal(mark.markSource, "onchain_erc4626_convert_to_assets");
  assert.equal(calls.some((call) => call.functionName === "convertToAssets"), true);
});

test("markErc4626Position returns zero mark when the vault share balance is zero", async () => {
  const calls = [];
  const mark = await markErc4626Position({
    position: basePosition({ positionId: "p-zero" }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      calls.push(functionName);
      if (functionName === "balanceOf") return 0n;
      if (functionName === "asset") return ASSET_ADDRESS;
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      throw new Error(`unexpected call ${functionName}`);
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.shareBalance, "0");
  assert.equal(mark.assetBalance, "0");
  assert.equal(mark.valueUsd, 0);
  assert.equal(mark.assetAmount, 0);
  assert.equal(calls.includes("convertToAssets"), false);
});

test("markErc4626Position returns zero value when share balance is zero and price is unavailable", async () => {
  const mark = await markErc4626Position({
    position: basePosition({ positionId: "p-zero-no-price" }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 0n;
      if (functionName === "asset") return ASSET_ADDRESS;
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      throw new Error(`unexpected call ${functionName}`);
    },
    priceReader: async () => null,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.assetPriceUsd, null);
  assert.equal(mark.assetAmount, 0);
  assert.equal(mark.valueUsd, 0);
  assert.equal(mark.valueBtc, 0);
});

test("markErc4626Position converts 18-decimal balances without pre-decimal precision loss", async () => {
  const mark = await markErc4626Position({
    position: basePosition({
      assetDecimals: 18,
      assetSymbol: "WETH",
    }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 1_000_000_000_000_000_000n;
      if (functionName === "convertToAssets") return 1_234_567_890_123_456_789n;
      throw new Error(`unexpected call ${functionName}`);
    },
    priceReader: async () => 2,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.assetBalance, "1234567890123456789");
  assert.equal(mark.assetAmount, 1.2345678901234567);
  assert.equal(mark.valueUsd, 2.4691357802469134);
});

test("markErc4626Position reads asset metadata when position omits assetAddress", async () => {
  const calls = [];
  const mark = await markErc4626Position({
    position: basePosition({
      assetAddress: undefined,
      assetDecimals: undefined,
      assetSymbol: undefined,
      vaultAddress: SHARE_TOKEN_ADDRESS,
    }),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ address, functionName }) => {
      calls.push({ address, functionName });
      if (functionName === "balanceOf") return 10_000_000_000_000_000n;
      if (functionName === "convertToAssets") return 2_500_000n;
      if (functionName === "asset") return ASSET_ADDRESS;
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      throw new Error(`unexpected call ${functionName}`);
    },
    priceReader: async ({ token, symbol }) => (token === ASSET_ADDRESS && symbol === "USDC" ? 1 : null),
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.assetAddress, ASSET_ADDRESS);
  assert.equal(mark.assetSymbol, "USDC");
  assert.equal(mark.assetDecimals, 6);
  assert.equal(mark.assetAmount, 2.5);
  assert.equal(calls.some((call) => call.functionName === "asset" && call.address === SHARE_TOKEN_ADDRESS), true);
  assert.equal(calls.some((call) => call.functionName === "decimals" && call.address === ASSET_ADDRESS), true);
});

test("markErc4626Position throws clear errors for missing required inputs", async () => {
  await assert.rejects(
    () => markErc4626Position(),
    /position is required/,
  );
  await assert.rejects(
    () => markErc4626Position({
      position: basePosition(),
      contractReader: async () => 0n,
      priceReader: async () => 1,
    }),
    /walletAddress is required/,
  );
  await assert.rejects(
    () => markErc4626Position({
      position: basePosition({ shareTokenAddress: undefined, vaultAddress: undefined }),
      walletAddress: WALLET_ADDRESS,
      contractReader: async () => 0n,
      priceReader: async () => 1,
    }),
    /shareTokenAddress or vaultAddress is required/,
  );
  await assert.rejects(
    () => markErc4626Position({
      position: basePosition(),
      walletAddress: WALLET_ADDRESS,
      priceReader: async () => 1,
    }),
    /contractReader is required/,
  );
  await assert.rejects(
    () => markErc4626Position({
      position: basePosition(),
      walletAddress: WALLET_ADDRESS,
      contractReader: async () => 0n,
    }),
    /priceReader is required/,
  );
});

test("markErc4626Position leaves valueUsd null when priceReader has no price", async () => {
  const mark = await markErc4626Position({
    position: basePosition(),
    walletAddress: WALLET_ADDRESS,
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 4_792_900n;
      if (functionName === "convertToAssets") return 5_015_801n;
      if (functionName === "asset") return ASSET_ADDRESS;
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      throw new Error(`unexpected call ${functionName}`);
    },
    priceReader: async () => null,
    btcPriceUsd: 103000,
    observedAt: OBSERVED_AT,
  });

  assert.equal(mark.assetPriceUsd, null);
  assert.equal(mark.valueUsd, null);
  assert.equal(mark.valueBtc, null);
});
