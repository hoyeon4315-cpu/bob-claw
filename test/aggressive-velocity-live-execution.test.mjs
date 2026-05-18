import assert from "node:assert/strict";
import test from "node:test";

test("aggressive risk-exit manager module imports without undefined exports", async () => {
  const mod = await import("../src/strategy/aggressive-velocity/risk-exit-manager.mjs");

  assert.equal(typeof mod.shouldExitHighYieldPosition, "function");
  assert.equal(typeof mod.filterCandidatesWithSafeExitPath, "function");
  assert.equal(typeof mod.rankByNetBtcProfitPerRisk, "function");
  assert.equal(typeof mod.calculateRealizationFeasibilityScore, "function");
  assert.equal(typeof mod.simulateHighYieldExitOutcomes, "function");
  assert.equal(typeof mod.default, "object");
});

test("aggressive live execution infers binding kind and executable asset pricing from candidate bindings", async () => {
  const {
    resolveAggressiveVelocityBindingKind,
    resolveAggressiveVelocityAssetPriceUsd,
    selectAggressiveVelocityExecutableCandidate,
  } = await import("../src/strategy/aggressive-velocity/live-execution.mjs");

  const aaveCandidate = {
    chain: "base",
    protocolId: "aave",
    protocol: "aave",
    assetSymbol: "USDC",
    protocolBinding: {
      assetAddress: "0x1111111111111111111111111111111111111111",
      assetSymbol: "USDC",
      assetDecimals: 6,
      aTokenAddress: "0x2222222222222222222222222222222222222222",
      poolAddressProviderAddress: "0x3333333333333333333333333333333333333333",
    },
  };
  const erc4626Candidate = {
    chain: "base",
    protocolId: "morpho",
    protocol: "morpho",
    assetSymbol: "cbBTC",
    protocolBinding: {
      vaultAddress: "0x4444444444444444444444444444444444444444",
      shareTokenAddress: "0x5555555555555555555555555555555555555555",
      assetAddress: "0x6666666666666666666666666666666666666666",
      assetSymbol: "cbBTC",
      assetDecimals: 8,
    },
  };

  assert.equal(resolveAggressiveVelocityBindingKind(aaveCandidate), "aave_v3_pool_supply_withdraw");
  assert.equal(resolveAggressiveVelocityBindingKind(erc4626Candidate), "erc4626_vault_supply_withdraw");
  assert.equal(resolveAggressiveVelocityAssetPriceUsd(aaveCandidate, { btcPriceUsd: 105_000 }), 1);
  assert.equal(resolveAggressiveVelocityAssetPriceUsd(erc4626Candidate, { btcPriceUsd: 105_000 }), 105_000);

  const selected = selectAggressiveVelocityExecutableCandidate([erc4626Candidate, aaveCandidate], {
    btcPriceUsd: 105_000,
  });
  assert.equal(selected.bindingKind, "erc4626_vault_supply_withdraw");
  assert.equal(selected.assetPriceUsd, 105_000);
  assert.equal(selected.candidate.protocolId, "morpho");
});

test("aggressive live execution builds plan with registered builder for supported candidate", async () => {
  const { buildAggressiveVelocityEntryPlan } = await import("../src/strategy/aggressive-velocity/live-execution.mjs");

  const candidate = {
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "aave",
    protocol: "aave",
    assetSymbol: "USDC",
    protocolBinding: {
      assetAddress: "0x1111111111111111111111111111111111111111",
      assetSymbol: "USDC",
      assetDecimals: 6,
      aTokenAddress: "0x2222222222222222222222222222222222222222",
      poolAddressProviderAddress: "0x3333333333333333333333333333333333333333",
    },
    aprPct: 10000,
    campaignRemainingHours: 48,
    remainingHours: 48,
    incentiveUsdPerDay: 200,
    estimatedRoundtripCostUsd: 0.01,
  };

  const plan = await buildAggressiveVelocityEntryPlan({
    candidate,
    senderAddress: "0x7777777777777777777777777777777777777777",
    amountUsd: 25,
    btcPriceUsd: 105_000,
    planBuilder: async ({ queueItem, strategyId, amount }) => ({
      strategyId,
      amount,
      queueItem,
      steps: [
        {
          id: "approve_asset",
          intent: {
            strategyId,
            chain: "base",
            intentType: "approve_exact",
            approval: {
              token: "0x1111111111111111111111111111111111111111",
              spender: "0x3333333333333333333333333333333333333333",
              amount,
              mode: "per_tx",
            },
            metadata: {},
          },
        },
        {
          id: "mock_step",
          intent: {
            strategyId,
            chain: "base",
            intentType: "aave_supply",
            metadata: {
              approval: {
                token: "0x1111111111111111111111111111111111111111",
                spender: "0x3333333333333333333333333333333333333333",
                amount,
              },
            },
          },
        },
      ],
    }),
  });

  assert.equal(plan.strategyId, "aggressive-velocity-v1");
  assert.equal(plan.bindingKind, "aave_v3_pool_supply_withdraw");
  assert.equal(plan.amount, "25000000");
  assert.equal(plan.queueItem.protocolBindingPlan.bindingKind, "aave_v3_pool_supply_withdraw");
  assert.equal(plan.steps[1].intent.intentType, "aave_supply");
  assert.equal(typeof plan.steps[1].intent.metadata.expectedNetUsd, "number");
  assert.equal(plan.steps[1].intent.metadata.expectedNetUsd > 0, true);
  assert.equal(typeof plan.steps[0].intent.metadata.parentIntentHash, "string");
  assert.equal(plan.steps[0].intent.metadata.parentEvEvidence.allow, true);
});

test("aggressive live state preserves rejection evidence when no candidate is selected", async () => {
  const { buildAggressiveVelocityLiveState } = await import("../src/strategy/aggressive-velocity/live-execution.mjs");

  const strategistResult = {
    selectedCount: 0,
    totalQualified: 0,
    totalExpectedNetBtcProfit: 0,
    totalSimulatedRealizedNetBtc: 0,
    aggregateCaptureRate: 0,
    candidates: [],
    selectionDiagnostics: {
      scannerCandidateCount: 2,
      qualifiedCount: 0,
      shortlistedCount: 0,
      safeExitCount: 0,
      realizationQualifiedCount: 0,
      finalSelectedCount: 0,
    },
    rejectionEvidence: {
      scan: {
        rawCount: 5,
        stageCounts: {
          passedBaseFilters: 2,
          passedCredibleExit: 1,
          passedVelocityScore: 0,
          passedHighNetYield: 0,
          executableCandidates: 0,
          finalSelected: 0,
        },
        rejectedByReason: [
          { reason: "unsupported_chain", count: 3 },
          { reason: "velocity_score_below_minimum", count: 1 },
        ],
      },
      strategist: {
        rejectedLowYieldCount: 2,
        rejectedUnsafeExitCount: 0,
        rejectedLowRealizationCount: 0,
      },
      topRejectedReasons: [
        { reason: "unsupported_chain", count: 3 },
        { reason: "velocity_score_below_minimum", count: 1 },
      ],
    },
  };

  const liveState = await buildAggressiveVelocityLiveState({
    strategistResult,
    btcPriceUsd: 105_000,
  });

  assert.deepEqual(liveState.liveAdmissionBlockers, ["no_high_yield_candidates_selected"]);
  assert.equal(liveState.currentLiveEligible, false);
  assert.equal(liveState.rejectionEvidence.scan.rawCount, 5);
  assert.equal(liveState.rejectionEvidence.topRejectedReasons[0].reason, "unsupported_chain");
  assert.equal(liveState.selectionDiagnostics.qualifiedCount, 0);
});

test("aggressive live state requires entry asset inventory before marking candidate live-eligible", async () => {
  const { buildAggressiveVelocityLiveState } = await import("../src/strategy/aggressive-velocity/live-execution.mjs");

  const strategistResult = {
    selectedCount: 1,
    totalQualified: 1,
    totalExpectedNetBtcProfit: 0.08437193,
    totalSimulatedRealizedNetBtc: 0.05181034,
    aggregateCaptureRate: 0.61,
    candidates: [
      {
        opportunityId: "opp-1",
        chain: "ethereum",
        protocolId: "morpho",
        protocol: "morpho",
        expectedNetBtcProfit: 0.08437193,
        refinedNetBtcProfit: 0.08437193,
        protocolBinding: {
          vaultAddress: "0xE15fcC81118895b67b6647BBd393182dF44E11E0",
          shareTokenAddress: "0xE15fcC81118895b67b6647BBd393182dF44E11E0",
          assetAddress: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
          assetSymbol: "USDS",
          assetDecimals: 18,
        },
      },
    ],
    selectionDiagnostics: {
      scannerCandidateCount: 1,
      qualifiedCount: 1,
      shortlistedCount: 1,
      safeExitCount: 1,
      realizationQualifiedCount: 1,
      finalSelectedCount: 1,
    },
    rejectionEvidence: {
      scan: {
        rawCount: 1,
        stageCounts: {
          passedBaseFilters: 1,
          passedCredibleExit: 1,
          passedVelocityScore: 1,
          passedHighNetYield: 1,
          executableCandidates: 1,
          finalSelected: 1,
        },
        rejectedByReason: [],
      },
      strategist: {
        rejectedLowYieldCount: 0,
        rejectedUnsafeExitCount: 0,
        rejectedLowRealizationCount: 0,
      },
      topRejectedReasons: [],
    },
  };

  const liveState = await buildAggressiveVelocityLiveState({
    strategistResult,
    btcPriceUsd: 105_000,
    resolveOperationalAddressImpl: async () => ({ address: "0x7777777777777777777777777777777777777777" }),
    readAssetBalanceImpl: async () => 0n,
  });

  assert.equal(liveState.currentLiveEligible, false);
  assert.deepEqual(liveState.liveAdmissionBlockers, ["inventory_missing"]);
  assert.equal(liveState.inventoryReadiness.status, "inventory_missing");
  assert.equal(liveState.inventoryReadiness.operatorAddress, "0x7777777777777777777777777777777777777777");
});

test("aggressive live state keeps same-chain funded candidate blocked when amount-scaled EV is below policy floor", async () => {
  const { buildAggressiveVelocityLiveState } = await import("../src/strategy/aggressive-velocity/live-execution.mjs");

  const strategistResult = {
    selectedCount: 1,
    totalQualified: 1,
    totalExpectedNetBtcProfit: 0.08437193,
    totalSimulatedRealizedNetBtc: 0.05181034,
    aggregateCaptureRate: 0.61,
    candidates: [
      {
        opportunityId: "opp-1",
        chain: "ethereum",
        protocolId: "morpho",
        protocol: "morpho",
        expectedNetBtcProfit: 0.08437193,
        refinedNetBtcProfit: 0.08437193,
        aprPct: 3.84,
        campaignRemainingHours: 38.76,
        remainingHours: 38.76,
        incentiveUsdPerDay: 0.1,
        estimatedRoundtripCostUsd: 31.94,
        protocolBinding: {
          vaultAddress: "0xE15fcC81118895b67b6647BBd393182dF44E11E0",
          shareTokenAddress: "0xE15fcC81118895b67b6647BBd393182dF44E11E0",
          assetAddress: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
          assetSymbol: "USDS",
          assetDecimals: 18,
        },
      },
    ],
    selectionDiagnostics: {
      scannerCandidateCount: 1,
      qualifiedCount: 1,
      shortlistedCount: 1,
      safeExitCount: 1,
      realizationQualifiedCount: 1,
      finalSelectedCount: 1,
    },
    rejectionEvidence: {
      scan: {
        rawCount: 1,
        stageCounts: {
          passedBaseFilters: 1,
          passedCredibleExit: 1,
          passedVelocityScore: 1,
          passedHighNetYield: 1,
          executableCandidates: 1,
          finalSelected: 1,
        },
        rejectedByReason: [],
      },
      strategist: {
        rejectedLowYieldCount: 0,
        rejectedUnsafeExitCount: 0,
        rejectedLowRealizationCount: 0,
      },
      topRejectedReasons: [],
    },
  };

  const balances = new Map([
    ["ethereum:0xdc035d45d973e3ec169d2276ddab16f1e407384f", 0n],
    ["ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 66_000_000n],
  ]);

  const liveState = await buildAggressiveVelocityLiveState({
    strategistResult,
    btcPriceUsd: 105_000,
    resolveOperationalAddressImpl: async () => ({ address: "0x7777777777777777777777777777777777777777" }),
    readAssetBalanceImpl: async ({ chain, token }) => balances.get(`${chain}:${String(token).toLowerCase()}`) ?? 0n,
    getChainTokensImpl: () => [
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    ],
    buildSwapIntentImpl: async () => ({
      provider: "odos",
      outputAmount: "2500181892871444992",
      steps: [],
    }),
  });

  assert.equal(liveState.currentLiveEligible, false);
  assert.deepEqual(liveState.liveAdmissionBlockers, ["expected_net_below_receipt_cost_p90_floor"]);
  assert.equal(liveState.inventoryReadiness.status, "inventory_ready_via_same_chain_swap");
  assert.equal(liveState.inventoryReadiness.sourceToken, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(liveState.inventoryReadiness.sourceSymbol, "USDC");
  assert.equal(liveState.inventoryReadiness.swapProvider, "odos");
  assert.equal(liveState.policyPreview.verdict.allow, false);
  assert.equal(liveState.policyPreview.verdict.blockers[0], "expected_net_below_receipt_cost_p90_floor");
  assert.equal(liveState.projectedNetUsd, liveState.policyPreview.expectedNetUsd);
});

test("aggressive realization gate allows protected high-profit candidates with slightly lower capture", async () => {
  const { passesAggressiveRealizationGate } = await import("../src/strategy/aggressive-velocity/risk-exit-manager.mjs");

  const allowed = passesAggressiveRealizationGate(
    {
      simulatedRealizedNetBtc: 0.05181034,
      captureRate: 0.61,
      feasibilityScore: 97,
      highProfitProtected: true,
    },
    {
      minRealizedNetBtc: 0.00003,
      minCaptureRate: 0.65,
      minFeasibilityScore: 60,
    },
  );
  assert.equal(allowed.pass, true);
  assert.equal(allowed.override, "protected_high_profit_capture_override");

  const blockedUnprotected = passesAggressiveRealizationGate(
    {
      simulatedRealizedNetBtc: 0.05181034,
      captureRate: 0.61,
      feasibilityScore: 97,
      highProfitProtected: false,
    },
    {
      minRealizedNetBtc: 0.00003,
      minCaptureRate: 0.65,
      minFeasibilityScore: 60,
    },
  );
  assert.equal(blockedUnprotected.pass, false);
  assert.equal(blockedUnprotected.reason, "capture_rate_below_minimum");

  const blockedLowCapture = passesAggressiveRealizationGate(
    {
      simulatedRealizedNetBtc: 0.05181034,
      captureRate: 0.59,
      feasibilityScore: 97,
      highProfitProtected: true,
    },
    {
      minRealizedNetBtc: 0.00003,
      minCaptureRate: 0.65,
      minFeasibilityScore: 60,
    },
  );
  assert.equal(blockedLowCapture.pass, false);
  assert.equal(blockedLowCapture.reason, "capture_rate_below_minimum");
});

test("aggressive strategist keeps protected high-profit near-miss candidate", async () => {
  const { selectHighYieldOpportunities } =
    await import("../src/strategy/aggressive-velocity/aggressive-yield-strategist.mjs");

  const result = await selectHighYieldOpportunities({
    highYieldExecutableCandidates: [
      {
        chain: "ethereum",
        protocol: "morpho",
        protocolId: "morpho",
        incentiveUsdPerDay: 5414.898039492448,
        remainingHours: 39.36,
        netYieldPctPerDay: 0.8,
        expectedNetBtcProfit: 0.08437193,
        expectedNetProfitQuality: "high",
        refinedNetBtcProfit: 0.08437193,
        protocolBinding: {
          source: "merkl_opportunity",
          vaultAddress: "0xE15fcC81118895b67b6647BBd393182dF44E11E0",
          assetAddress: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
          assetSymbol: "USDS",
          assetDecimals: 18,
          shareTokenAddress: "0xE15fcC81118895b67b6647BBd393182dF44E11E0",
        },
      },
    ],
    diagnostics: {
      rawCount: 1,
      stageCounts: {
        passedBaseFilters: 1,
        passedCredibleExit: 1,
        passedVelocityScore: 1,
        passedHighNetYield: 1,
        executableCandidates: 1,
        finalSelected: 0,
      },
      rejectedByReason: [],
    },
  });

  assert.equal(result.selectedCount, 1);
  assert.equal(result.candidates[0].protocolId, "morpho");
  assert.equal(result.candidates[0].highProfitProtected, true);
  assert.equal(result.candidates[0].realizationGateOverride, "protected_high_profit_capture_override");
});
