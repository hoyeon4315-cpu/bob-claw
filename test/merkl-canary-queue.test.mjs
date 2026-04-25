import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMerklCanaryQueue } from "../src/strategy/merkl-canary-queue.mjs";

test("merkl canary queue turns candidates into deterministic tiny-live work items", () => {
  const report = {
    generatedAt: "2026-04-23T00:00:00.000Z",
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [
      {
        opportunityId: "eth-morpho-usdc",
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "ethereum",
        protocolId: "morpho",
        protocolName: "Morpho",
        name: "Supply USDC to Morpho",
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC", "OP"],
        entryTokenSymbols: ["USDC"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 80,
        aprPct: 8,
        nativeAprPct: 5,
        tvlUsd: 5_000_000,
        score: 90,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: "0x1111111111111111111111111111111111111111",
          assetAddress: "0x2222222222222222222222222222222222222222",
        },
      },
      {
        opportunityId: "base-aave-weth",
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "base",
        protocolId: "aave",
        protocolName: "Aave",
        name: "Supply WETH to Aave",
        family: "eth_destination_lending",
        assetFamilies: ["eth_like"],
        tokenSymbols: ["WETH"],
        hasEthExposure: true,
        mappedStrategyId: "eth_destination_deployment",
        executionSurface: "ethLending",
        campaignRemainingHours: 120,
        aprPct: 4,
        nativeAprPct: 4,
        tvlUsd: 3_000_000,
        score: 86,
        overfitRisk: "minimal",
        overfitFlags: [],
      },
      {
        opportunityId: "base-morpho-usdc",
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "base",
        protocolId: "morpho",
        protocolName: "Morpho",
        name: "Supply USDC to Base Morpho",
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 100,
        aprPct: 6,
        nativeAprPct: 4,
        tvlUsd: 4_000_000,
        score: 88,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: "0x3333333333333333333333333333333333333333",
          assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      },
      {
        opportunityId: "held-wbtc-loop",
        decision: "watch",
        validationMode: "research_only",
        mappedStrategyId: "recursive_wrapped_btc_lending_loop",
      },
    ],
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

  const queue = buildMerklCanaryQueue({
    report,
    now: "2026-04-23T00:00:00.000Z",
    inventorySnapshot,
  });
  assert.equal(queue.summary.queueCount, 3);
  assert.equal(queue.summary.topOpportunityId, "eth-morpho-usdc");
  assert.equal(queue.summary.topExecutableOpportunityId, "base-morpho-usdc");
  assert.equal(queue.summary.executableNowCount, 1);
  assert.equal(queue.summary.autoExecutableNowCount, 1);
  assert.equal(queue.summary.topBlockingReason, "executable_candidate_available");
  assert.equal(queue.summary.readinessByStatus.inventory_ready, 1);
  assert.equal(queue.summary.capabilityGapCounts.current_inventory_entry_route_required, 2);
  assert.equal(queue.summary.protocolBindingReadyCount, 2);
  assert.equal(queue.summary.protocolBindingRequiredCount, 1);
  assert.equal(queue.queue[0].queueStatus, "queued_for_tiny_live_canary_preflight");
  assert.equal(queue.queue[0].canaryKind, "deposit_withdraw_tiny_stable_carry");
  assert.ok(queue.queue[0].capabilityGaps.includes("ethereum_l1_gas_ev_positive_check_required"));
  assert.equal(queue.queue[0].capabilityGaps.includes("protocol_position_binding_required"), false);
  assert.equal(queue.queue[0].protocolBindingPlan.status, "binding_ready");
  assert.deepEqual(queue.queue[0].entryAssets, ["USDC"]);
  assert.equal(queue.queue[1].executionReadiness.status, "inventory_ready");
  assert.equal(queue.queue[1].autoEntry.autoExecute, true);
  assert.equal(queue.summary.byStrategy.gateway_native_asset_conversion_sleeve, 2);
  assert.equal(queue.summary.byStrategy.eth_destination_deployment, 1);
});

test("merkl canary queue summarizes the top blocker when no candidate is executable", () => {
  const report = {
    generatedAt: "2026-04-23T00:00:00.000Z",
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [
      {
        opportunityId: "eth-morpho-usdc",
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "ethereum",
        protocolId: "morpho",
        protocolName: "Morpho",
        name: "Supply USDC to Morpho",
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC"],
        entryTokenSymbols: ["USDC"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 80,
        aprPct: 8,
        nativeAprPct: 5,
        tvlUsd: 5_000_000,
        score: 90,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: "0x1111111111111111111111111111111111111111",
          assetAddress: "0x2222222222222222222222222222222222222222",
        },
      },
    ],
  };

  const queue = buildMerklCanaryQueue({
    report,
    now: "2026-04-23T00:00:00.000Z",
    inventorySnapshot: { native: [], tokens: [] },
  });

  assert.equal(queue.summary.queueCount, 1);
  assert.equal(queue.summary.executableNowCount, 0);
  assert.equal(queue.summary.autoExecutableNowCount, 0);
  assert.equal(queue.summary.topBlockingReason, "inventory_missing");
  assert.equal(queue.summary.readinessByStatus.inventory_missing, 1);
  assert.equal(queue.summary.capabilityGapCounts.ethereum_l1_gas_ev_positive_check_required, 1);
});
