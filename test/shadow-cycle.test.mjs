import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRouteDemandFromCanaryState, buildShadowCycleSummary } from "../src/session/shadow-cycle.mjs";
import { ETHEREUM_L1_PHASE_DISABLED_REASON } from "../src/risk/ethereum-l1-policy.mjs";

test("route demand is extracted only from viable canary candidates", () => {
  const routeDemand = buildRouteDemandFromCanaryState({
    topCandidates: [
      {
        viableForPrep: true,
        srcChain: "bob",
        routeKey: "bob:0x0555->base:0x0555",
      },
      {
        viableForPrep: false,
        srcChain: "base",
        routeKey: "base:0x0555->bob:0x0555",
      },
    ],
  });

  assert.deepEqual(routeDemand, [
    { chain: "bob" },
    { chain: "bob", token: "0x0555" },
  ]);
});

test("shadow cycle summary stays in shadow mode when no realized routes are enabled", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      nextStep: { decision: "RERUN_SCORING", reasons: [] },
      routePlan: {
        topCandidates: [
          {
            routeKey: "bob:0x0555->base:0x0555",
            label: "bob->base wBTC.OFT->wBTC.OFT",
            amount: "10000",
            viableForPrep: true,
            tradeReadiness: "reject_no_net_edge",
            netEdgeUsd: -0.8,
            executableNetEdgeUsd: null,
            prepFundingUsd: 0,
          },
        ],
        candidates: [
          {
            routeKey: "bob:0x0555->base:0x0555",
            label: "bob->base wBTC.OFT->wBTC.OFT",
            amount: "10000",
            srcChain: "bob",
            srcToken: "0x0555",
            viableForPrep: true,
            prepBlockers: [],
            txReady: true,
            scoreDisqualifiers: [],
          },
          {
            routeKey: "base:0x0555->bob:0x0555",
            label: "base->bob wBTC.OFT->wBTC.OFT",
            amount: "10000",
            srcChain: "base",
            dstChain: "bob",
            srcToken: "0x0555",
            viableForPrep: false,
            prepBlockers: ["wallet_not_checked"],
            txReady: true,
            scoreDisqualifiers: [],
          },
        ],
      },
    },
    treasuryPlan: {
      decision: "BLOCKED",
      reasons: ["wallet_value_below_refill_floor"],
      summary: { refillActionCount: 0, blockerCount: 1, estimatedWalletUsd: 25, walletValueFloorUsd: 250, walletValueShortfallUsd: 225, noDemandBlockerCount: 1 },
      blockers: [
        {
          type: "token_refill_blocked_no_demand",
          chain: "base",
          ticker: "wBTC.OFT",
          refillAmountDecimal: 0.0003,
          refillEstimatedUsd: 21.89,
        },
      ],
    },
    fundingSourcePlan: {
      reasons: ["reserve_replenishment_unmodelled"],
      summary: {
        selectionCount: 0,
        executionRefillExpectedCostUsd: 0,
        reserveReplenishmentExpectedCostUsd: 0,
        effectiveSystemNetPnlUsd: -0.8,
      },
    },
    refillJobs: {
      requiresManualReview: false,
      summary: { jobCount: 0 },
    },
    routePerformance: {
      summary: {
        routeVariantCount: 10,
        enabledCount: 0,
        realizedRouteCount: 0,
      },
      routes: [],
    },
    riskState: {
      dailyRealizedPnlUsd: 0,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
  });

  assert.equal(summary.mode, "SHADOW_ONLY");
  assert.equal(summary.blockers.includes("no_realized_enabled_routes"), true);
  assert.equal(summary.blockers.includes("wallet_value_below_refill_floor"), true);
  assert.equal(summary.treasury.walletValueShortfallUsd, 225);
  assert.equal(summary.treasury.noDemandBlockerCount, 1);
  assert.deepEqual(summary.canary.nextReadinessCheck, {
    routeKey: "base:0x0555->bob:0x0555",
    label: "base->bob wBTC.OFT->wBTC.OFT",
    amount: "10000",
    srcChain: "base",
    srcTicker: null,
    dstChain: "bob",
    dstTicker: null,
    tradeReadiness: null,
  });
  assert.deepEqual(summary.canary.nextReadinessRefresh, {
    state: "ready_now",
    reason: "never_checked",
    latestObservedAt: null,
    ageSeconds: null,
    maxAgeSeconds: 300,
  });
  assert.equal(summary.canary.readinessCheckCount, 1);
  assert.deepEqual(summary.treasury.nextNeeds[0], {
    state: "waiting_demand",
    chain: "base",
    ticker: "wBTC.OFT",
    token: null,
    refillAmountDecimal: 0.0003,
    refillEstimatedUsd: 21.89,
    activation: {
      code: "awaiting_wallet_readiness_check",
      candidateCount: 1,
      routeLabel: "base->bob wBTC.OFT->wBTC.OFT",
    },
  });
  assert.equal(
    summary.recommendedCommands[0],
    'npm run check:estimator-wallet -- --route-key="base:0x0555->bob:0x0555" --amount="10000" --address="0x96262be63aa687563789225c2fe898c27a3b0ae4"',
  );
});

test("shadow cycle does not recommend readiness checks for routes missing tx payload", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      nextStep: { decision: "BLOCKED_NO_VIABLE_PREP_ROUTE", reasons: ["missing_tx_data"] },
      routePlan: {
        topCandidates: [
          {
            routeKey: "base:0x0555->bob:0x0555",
            label: "base->bob wBTC.OFT->wBTC.OFT",
            amount: "10000",
            viableForPrep: false,
            tradeReadiness: null,
            netEdgeUsd: null,
            executableNetEdgeUsd: null,
            prepFundingUsd: null,
          },
        ],
        candidates: [
          {
            routeKey: "base:0x0555->bob:0x0555",
            label: "base->bob wBTC.OFT->wBTC.OFT",
            amount: "10000",
            srcChain: "base",
            dstChain: "bob",
            srcToken: "0x0555",
            srcTicker: "wBTC.OFT",
            viableForPrep: false,
            prepBlockers: ["wallet_not_checked"],
            txReady: false,
            scoreDisqualifiers: [],
          },
        ],
      },
      readinessRecords: [],
      readinessFailures: [],
    },
    treasuryPlan: {
      decision: "BLOCKED",
      reasons: [],
      summary: { refillActionCount: 0, blockerCount: 1, estimatedWalletUsd: 25, walletValueFloorUsd: 250, walletValueShortfallUsd: 225, noDemandBlockerCount: 1 },
      blockers: [
        {
          type: "token_refill_blocked_no_demand",
          chain: "base",
          ticker: "wBTC.OFT",
          refillAmountDecimal: 0.0003,
          refillEstimatedUsd: 21.89,
        },
      ],
    },
    fundingSourcePlan: { reasons: [], summary: {} },
    refillJobs: { requiresManualReview: false, summary: { jobCount: 0 } },
    routePerformance: { summary: { routeVariantCount: 0, enabledCount: 0, realizedRouteCount: 0 }, routes: [] },
    riskState: {
      dailyRealizedPnlUsd: 0,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
  });

  assert.equal(summary.canary.nextReadinessCheck, null);
  assert.equal(summary.canary.readinessCheckCount, 0);
  assert.equal(summary.treasury.nextNeeds[0].activation.code, "awaiting_tx_payload");
  assert.equal(summary.recommendedCommands.some((item) => item.includes("check:estimator-wallet")), false);
});

test("shadow cycle carries ETH-family watch state into refresh planning", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      nextStep: { decision: "RERUN_SCORING", reasons: [] },
      routePlan: {
        topCandidates: [],
        candidates: [],
      },
    },
    treasuryPlan: {
      decision: "WATCH_ONLY",
      reasons: [],
      summary: { refillActionCount: 0, blockerCount: 0, estimatedWalletUsd: 280, walletValueFloorUsd: 250, walletValueShortfallUsd: 0, noDemandBlockerCount: 0 },
      actions: [],
      blockers: [],
    },
    fundingSourcePlan: { reasons: [], summary: {} },
    refillJobs: { requiresManualReview: false, summary: { jobCount: 0 } },
    routePerformance: { summary: { routeVariantCount: 0, enabledCount: 0, realizedRouteCount: 0 }, routes: [] },
    riskState: {
      dailyRealizedPnlUsd: 0,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
    ethFamilyWatch: {
      observedAt: "2026-04-12T12:00:00.000Z",
      routeCount: 1,
      surfaceChanged: true,
      addedRoutes: ["base:0xeth->bob:0xeth"],
      removedRoutes: [],
      chainPairs: ["base->bob"],
      addedChainPairs: ["base->bob"],
      removedChainPairs: [],
    },
  });

  assert.equal(summary.ethFamilyWatch.surfaceChanged, true);
  assert.equal(summary.ethFamilyWatch.routeCount, 1);
  assert.equal(summary.refreshQueue[0].scope, "eth_family_watch");
  assert.equal(summary.recommendedCommands.some((item) => item.includes("analyze:ethereum-routes")), true);
});

test("shadow cycle carries forward a specific blocked headline for net-negative routes", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      nextStep: {
        decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        headline: "Best prepared route still fails objective score review",
        reasons: ["reject_no_net_edge"],
      },
      routePlan: {
        topCandidates: [
          {
            routeKey: "bob:0x0555->base:0x0555",
            label: "bob->base wBTC.OFT->wBTC.OFT",
            amount: "10000",
            viableForPrep: true,
            tradeReadiness: "reject_no_net_edge",
            netEdgeUsd: -0.83,
            executableNetEdgeUsd: null,
            prepFundingUsd: 0,
          },
        ],
        candidates: [],
      },
    },
    treasuryPlan: {
      decision: "WATCH_ONLY",
      reasons: [],
      summary: { refillActionCount: 0, blockerCount: 0, estimatedWalletUsd: 280, walletValueFloorUsd: 250, walletValueShortfallUsd: 0, noDemandBlockerCount: 0 },
      actions: [],
      blockers: [],
    },
    fundingSourcePlan: { reasons: [], summary: {} },
    refillJobs: { requiresManualReview: false, summary: { jobCount: 0 } },
    routePerformance: { summary: { routeVariantCount: 0, enabledCount: 0, realizedRouteCount: 0 }, routes: [] },
    riskState: {
      dailyRealizedPnlUsd: 0,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
  });

  assert.equal(summary.mode, "CANARY_PREP_BLOCKED");
  assert.equal(summary.headline, "Best prepared route still fails objective score review");
});

test("shadow cycle holds Ethereum L1 candidates in policy review instead of chasing readiness work", () => {
  const policyBlocked = {
    routeKey: "ethereum:0x2260->base:0x0555",
    label: "ethereum->base WBTC->wBTC.OFT",
    amount: "10000",
    srcChain: "ethereum",
    dstChain: "base",
    srcTicker: "WBTC",
    dstTicker: "wBTC.OFT",
    viableForPrep: false,
    txReady: true,
    prepBlockers: ["wallet_not_checked"],
    scoreDisqualifiers: [ETHEREUM_L1_PHASE_DISABLED_REASON],
    tradeReadiness: ETHEREUM_L1_PHASE_DISABLED_REASON,
    prepFundingUsd: null,
    netEdgeUsd: null,
    executableNetEdgeUsd: null,
  };
  const eligible = {
    routeKey: "base:0x0555->bob:0x0555",
    label: "base->bob wBTC.OFT->wBTC.OFT",
    amount: "10000",
    srcChain: "base",
    dstChain: "bob",
    srcTicker: "wBTC.OFT",
    dstTicker: "wBTC.OFT",
    viableForPrep: false,
    txReady: true,
    prepBlockers: ["wallet_not_checked"],
    scoreDisqualifiers: [],
    tradeReadiness: "insufficient_data",
    prepFundingUsd: null,
    netEdgeUsd: null,
    executableNetEdgeUsd: null,
  };

  const summary = buildShadowCycleSummary({
    canaryState: {
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      nextStep: {
        decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        headline: "No viable route is ready for canary prep",
        reasons: [ETHEREUM_L1_PHASE_DISABLED_REASON],
      },
      routePlan: {
        topCandidates: [policyBlocked, eligible],
        candidates: [policyBlocked, eligible],
      },
      readinessRecords: [],
      readinessFailures: [],
      dexQuotes: [],
    },
    treasuryPlan: {
      decision: "WATCH_ONLY",
      reasons: [],
      summary: { refillActionCount: 0, blockerCount: 0, estimatedWalletUsd: 280, walletValueFloorUsd: 250, walletValueShortfallUsd: 0, noDemandBlockerCount: 0 },
      actions: [],
      blockers: [],
    },
    fundingSourcePlan: { reasons: [], summary: {} },
    refillJobs: { requiresManualReview: false, summary: { jobCount: 0 } },
    routePerformance: { summary: { routeVariantCount: 0, enabledCount: 0, realizedRouteCount: 0 }, routes: [] },
    riskState: {
      dailyRealizedPnlUsd: 0,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
    quotes: [],
    quoteFailures: [],
    shadowObservations: [],
    scoreSnapshot: { scores: [] },
    strategy: {},
  });

  assert.equal(summary.shadowActions[0].code, "hold_policy_review");
  assert.equal(summary.shadowActions[0].reason, ETHEREUM_L1_PHASE_DISABLED_REASON);
  assert.equal(summary.canary.nextReadinessCheck.routeKey, "base:0x0555->bob:0x0555");
});

test("shadow cycle summary upgrades to review mode when realized enabled routes exist", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      nextStep: { decision: "RERUN_SCORING", reasons: [] },
      routePlan: { topCandidates: [] },
    },
    treasuryPlan: {
      decision: "WATCH_ONLY",
      reasons: [],
      summary: { refillActionCount: 0, blockerCount: 0, estimatedWalletUsd: 280, walletValueFloorUsd: 250, walletValueShortfallUsd: 0, noDemandBlockerCount: 0 },
      actions: [],
      blockers: [],
    },
    fundingSourcePlan: {
      reasons: [],
      summary: {
        selectionCount: 0,
        executionRefillExpectedCostUsd: 0,
        reserveReplenishmentExpectedCostUsd: 0,
        effectiveSystemNetPnlUsd: 0.5,
      },
    },
    refillJobs: {
      requiresManualReview: false,
      summary: { jobCount: 0 },
    },
    routePerformance: {
      summary: {
        routeVariantCount: 4,
        enabledCount: 1,
        realizedRouteCount: 1,
      },
      routes: [{ enabledState: "enabled_review_only" }],
    },
    riskState: {
      dailyRealizedPnlUsd: 0.3,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
  });

  assert.equal(summary.mode, "REVIEW_CANARY_PROGRESS");
});

test("shadow cycle summary marks blocked canary prep explicitly", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      nextStep: { decision: "FUND_AND_APPROVE_WALLET", reasons: ["native", "token"] },
      routePlan: { topCandidates: [] },
    },
    treasuryPlan: {
      decision: "WATCH_ONLY",
      reasons: [],
      summary: { refillActionCount: 0, blockerCount: 0, estimatedWalletUsd: 25, walletValueFloorUsd: 250, walletValueShortfallUsd: 225, noDemandBlockerCount: 0 },
      actions: [],
      blockers: [],
    },
    fundingSourcePlan: { reasons: [], summary: {} },
    refillJobs: { requiresManualReview: false, summary: { jobCount: 0 } },
    routePerformance: { summary: { routeVariantCount: 0, enabledCount: 0, realizedRouteCount: 0 }, routes: [] },
    riskState: {
      dailyRealizedPnlUsd: 0,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
  });

  assert.equal(summary.mode, "CANARY_PREP_BLOCKED");
  assert.equal(summary.canary.decision, "FUND_AND_APPROVE_WALLET");
});

test("shadow cycle summary surfaces pivot decision from route economics audit", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      nextStep: {
        decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        headline: "Best prepared route still fails objective score review",
        reasons: ["reject_no_net_edge"],
      },
      routePlan: {
        topCandidates: [
          {
            routeKey: "base:0x0555->unichain:0x0555",
            label: "base->unichain wBTC.OFT->wBTC.OFT",
            amount: "10000",
            srcChain: "base",
            dstChain: "unichain",
            viableForPrep: true,
            txReady: true,
            exactGasDone: true,
            tradeReadiness: "reject_no_net_edge",
            netEdgeUsd: -0.6,
            executableNetEdgeUsd: -0.6,
            prepFundingUsd: 0,
            prepBlockers: [],
            scoreDisqualifiers: [],
          },
        ],
        candidates: [],
      },
      dexQuotes: [
        {
          source: "gateway_src_entry_leg",
          gatewayRouteKey: "base:0x0555->unichain:0x0555",
          gatewayAmount: "10000",
          observedAt: "2026-04-12T00:00:01.000Z",
          outputAmount: "10000",
          inputValueUsd: 7.4,
          gasEstimateValueUsd: 0.05,
        },
        {
          source: "gateway_src_entry_leg",
          gatewayRouteKey: "base:0x0555->unichain:0x0555",
          gatewayAmount: "25000",
          observedAt: "2026-04-12T00:00:01.000Z",
          outputAmount: "25000",
          inputValueUsd: 18.3,
          gasEstimateValueUsd: 0.05,
        },
        {
          source: "gateway_src_entry_leg",
          gatewayRouteKey: "base:0x0555->unichain:0x0555",
          gatewayAmount: "50000",
          observedAt: "2026-04-12T00:00:01.000Z",
          outputAmount: "50000",
          inputValueUsd: 36.5,
          gasEstimateValueUsd: 0.05,
        },
      ],
    },
    treasuryPlan: {
      decision: "WATCH_ONLY",
      reasons: [],
      summary: { refillActionCount: 0, blockerCount: 0, estimatedWalletUsd: 280, walletValueFloorUsd: 250, walletValueShortfallUsd: 0, noDemandBlockerCount: 0 },
      actions: [],
      blockers: [],
    },
    fundingSourcePlan: { reasons: [], summary: {} },
    refillJobs: { requiresManualReview: false, summary: { jobCount: 0 } },
    routePerformance: { summary: { routeVariantCount: 0, enabledCount: 0, realizedRouteCount: 0 }, routes: [] },
    riskState: {
      dailyRealizedPnlUsd: 0,
      projectLossUsedUsd: 0,
      failedGasCost24hUsd: 0,
      consecutiveFailures: 0,
    },
    scoreSnapshot: {
      generatedAt: "2026-04-12T00:00:00.000Z",
      scores: [
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "10000",
          srcChain: "base",
          dstChain: "unichain",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          executableOutputUsd: 7.0,
          knownCostUsd: 0.2,
          netEdgeUsd: -0.6,
          executableNetEdgeUsd: -0.6,
          effectiveSystemNetPnlUsd: -0.7,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "25000",
          srcChain: "base",
          dstChain: "unichain",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          executableOutputUsd: 17.1,
          knownCostUsd: 0.2,
          netEdgeUsd: -1.0,
          executableNetEdgeUsd: -1.0,
          effectiveSystemNetPnlUsd: -1.1,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "50000",
          srcChain: "base",
          dstChain: "unichain",
          srcAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          dstAsset: { ticker: "wBTC.OFT", family: "wrapped_btc", decimals: 8 },
          executableOutputUsd: 34.8,
          knownCostUsd: 0.2,
          netEdgeUsd: -1.7,
          executableNetEdgeUsd: -1.7,
          effectiveSystemNetPnlUsd: -1.9,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
  });

  assert.equal(summary.pivotDecision.decisionCode, "pivot_within_current_thesis");
  assert.equal(summary.pivotDecision.currentCanaryVerdict, "drop");
  assert.equal(summary.pivotDecision.command, null);
});

test("shadow cycle summary includes a multi-shadow roster", () => {
  const summary = buildShadowCycleSummary({
    canaryState: {
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      nextStep: { decision: "BLOCKED_NO_VIABLE_PREP_ROUTE", reasons: ["reject_no_net_edge"] },
      routePlan: {
        candidateCount: 4,
        viableCount: 1,
        txReadyCount: 3,
        topCandidates: [
          {
            routeKey: "bob:0x0555->base:0x0555",
            label: "bob->base wBTC.OFT->wBTC.OFT",
            amount: "10000",
            srcChain: "bob",
            dstChain: "base",
            viableForPrep: true,
            txReady: true,
            exactGasDone: true,
            tradeReadiness: "reject_no_net_edge",
            prepFundingUsd: 0,
            netEdgeUsd: -0.84,
            prepBlockers: [],
            scoreDisqualifiers: [],
          },
          {
            routeKey: "ethereum:0x2260->base:0x0555",
            label: "ethereum->base WBTC->wBTC.OFT",
            amount: "10000",
            srcChain: "ethereum",
            dstChain: "base",
            viableForPrep: false,
            txReady: true,
            exactGasDone: false,
            tradeReadiness: "insufficient_data",
            prepFundingUsd: 4.2,
            netEdgeUsd: 64.77,
            prepBlockers: ["native", "token", "allowance"],
            scoreDisqualifiers: [],
          },
          {
            routeKey: "base:0x0555->avalanche:0x0555",
            label: "base->avalanche wBTC.OFT->wBTC.OFT",
            amount: "150000",
            srcChain: "base",
            dstChain: "avalanche",
            viableForPrep: false,
            txReady: true,
            exactGasDone: true,
            tradeReadiness: "insufficient_data",
            prepFundingUsd: 0.3,
            netEdgeUsd: null,
            prepBlockers: ["wallet_not_checked"],
            scoreDisqualifiers: [],
          },
        ],
      },
    },
    treasuryPlan: { decision: "WATCH_ONLY", reasons: [], summary: {}, actions: [], blockers: [] },
    fundingSourcePlan: { reasons: [], summary: {} },
    refillJobs: { requiresManualReview: false, summary: { jobCount: 0 } },
    routePerformance: { summary: { routeVariantCount: 0, enabledCount: 0, realizedRouteCount: 0 }, routes: [] },
    riskState: { dailyRealizedPnlUsd: 0, projectLossUsedUsd: 0, failedGasCost24hUsd: 0, consecutiveFailures: 0 },
    quotes: [
      {
        observedAt: "2026-04-12T00:10:00.000Z",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        latencyMs: 420,
      },
      {
        observedAt: "2026-04-12T00:11:00.000Z",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        latencyMs: 680,
      },
    ],
    quoteFailures: [
      {
        observedAt: "2026-04-12T00:12:00.000Z",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
      },
    ],
    shadowObservations: [
      {
        observedAt: "2026-04-12T00:13:00.000Z",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        observedEdgeUsd: -0.84,
        knownCostUsd: 0.19,
        executionGasUsd: 0.02,
        routeFailureRate: 0.2,
        tradeReadiness: "reject_no_net_edge",
        rejectionReasons: ["reject_no_net_edge", "stale_dex_output_quote"],
      },
      {
        observedAt: "2026-04-12T00:14:00.000Z",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        observedEdgeUsd: -0.81,
        knownCostUsd: 0.21,
        executionGasUsd: 0.03,
        routeFailureRate: 0.25,
        tradeReadiness: "reject_no_net_edge",
        rejectionReasons: ["reject_no_net_edge"],
      },
    ],
    scoreSnapshot: {
      scores: [
        {
          observedAt: "2026-04-12T00:14:30.000Z",
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          tradeReadiness: "reject_no_net_edge",
          knownCostUsd: 0.22,
          executionGasUsd: 0.03,
          routeStats: { failureRate: 0.25 },
          dataGaps: [],
        },
      ],
    },
  });

  assert.equal(summary.shadowRoster.candidateCount, 4);
  assert.equal(summary.shadowRoster.viableCount, 1);
  assert.equal(summary.shadowRoster.txReadyCount, 3);
  assert.deepEqual(
    summary.shadowRoster.candidates.map((item) => [item.role, item.label]),
    [
      ["active_canary", "bob->base wBTC.OFT->wBTC.OFT"],
      ["tx_ready_shadow", "base->avalanche wBTC.OFT->wBTC.OFT"],
      ["tx_ready_shadow", "ethereum->base WBTC->wBTC.OFT"],
    ],
  );
  assert.deepEqual(
    summary.shadowActions.map((item) => [item.label, item.code]),
    [
      ["bob->base wBTC.OFT->wBTC.OFT", "wait_for_fresh_inputs"],
      ["ethereum->base WBTC->wBTC.OFT", "check_wallet_readiness"],
      ["base->avalanche wBTC.OFT->wBTC.OFT", "check_wallet_readiness"],
    ],
  );
  assert.equal(summary.shadowRoster.candidates[1].shadowPriorityReason, "no_shadow_evidence");
  assert.equal(summary.shadowRoster.candidates[2].shadowPriorityReason, "no_shadow_evidence");
  assert.equal(summary.shadowRoster.candidates[0].evidence.quoteSampleCount, 2);
  assert.equal(summary.shadowRoster.candidates[0].evidence.quoteFailureCount, 1);
  assert.equal(Number(summary.shadowRoster.candidates[0].evidence.quoteSuccessRate.toFixed(3)), 0.667);
  assert.equal(summary.shadowRoster.candidates[0].evidence.quoteLatencyP95Ms, 680);
  assert.equal(summary.shadowRoster.candidates[0].evidence.shadowObservationCount, 2);
  assert.equal(summary.shadowRoster.candidates[0].evidence.latestKnownCostUsd, 0.21);
  assert.deepEqual(
    summary.shadowRoster.candidates[0].evidence.rejectionReasons.map((item) => [item.reason, item.count]),
    [
      ["reject_no_net_edge", 2],
    ],
  );
  assert.equal(summary.strategyPlans.stableLoop.nextAction, "collect_stable_loop_coverage");
  assert.equal(summary.strategyPlans.proxySpread.nextAction, "watch_proxy_surface");
  assert.deepEqual(
    summary.refreshQueue.map((item) => [item.rank, item.scope, item.code]),
    [
      [1, "tx_ready_shadow", "check_wallet_readiness"],
      [2, "tx_ready_shadow", "check_wallet_readiness"],
      [3, "canary", "advance_canary"],
      [4, "route_performance", "report_route_performance"],
    ],
  );
});
