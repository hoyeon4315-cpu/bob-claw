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
        tokenSymbols: ["USDC"],
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
        opportunityId: "held-wbtc-loop",
        decision: "watch",
        validationMode: "research_only",
        mappedStrategyId: "recursive_wrapped_btc_lending_loop",
      },
    ],
  };

  const queue = buildMerklCanaryQueue({ report, now: "2026-04-23T00:00:00.000Z" });
  assert.equal(queue.summary.queueCount, 2);
  assert.equal(queue.summary.topOpportunityId, "eth-morpho-usdc");
  assert.equal(queue.queue[0].queueStatus, "queued_for_tiny_live_canary_preflight");
  assert.equal(queue.queue[0].canaryKind, "deposit_withdraw_tiny_stable_carry");
  assert.ok(queue.queue[0].capabilityGaps.includes("ethereum_l1_gas_ev_positive_check_required"));
  assert.ok(queue.queue[0].capabilityGaps.includes("protocol_position_adapter_required"));
  assert.deepEqual(queue.queue[0].entryAssets, ["USDC"]);
  assert.equal(queue.summary.byStrategy.gateway_native_asset_conversion_sleeve, 1);
  assert.equal(queue.summary.byStrategy.eth_destination_deployment, 1);
});
