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
});

test("protocol canary bindings cover Aave and Euler without enabling unsupported protocols", () => {
  const aave = buildProtocolCanaryBindingPlan({
    opportunity: { protocolId: "aave", executionSurface: "ethLending" },
  });
  assert.equal(aave.bindingKind, "aave_v3_pool_supply_withdraw");
  assert.deepEqual(aave.missingBindingFields, ["poolAddress", "assetAddress", "aTokenAddress"]);

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
