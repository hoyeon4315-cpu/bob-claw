import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMerklCanaryExecutionReadiness,
  buildMerklCanaryExecutionReadiness,
  latestTreasuryInventoryForAddress,
} from "../src/strategy/merkl-canary-execution-readiness.mjs";

test("merkl canary execution readiness detects inventory-ready base candidate", () => {
  const queueItem = {
    opportunityId: "9225447519893092540",
    chain: "base",
    entryAssets: ["steakUSDC", "USDC"],
    queueStatus: "queued_for_tiny_live_canary_preflight",
    capabilityGaps: ["current_inventory_entry_route_required"],
    protocolBindingPlan: {
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    },
  };
  const inventorySnapshot = {
    address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    native: [{ chain: "base", asset: "ETH", actual: "100", actualDecimal: 0.001, status: "below_target" }],
    tokens: [{
      chain: "base",
      ticker: "USDC",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      actual: "414771",
      actualDecimal: 0.414771,
      estimatedUsd: 0.414771,
      status: "refill_required",
    }],
  };

  const readiness = buildMerklCanaryExecutionReadiness({
    queueItem,
    inventorySnapshot,
    now: "2026-04-24T00:30:00.000Z",
  });
  const annotated = applyMerklCanaryExecutionReadiness(queueItem, {
    inventorySnapshot,
    now: "2026-04-24T00:30:00.000Z",
  });

  assert.equal(readiness.status, "inventory_ready");
  assert.equal(readiness.matchedToken.ticker, "USDC");
  assert.equal(annotated.queueStatus, "ready_for_tiny_live_canary");
  assert.equal(annotated.capabilityGaps.includes("current_inventory_entry_route_required"), false);
});

test("merkl canary execution readiness enforces a recent execution cooldown", () => {
  const queueItem = {
    opportunityId: "9225447519893092540",
    chain: "base",
    entryAssets: ["USDC"],
    queueStatus: "queued_for_tiny_live_canary_preflight",
    capabilityGaps: [],
    protocolBindingPlan: {
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    },
  };
  const inventorySnapshot = {
    native: [{ chain: "base", asset: "ETH", actual: "100", actualDecimal: 0.001, status: "below_target" }],
    tokens: [{
      chain: "base",
      ticker: "USDC",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      actual: "414771",
      actualDecimal: 0.414771,
      estimatedUsd: 0.414771,
      status: "refill_required",
    }],
  };
  const canaryExecutions = [{
    observedAt: "2026-04-24T00:05:00.000Z",
    mode: "execute",
    queueItem: { opportunityId: "9225447519893092540" },
    execution: { settlementStatus: "delivered" },
  }];

  const readiness = buildMerklCanaryExecutionReadiness({
    queueItem,
    inventorySnapshot,
    canaryExecutions,
    now: "2026-04-24T00:07:00.000Z",
  });

  assert.equal(readiness.status, "cooldown_active");
  assert.equal(readiness.cooldownActive, true);
  assert.equal(readiness.cooldownUntil, "2026-04-24T00:10:00.000Z");
});

test("latestTreasuryInventoryForAddress selects the latest matching snapshot", () => {
  const snapshot = latestTreasuryInventoryForAddress([
    { address: "0xabc", observedAt: "2026-04-24T00:00:00.000Z" },
    { address: "0xdef", observedAt: "2026-04-24T00:10:00.000Z" },
    { address: "0xAbC", observedAt: "2026-04-24T00:20:00.000Z" },
  ], "0xABC");

  assert.equal(snapshot.observedAt, "2026-04-24T00:20:00.000Z");
});

test("merkl canary execution readiness treats Aave pool canaries as supported when bindings are present", () => {
  const readiness = buildMerklCanaryExecutionReadiness({
    queueItem: {
      opportunityId: "aave-eth-rseth",
      chain: "ethereum",
      entryAssets: ["rsETH", "aEthrsETH"],
      protocolBindingPlan: {
        bindingKind: "aave_v3_pool_supply_withdraw",
        resolvedBinding: {
          poolAddress: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
          assetAddress: "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
          aTokenAddress: "0x2D62109243b87C4bA3EE7bA1D91B0dD0A074d7b1",
          poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
        },
      },
    },
    inventorySnapshot: {
      native: [],
      tokens: [],
    },
    now: "2026-04-24T00:30:00.000Z",
  });

  assert.equal(readiness.status, "inventory_missing");
  assert.equal(readiness.executorSupported, true);
  assert.equal(readiness.reasons.includes("protocol_executor_missing"), false);
});
