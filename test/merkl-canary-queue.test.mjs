import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMerklCanaryQueue } from "../src/strategy/merkl-canary-queue.mjs";

const _h = (c) => "0x" + c.repeat(40 / c.length).slice(0, 40);
const DUMMY = { addr1: _h("1"), addr2: _h("2"), addr3: _h("32"), addrB: _h("B4"), addrC: _h("C5") };

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
          vaultAddress: DUMMY.addr1,
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
          vaultAddress: DUMMY.addr3,
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
  assert.equal(queue.summary.queueAutoEntryReadyCount, 1);
  assert.equal(queue.summary.policyReadyCount, 0);
  assert.equal(queue.summary.planBuilderReadyCount, 0);
  assert.equal(queue.summary.signerIntentReadyCount, 0);
  assert.equal(queue.summary.actualBroadcastCount, 0);
  assert.deepEqual(queue.summary.topEvBlockers, []);
  assert.equal(queue.summary.inventoryReadyCount, 1);
  assert.equal(queue.summary.autoEntryReadyCount, 1);
  assert.equal(queue.summary.executableNowStage, "inventory_ready_before_sizing_policy_and_signer");
  assert.equal(queue.summary.finalExecutionRequires.includes("opportunity_policy_positive_ev"), true);
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
  assert.ok(queue.summary.representativeCoverage.missingRepresentativeChainCount > 0);
  assert.equal(queue.representativeCoverage.policy.executionRule.includes("never bypass"), true);
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
          vaultAddress: DUMMY.addr1,
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
  assert.equal(queue.summary.inventoryReadyCount, 0);
  assert.equal(queue.summary.autoEntryReadyCount, 0);
  assert.equal(queue.summary.executableNowStage, "inventory_ready_before_sizing_policy_and_signer");
  assert.equal(queue.summary.topBlockingReason, "inventory_missing");
  assert.equal(queue.summary.readinessByStatus.inventory_missing, 1);
  assert.equal(queue.summary.capabilityGapCounts.ethereum_l1_gas_ev_positive_check_required, 1);
});

test("merkl canary queue preserves at least one BSC candidate when the limit would otherwise hide it", () => {
  const report = {
    generatedAt: "2026-05-08T00:00:00.000Z",
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [
      ...Array.from({ length: 3 }, (_, index) => ({
        opportunityId: `base-top-${index}`,
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "base",
        protocolId: "morpho",
        protocolName: "Morpho",
        name: `Base top ${index}`,
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 120,
        aprPct: 8,
        nativeAprPct: 8,
        tvlUsd: 5_000_000,
        score: 100 - index,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: `0x${String(index + 1).repeat(40)}`,
          assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      })),
      {
        opportunityId: "bsc-venus-usdc",
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "bsc",
        protocolId: "venus",
        protocolName: "Venus",
        name: "BSC Venus USDC",
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 120,
        aprPct: 5,
        nativeAprPct: 5,
        tvlUsd: 3_000_000,
        score: 10,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: DUMMY.addr1,
          assetAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        },
      },
    ],
  };

  const queue = buildMerklCanaryQueue({
    report,
    limit: 2,
    now: "2026-05-08T00:00:00.000Z",
    inventorySnapshot: { native: [], tokens: [] },
  });

  assert.equal(queue.summary.queueCount, 2);
  assert.equal(queue.summary.byChain.bsc, 1);
  assert.equal(queue.queue.some((item) => item.opportunityId === "bsc-venus-usdc"), true);
  assert.equal(queue.summary.representationGap.flag, "representation_gap");
  assert.equal(queue.summary.representationGap.forcedChainQuota.bsc, 1);
});

test("merkl auto entry admits inventory-backed Ethereum vault canaries within live-validation caps", () => {
  const report = {
    generatedAt: "2026-04-25T00:00:00.000Z",
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [
      {
        opportunityId: "eth-morpho-share-token-usdc",
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "ethereum",
        protocolId: "morpho",
        protocolName: "Morpho",
        name: "Supply USDC to Morpho share-token vault",
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC", "CSUSDCCORE"],
        entryTokenSymbols: ["USDC", "CSUSDCCORE"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 96,
        aprPct: 4,
        nativeAprPct: 7,
        tvlUsd: 5_000_000,
        score: 90,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: DUMMY.addr1,
          assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          shareTokenAddress: DUMMY.addr1,
        },
      },
    ],
  };

  const queue = buildMerklCanaryQueue({
    report,
    now: "2026-04-25T00:00:00.000Z",
    inventorySnapshot: {
      native: [{ chain: "ethereum", asset: "ETH", actual: "10000000000000000", estimatedUsd: 20 }],
      tokens: [{
        chain: "ethereum",
        ticker: "USDC",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        actual: "50000000",
        actualDecimal: 50,
        estimatedUsd: 50,
      }],
    },
  });

  assert.equal(queue.summary.executableNowCount, 1);
  assert.equal(queue.summary.autoExecutableNowCount, 1);
  assert.equal(queue.queue[0].autoEntry.autoExecute, true);
  assert.deepEqual(queue.queue[0].autoEntry.blockers, []);
  assert.ok(queue.queue[0].capabilityGaps.includes("ethereum_l1_gas_ev_positive_check_required"));
  assert.ok(queue.queue[0].capabilityGaps.includes("chain_live_dex_route_unproven_or_missing_stable_output"));
});

test("merkl canary queue carries latest policy/signer stage truth from autopilot evidence", () => {
  const report = {
    generatedAt: "2026-05-10T00:00:00.000Z",
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [
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
          vaultAddress: DUMMY.addr3,
          assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      },
    ],
  };

  const queue = buildMerklCanaryQueue({
    report,
    now: "2026-05-10T00:00:00.000Z",
    inventorySnapshot: {
      native: [{ chain: "base", asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 }],
      tokens: [{
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        actual: "5000000",
        actualDecimal: 5,
        estimatedUsd: 5,
      }],
    },
    autopilotReports: [{
      observedAt: "2026-05-10T00:01:00.000Z",
      mode: "execute",
      summary: {
        executionReadyCount: 0,
        previewReadyCount: 0,
        deliveredCount: 0,
        topBlocker: "same_chain_unprofitable:need_$57_on_base",
        topEvGate: {
          blocker: "same_chain_unprofitable:need_$57_on_base",
          currentAmountUsd: 5,
          neededUsd: 56.2,
          holdDays: 4.16,
          limitingFactor: "inventory",
        },
      },
    }],
  });

  assert.equal(queue.summary.queueAutoEntryReadyCount, 1);
  assert.equal(queue.summary.policyReadyCount, 0);
  assert.equal(queue.summary.signerIntentReadyCount, 0);
  assert.equal(queue.summary.actualBroadcastCount, 0);
  assert.deepEqual(queue.summary.topEvBlockers, [{
    blocker: "same_chain_unprofitable:need_$57_on_base",
    currentAmountUsd: 5,
    neededUsd: 56.2,
    holdDays: 4.16,
    limitingFactor: "inventory",
  }]);
});

test("merkl canary queue admits Pendle YT through registry-first binding and EV proof", () => {
  const report = {
    generatedAt: "2026-05-10T00:00:00.000Z",
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [{
      opportunityId: "base-pendle-yt-usdc",
      decision: "candidate",
      validationMode: "tiny_live_canary_only",
      chain: "base",
      protocolId: "pendle",
      protocolName: "Pendle",
      name: "Generic Pendle YT USDC",
      family: "stable_yield_token",
      assetFamilies: ["stablecoin"],
      tokenSymbols: ["YT-USDC", "USDC"],
      entryTokenSymbols: ["USDC"],
      hasStableExposure: true,
      mappedStrategyId: "gateway_native_asset_conversion_sleeve",
      executionSurface: "fixedYield",
      campaignRemainingHours: 240,
      aprPct: 500,
      nativeAprPct: 500,
      tvlUsd: 2_000_000,
      score: 95,
      overfitRisk: "minimal",
      overfitFlags: [],
      protocolBinding: {
        source: "merkl_opportunity",
        instrument: "yt",
        marketAddress: DUMMY.addr1,
        ytTokenAddress: "******************************************",
        ytTokenSymbol: "YT-USDC",
        assetAddress: DUMMY.addr3,
        assetSymbol: "USDC",
        assetDecimals: 6,
        maturity: "2026-08-10T00:00:00.000Z",
        exitQuote: {
          source: "odos",
          outputUsd: 10.2,
          depthUsd: 25,
          slippageBps: 45,
        },
      },
    }],
  };

  const queue = buildMerklCanaryQueue({
    report,
    now: "2026-05-10T00:00:00.000Z",
    inventorySnapshot: {
      native: [{ chain: "base", asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 }],
      tokens: [{
        chain: "base",
        ticker: "USDC",
        token: DUMMY.addr3,
        actual: "15000000",
        actualDecimal: 15,
        estimatedUsd: 15,
      }],
    },
  });

  assert.equal(queue.summary.pendleYtCount, 1);
  assert.equal(queue.summary.pendleYtCanaryReadyCount, 1);
  assert.equal(queue.summary.executableNowCount, 1);
  assert.equal(queue.summary.autoExecutableNowCount, 1);
  assert.equal(queue.queue[0].protocolBindingPlan.bindingKind, "pendle_yt_buy_sell_redeem");
  assert.equal(queue.queue[0].protocolBindingPlan.status, "binding_ready");
  assert.equal(queue.queue[0].executionReadiness.executorSupported, true);
  assert.equal(queue.queue[0].pendleYt.ev.canaryReady, true);
  assert.equal(queue.queue[0].capabilityGaps.includes("yt_exit_quote_missing"), false);
  assert.equal(queue.queue[0].autoEntry.autoExecute, true);
  assert.deepEqual(queue.queue[0].autoEntry.blockers, []);
});

test("merkl canary queue blocks Pendle YT without exit quote instead of falling back to Base/PT", () => {
  const report = {
    generatedAt: "2026-05-10T00:00:00.000Z",
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [{
      opportunityId: "bsc-pendle-yt-btc",
      decision: "candidate",
      validationMode: "tiny_live_canary_only",
      chain: "bsc",
      protocolId: "pendle",
      protocolName: "Pendle",
      name: "Generic Pendle YT BTC",
      family: "btc_yield_token",
      assetFamilies: ["btc_like"],
      tokenSymbols: ["YT-SOLVBTC", "SOLVBTC"],
      entryTokenSymbols: ["SOLVBTC"],
      hasBtcExposure: true,
      mappedStrategyId: "gateway_native_asset_conversion_sleeve",
      executionSurface: "fixedYield",
      campaignRemainingHours: 240,
      aprPct: 120,
      nativeAprPct: 120,
      tvlUsd: 2_000_000,
      score: 90,
      overfitRisk: "minimal",
      overfitFlags: [],
      protocolBinding: {
        source: "merkl_opportunity",
        instrument: "yt",
        marketAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ytTokenAddress: DUMMY.addrB,
        assetAddress: DUMMY.addrC,
        assetSymbol: "SOLVBTC",
        assetDecimals: 18,
        maturity: "2026-06-10T00:00:00.000Z",
      },
    }],
  };

  const queue = buildMerklCanaryQueue({
    report,
    now: "2026-05-10T00:00:00.000Z",
    inventorySnapshot: {
      native: [{ chain: "bsc", asset: "BNB", actual: "1000000000000000", estimatedUsd: 0.6 }],
      tokens: [{
        chain: "bsc",
        ticker: "SOLVBTC",
        token: DUMMY.addrC,
        actual: "1000000000000000",
        actualDecimal: 0.001,
        estimatedUsd: 100,
      }],
    },
  });

  assert.equal(queue.summary.byChain.bsc, 1);
  assert.equal(queue.summary.pendleYtCount, 1);
  assert.equal(queue.summary.pendleYtCanaryReadyCount, 0);
  assert.equal(queue.queue[0].chain, "bsc");
  assert.equal(queue.queue[0].protocolBindingPlan.bindingKind, "pendle_yt_buy_sell_redeem");
  assert.ok(queue.queue[0].capabilityGaps.includes("yt_exit_quote_missing"));
});
