import test from "node:test";
import assert from "node:assert/strict";
import {
  selectMerklCanaryAutopilotCandidate,
  sizeMerklCanaryAmount,
} from "../src/executor/merkl-canary-autopilot.mjs";

function queueItem(overrides = {}) {
  return {
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "morpho",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    priorityScore: 100,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        shareTokenAddress: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
        assetDecimals: 6,
      },
    },
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "414771",
        estimatedUsd: 0.414771,
      },
      matchedNative: {
        asset: "ETH",
        actual: "1000000000000000",
        estimatedUsd: 2,
      },
    },
    ...overrides,
  };
}

test("sizes Merkl canary amount to the committed per-tx cap and inventory", () => {
  const sizing = sizeMerklCanaryAmount(queueItem());

  assert.equal(sizing.status, "ready");
  assert.equal(sizing.amount, "250000");
  assert.equal(sizing.amountUsd, 0.25);
});

test("blocks Ethereum canaries when committed caps are below the gas-efficiency notional floor", () => {
  const sizing = sizeMerklCanaryAmount(queueItem({
    chain: "ethereum",
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "100000000",
        estimatedUsd: 100,
      },
      matchedNative: {
        asset: "ETH",
        actual: "100000000000000000",
        estimatedUsd: 250,
      },
    },
  }));

  assert.equal(sizing.status, "blocked");
  assert.ok(sizing.blockers.includes("cap_too_low_for_ethereum_gas_efficiency"));
});

test("selects the highest priority non-Ethereum ready candidate", () => {
  const base = queueItem({ opportunityId: "base", priorityScore: 90 });
  const ethereum = queueItem({
    opportunityId: "ethereum",
    chain: "ethereum",
    priorityScore: 120,
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "100000000",
        estimatedUsd: 100,
      },
      matchedNative: {
        asset: "ETH",
        actual: "100000000000000000",
        estimatedUsd: 250,
      },
    },
  });

  const selection = selectMerklCanaryAutopilotCandidate({ queue: [ethereum, base] });

  assert.equal(selection.readyCount, 1);
  assert.equal(selection.selected.queueItem.opportunityId, "base");
});

test("refreshes queue readiness from latest canary executions before selecting", () => {
  const selection = selectMerklCanaryAutopilotCandidate(
    { queue: [queueItem({ opportunityId: "base" })] },
    {
      canaryExecutions: [
        {
          observedAt: new Date().toISOString(),
          mode: "execute",
          queueItem: { opportunityId: "base" },
          execution: { settlementStatus: "delivered" },
        },
      ],
      inventorySnapshot: {
        native: [
          {
            chain: "base",
            actual: "1000000000000000",
            estimatedUsd: 2,
          },
        ],
        tokens: [
          {
            chain: "base",
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            ticker: "USDC",
            actual: "414771",
            estimatedUsd: 0.414771,
          },
        ],
      },
    },
  );

  assert.equal(selection.readyCount, 0);
  assert.equal(selection.selected, null);
  assert.ok(selection.candidates[0].sizing.blockers.includes("cooldown_active"));
});
