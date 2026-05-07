import assert from "node:assert/strict";
import { test } from "node:test";
import { marketNameFromAaveDepositUrl, resolveAaveMarketBinding } from "../src/defi/aave-market-addresses.mjs";

test("aave market binding resolves marketName and provider from deposit URL", () => {
  const depositUrl = "https://app.aave.com/reserve-overview/?underlyingAsset=0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7&marketName=proto_mainnet_v3";

  assert.equal(marketNameFromAaveDepositUrl(depositUrl), "proto_mainnet_v3");

  const binding = resolveAaveMarketBinding({
    chain: "Ethereum",
    depositUrl,
  });

  assert.equal(binding.marketName, "proto_mainnet_v3");
  assert.equal(binding.poolAddressProviderAddress, "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e");
  assert.equal(binding.poolAddress, "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2");
});

test("aave market binding resolves pinned Yei pool from Sei underlying asset URL", () => {
  const depositUrl = "https://app.yei.finance/reserve-overview/?underlyingAsset=0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392";

  const binding = resolveAaveMarketBinding({
    chain: "Sei",
    depositUrl,
  });

  assert.equal(binding.poolAddress, "0x4a4d9abD36F923cBA0Af62A39C01dEC2944fb638");
  assert.equal(binding.poolAddressProviderAddress, null);
});
