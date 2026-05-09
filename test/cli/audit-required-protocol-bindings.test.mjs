import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  buildRequiredProtocolBindingsAudit,
  runAuditRequiredProtocolBindings,
} from "../../src/cli/audit-required-protocol-bindings.mjs";

function opportunity(overrides = {}) {
  return {
    decision: "candidate",
    opportunityId: overrides.opportunityId || "morpho-usdc",
    chain: overrides.chain || "base",
    protocolId: overrides.protocolId || "morpho",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    executionSurface: overrides.executionSurface || "stableCarry",
    protocolBinding: overrides.protocolBinding || {
      vaultAddress: "0x0000000000000000000000000000000000000101",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      assetSymbol: "USDC",
      assetDecimals: 6,
      shareTokenAddress: "0x0000000000000000000000000000000000000101",
      shareTokenSymbol: "vaultUSDC",
    },
    protocolBindingPlan: overrides.protocolBindingPlan,
  };
}

test("protocol binding audit reports existing ERC4626 bindings as supported, not auto-addable", async () => {
  const audit = await buildRequiredProtocolBindingsAudit({
    opportunities: [opportunity()],
  }, { generatedAt: "2026-05-09T00:00:00.000Z" });

  assert.equal(audit.summary.requiredCount, 1);
  assert.equal(audit.summary.alreadySupportedCount, 1);
  assert.equal(audit.summary.autoAddableCount, 0);
  assert.equal(audit.required[0].bindingKind, "erc4626_vault_supply_withdraw");
  assert.equal(audit.required[0].classification, "binding_kind_already_supported");
});

test("protocol binding audit only marks verified ERC4626-compatible unknown kinds auto-addable", async () => {
  const audit = await buildRequiredProtocolBindingsAudit({
    opportunities: [
      opportunity({
        opportunityId: "custom-erc4626",
        protocolId: "customvault",
        protocolBindingPlan: {
          status: "binding_ready",
          protocolId: "customvault",
          bindingKind: "custom_verified_erc4626_vault",
          missingBindingFields: [],
          resolvedBinding: {
            vaultAddress: "0x0000000000000000000000000000000000000202",
            assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            assetSymbol: "USDC",
            assetDecimals: 6,
            shareTokenAddress: "0x0000000000000000000000000000000000000202",
          },
          canaryActions: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
          erc4626Proof: { status: "verified", ok: true },
        },
      }),
      opportunity({
        opportunityId: "aave-like",
        protocolId: "yei",
        protocolBindingPlan: {
          status: "binding_ready",
          protocolId: "yei",
          bindingKind: "aave_v3_pool_supply_withdraw",
          missingBindingFields: [],
          resolvedBinding: {
            poolAddress: "0x0000000000000000000000000000000000000303",
            assetAddress: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
            assetSymbol: "USDC",
            assetDecimals: 6,
            aTokenAddress: "0x0000000000000000000000000000000000000404",
          },
          canaryActions: ["supply_asset_to_pool", "withdraw_asset_from_pool"],
        },
      }),
    ],
  });

  const custom = audit.required.find((item) => item.protocolId === "customvault");
  assert.equal(custom.autoAddable, true);
  assert.equal(custom.classification, "auto_addable_erc4626_binding");

  const yei = audit.required.find((item) => item.protocolId === "yei");
  assert.equal(yei.autoAddable, false);
  assert.equal(yei.classification, "manual_operator_review_required");
  assert.equal(audit.summary.manualOnlyCount, 1);
});

test("protocol binding CLI writes audit JSON", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-binding-audit-"));
  const input = join(cwd, "report.json");
  const out = join(cwd, "audit.json");
  await writeFile(input, JSON.stringify({ opportunities: [opportunity()] }), "utf8");

  const audit = await runAuditRequiredProtocolBindings({
    input,
    out,
    write: true,
    probeRpc: false,
  });
  assert.equal(audit.summary.requiredCount, 1);
  const written = JSON.parse(await readFile(out, "utf8"));
  assert.equal(written.required[0].bindingKind, "erc4626_vault_supply_withdraw");
});
