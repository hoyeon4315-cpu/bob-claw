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
