import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProtocolCanaryBindingPlan,
  resolveProtocolCanaryBinding,
} from "../src/defi/protocol-canary-bindings.mjs";

test("protocol canary bindings define deterministic Morpho deposit and withdraw steps", () => {
  const binding = resolveProtocolCanaryBinding("morpho");
  assert.equal(binding.bindingKind, "erc4626_vault_supply_withdraw");

  const missing = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "morpho", executionSurface: "stableCarry" },
  });
  assert.equal(missing.status, "binding_required");
  assert.deepEqual(missing.missingBindingFields, ["vaultAddress", "assetAddress"]);
  assert.equal(missing.canaryActions.includes("deposit_asset_for_shares"), true);
  assert.equal(missing.canaryActions.includes("withdraw_or_redeem_shares"), true);

  const ready = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "morpho", executionSurface: "stableCarry" },
    binding: {
      vaultAddress: "0x1111111111111111111111111111111111111111",
      assetAddress: "0x2222222222222222222222222222222222222222",
    },
  });
  assert.equal(ready.status, "binding_ready");
  assert.deepEqual(ready.missingBindingFields, []);
  assert.equal(ready.resolvedBinding.vaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(ready.resolvedBinding.assetAddress, "0x2222222222222222222222222222222222222222");
});

test("protocol canary bindings cover Aave and Euler without enabling unsupported protocols", () => {
  const aave = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "aave", executionSurface: "ethLending" },
    binding: {
      poolAddress: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      assetAddress: "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
      aTokenAddress: "0x2D62109243b87C4bA3EE7bA1D91B0dD0A074d7b1",
      poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
      marketName: "proto_mainnet_v3",
    },
  });
  assert.equal(aave.bindingKind, "aave_v3_pool_supply_withdraw");
  assert.equal(aave.status, "binding_ready");
  assert.deepEqual(aave.missingBindingFields, []);
  assert.equal(aave.resolvedBinding.marketName, "proto_mainnet_v3");
  assert.equal(aave.resolvedBinding.poolAddressProviderAddress, "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e");

  const aaveMissing = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "aave", executionSurface: "ethLending" },
  });
  assert.deepEqual(aaveMissing.missingBindingFields, ["poolAddress", "assetAddress", "aTokenAddress"]);

  const euler = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "euler", executionSurface: "stableBorrow" },
    binding: {
      vaultAddress: "0x3333333333333333333333333333333333333333",
      assetAddress: "0x4444444444444444444444444444444444444444",
    },
  });
  assert.equal(euler.status, "binding_ready");

  const unknown = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "unknown", executionSurface: "stableCarry" },
  });
  assert.equal(unknown.status, "unsupported_protocol_binding");
});

test("protocol canary bindings cover YO ERC-4626 vault canaries", () => {
  const ready = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "yo", executionSurface: "stableCarry" },
    binding: {
      vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
    },
  });

  assert.equal(ready.status, "binding_ready");
  assert.equal(ready.bindingKind, "erc4626_vault_supply_withdraw");
  assert.equal(ready.resolvedBinding.vaultAddress, "0x0000000f2eB9f69274678c76222B35eEc7588a65");
  assert.equal(ready.canaryActions.includes("deposit_asset_for_shares"), true);
});

test("protocol canary bindings cover Summer Finance ERC-4626 vault canaries", () => {
  const ready = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "summerfinance", executionSurface: "ethLending" },
    binding: {
      vaultAddress: "0x67e536797570b3d8919Df052484273815A0aB506",
      assetAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      shareTokenAddress: "0x67e536797570b3d8919Df052484273815A0aB506",
    },
  });

  assert.equal(ready.status, "binding_ready");
  assert.equal(ready.bindingKind, "erc4626_vault_supply_withdraw");
  assert.equal(ready.resolvedBinding.assetAddress, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
});

test("protocol canary bindings classify Yei as Aave-like but require a pool binding", () => {
  const missingPool = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "yei", executionSurface: "stableCarry" },
    binding: {
      assetAddress: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
      aTokenAddress: "0x817B3C191092694C65f25B4d38D4935a8aB65616",
    },
  });

  assert.equal(missingPool.bindingKind, "aave_v3_pool_supply_withdraw");
  assert.equal(missingPool.status, "binding_required");
  assert.deepEqual(missingPool.missingBindingFields, ["poolAddress"]);
});
