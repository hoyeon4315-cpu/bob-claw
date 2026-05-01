import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAllChainAutopilotDashboardSlice,
  resolveAllChainAutopilotReport,
} from "../src/status/all-chain-autopilot-slice.mjs";
import { buildCapitalSummarySlice } from "../src/status/capital-summary-slice.mjs";
import { buildFlowDashboardSlice } from "../src/status/flow-slice.mjs";
import { buildMerklActivePositions } from "../src/status/merkl-active-slice.mjs";
import { buildTreasuryHoldingsSlice } from "../src/status/treasury-holdings-slice.mjs";

test("all-chain autopilot dashboard slice keeps only public execution status", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-04-25T03:13:42.514Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    chains: ["ethereum", "bob", "base"],
    summary: {
      officialChainCount: 11,
      refillJobCount: 14,
      autoRefillJobCount: 3,
      refillAttemptedCount: 1,
      refillExecutedCount: 0,
      canarySweep: {
        status: "completed",
        executedCount: 9,
        deliveredCount: 9,
        blockedCount: 24,
        chainsTouched: ["base", "ethereum", "base"],
      },
      merklCanary: { status: "blocked", blockedReason: "no_autopilot_candidate_ready" },
      portfolio: {
        status: "positions_opened",
        allocator: {
          deployments: [
            { opportunityId: "137", status: "position_opened", txHash: "0xabc" },
            { opportunityId: "skip", status: "blocked", txHash: null },
          ],
        },
      },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 8,
        successCount: 14,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: {
        status: "carry",
        reason: "planned_payback_below_minimum",
        pendingCarrySats: 601,
      },
    },
    refillExecutions: [
      {
        chain: "optimism",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "lifi",
        previewBlockedReason: "lifi_quote_rejected",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.present, true);
  assert.equal(slice.officialChainCount, 11);
  assert.equal(slice.canary.deliveredCount, 9);
  assert.deepEqual(slice.canary.chainsTouched, ["base", "ethereum"]);
  assert.equal(slice.canaryLadder.enabled, true);
  assert.deepEqual(slice.canaryLadder.rungsUsd, [5, 10, 25, 50, 80]);
  assert.equal(slice.canaryLadder.maxAutoGraduatedUsd, 80);
  assert.equal(slice.canaryLadder.noTxSentNeutral, true);
  assert.equal(slice.portfolio.openedCount, 1);
  assert.equal(slice.payback.pendingCarrySats, 601);
  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.unresolvedCount, 1);
  assert.equal(slice.topBlockers.some((item) => item.reason === "lifi_quote_rejected"), true);
  assert.equal(slice.nextAction, "resolve_refill_routes");
});

test("all-chain autopilot dashboard slice surfaces payback reserve restoration when refill blockers are cleared", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-04-25T03:13:42.514Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 0,
      autoRefillJobCount: 0,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: {
        status: "completed",
        executedCount: 0,
        deliveredCount: 0,
        blockedCount: 0,
        chainsTouched: [],
      },
      merklCanary: { status: null, blockedReason: null },
      portfolio: {
        status: "no_position_opened",
        allocator: {
          deployments: [],
        },
      },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 1,
        successCount: 1,
        failedCount: 0,
        liveEligibleCount: 1,
        missingExecutorCount: 0,
      },
      payback: {
        status: "defer",
        reason: "reserve_asset_missing",
        pendingCarrySats: 601,
        nextAction: "restore_profit_reserve_wbtc_oft",
      },
    },
    refillExecutions: [],
  });

  assert.equal(slice.payback.nextAction, "restore_profit_reserve_wbtc_oft");
  assert.equal(slice.topBlockers.some((item) => item.reason === "reserve_asset_missing"), true);
  assert.equal(slice.nextAction, "restore_payback_reserve");
});

test("all-chain autopilot dashboard slice treats routing exhausted as manual backlog", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-04-27T02:50:15.364Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    summary: {
      officialChainCount: 11,
      refillJobCount: 18,
      autoRefillJobCount: 1,
      refillAttemptedCount: 0,
      refillExecutedCount: 0,
      canarySweep: { status: "completed", executedCount: 11, deliveredCount: 11, blockedCount: 0, chainsTouched: ["base"] },
      strategyDispatch: { batchStatus: "succeeded", selectedCount: 10, successCount: 10, failedCount: 0, liveEligibleCount: 2, missingExecutorCount: 0 },
      payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      portfolio: { status: "blocked", allocator: { deployments: [] } },
    },
    refillExecutions: [
      {
        chain: "ethereum",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "cross_chain_bridge_lifi",
        previewBlockedReason: "routing_exhausted",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.refill.unresolvedCount, 0);
  assert.equal(slice.refill.manualBacklogCount, 1);
  assert.equal(slice.nextAction, "accrue_payback_until_minimum");
});

test("all-chain autopilot truth prefers latest completed report over running progress", () => {
  const resolved = resolveAllChainAutopilotReport(
    { observedAt: "2026-04-27T01:35:00.000Z", status: "running", phase: "refill_complete" },
    { observedAt: "2026-04-27T01:30:00.000Z", status: "completed", phase: "completed" },
  );
  assert.equal(resolved?.status, "completed");
  assert.equal(resolved?.phase, "completed");
});

test("all-chain autopilot truth prefers latest completed report over timed out latest error", () => {
  const resolved = resolveAllChainAutopilotReport(
    {
      observedAt: "2026-04-27T02:58:56.353Z",
      status: "error",
      phase: "completed",
      blockedReason: "Command timed out after 1200000ms",
    },
    { observedAt: "2026-04-27T02:50:15.364Z", status: "completed_with_blockers", phase: "completed" },
  );
  assert.equal(resolved?.status, "completed_with_blockers");
  assert.equal(resolved?.phase, "completed");
  assert.equal(resolved?.observedAt, "2026-04-27T02:50:15.364Z");
});

test("all-chain autopilot truth prefers newer running progress over stale completed error", () => {
  const resolved = resolveAllChainAutopilotReport(
    {
      observedAt: "2026-04-27T03:10:00.000Z",
      status: "running",
      phase: "refill_complete",
      summary: { refillExecutedCount: 1 },
    },
    {
      observedAt: "2026-04-27T02:50:15.364Z",
      status: "error",
      phase: "completed",
      blockedReason: "Command timed out after 1200000ms",
    },
  );
  assert.equal(resolved?.status, "running");
  assert.equal(resolved?.phase, "refill_complete");
  assert.equal(resolved?.summary?.refillExecutedCount, 1);
});

test("Merkl active positions aggregate open live-capital entries", () => {
  const slice = buildMerklActivePositions(
    [
      {
        event: "position_opened",
        status: "open",
        positionId: "p1",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        name: "USDC Vault on Base",
        amountUsd: 5.1,
        observedAt: "2026-04-25T01:00:00.000Z",
      },
      {
        event: "position_opened",
        status: "open",
        positionId: "p2",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        name: "USDC Vault on Base",
        amountUsd: 1.2,
        observedAt: "2026-04-25T02:00:00.000Z",
      },
      {
        event: "position_exit_confirmed",
        status: "closed",
        positionId: "p1",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        amountUsd: 5.1,
        observedAt: "2026-04-25T02:30:00.000Z",
      },
      {
        event: "position_closed",
        status: "closed",
        positionId: "p3",
        opportunityId: "b",
        chain: "ethereum",
        protocolId: "morpho",
        amountUsd: 10,
        observedAt: "2026-04-25T02:00:00.000Z",
      },
    ],
    {
      generatedAt: "2026-04-25T03:00:00.000Z",
      aprByOpportunity: {
        a: 12,
      },
    },
  );

  assert.equal(slice.activeCount, 1);
  assert.equal(slice.positionRecordCount, 1);
  assert.equal(slice.items[0].id, "merkl_a");
  assert.equal(slice.items[0].capUsd, 1.2);
  assert.equal(slice.items[0].aprPct, 12);
  assert.equal(slice.items[0].activePositionCount, 1);
  assert.deepEqual(slice.items[0].pair, ["usdc"]);
});

test("treasury holdings slice normalizes latest inventory into dashboard balances", () => {
  const slice = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-25T01:00:00.000Z",
        summary: { estimatedWalletUsd: 1, activeChainCount: 1, supportedChainCount: 1 },
        native: [],
        tokens: [],
      },
      {
        observedAt: "2026-04-25T02:00:00.000Z",
        summary: {
          estimatedWalletUsd: 20.5,
          activeChainCount: 2,
          supportedChainCount: 3,
          nativeRefillRequiredCount: 1,
          tokenRefillRequiredCount: 2,
        },
        native: [{ chain: "base", asset: "ETH", actualDecimal: 0.01, estimatedUsd: 10, status: "ready" }],
        tokens: [{ chain: "base", ticker: "wBTC.OFT", actualDecimal: 0.0001, estimatedUsd: 7, status: "below_target" }],
      },
    ],
    { generatedAt: "2026-04-25T03:00:00.000Z" },
  );

  assert.equal(slice.pending, false);
  assert.equal(slice.totalUsd, 17);
  assert.equal(slice.activeChainCount, 2);
  assert.equal(slice.refillRequiredCount, 3);
  assert.deepEqual(slice.items.map((item) => item.sym), ["eth", "wbtc"]);
});

test("capital summary combines wallet balances with deployed Merkl positions", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 205.5,
      items: [{ sym: "usdc", usd: 100 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deposit USDC to YO",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 96.25,
        },
        {
          opportunityId: "b",
          label: "Supply RLUSD on Euler",
          chain: "ethereum",
          protocol: "euler",
          pair: ["rlusd"],
          capUsd: 51.44,
        },
      ],
    },
    generatedAt: "2026-04-25T06:00:00.000Z",
  });

  assert.equal(slice.walletUsd, 205.5);
  assert.equal(slice.deployedUsd, 147.69);
  assert.equal(slice.accountedUsd, 353.19);
  assert.equal(slice.executorEstimatedTotalUsd, null);
  assert.equal(slice.totalUsd, 353.19);
  assert.equal(slice.totalUsdSource, "accounted_wallet_plus_positions");
  assert.equal(slice.walletSource, null);
  assert.equal(slice.walletObservedAt, null);
  assert.equal(slice.walletScanErrorCount, 0);
  assert.equal(slice.externalWalletUsd, null);
  assert.equal(slice.unclassifiedUsd, null);
  assert.equal(slice.activePositionCount, 2);
  assert.deepEqual(slice.positionItems.map((item) => item.protocol), ["yo", "euler"]);
});

test("capital summary falls back to executor asset estimate when wallet accounting undercounts", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: {
      totalUsd: 230.88,
      items: [{ sym: "usdc", usd: 230.88 }],
    },
    merklActivePositions: {
      items: [
        {
          opportunityId: "a",
          label: "Deploy USDC",
          chain: "base",
          protocol: "yo",
          pair: ["usdc"],
          capUsd: 53.62,
        },
      ],
    },
    executorEstimatedAssetValueUsd: 469.01,
    generatedAt: "2026-04-27T00:00:00.000Z",
  });

  assert.equal(slice.accountedUsd, 284.5);
  assert.equal(slice.executorEstimatedTotalUsd, 469.01);
  assert.equal(slice.totalUsd, 469.01);
  assert.equal(slice.totalUsdSource, "executor_estimate");
});

test("flow dashboard slice compacts live activities and leverage hints for the flow tab", () => {
  const slice = buildFlowDashboardSlice({
    executionEvents: [
      {
        eventType: "execution_funding_outcome",
        settlementStatus: "delivered",
        strategyId: "wrapped-btc-loop-base-moonwell",
        observedAt: "2026-04-25T06:10:00.000Z",
        chain: "base",
        asset: "cbBTC",
        amountUsd: 42.5,
        txHashes: ["0xabc"],
      },
    ],
    merklPositionEvents: [
      {
        event: "position_opened",
        status: "open",
        opportunityId: "y1",
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        protocolId: "yo",
        name: "YO USDC",
        amountUsd: 12.25,
        observedAt: "2026-04-25T06:05:00.000Z",
        entryTxHash: "0xdef",
      },
    ],
    signerAuditRecords: [
      {
        timestamp: "2026-04-25T06:20:00.000Z",
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "ethereum",
        amountUsd: 25,
        policyVerdict: "approved",
        intentHash: "intent-1",
        intentId: "intent-1",
        intent: {
          intentType: "erc4626_deposit",
          metadata: {
            protocol: "morpho",
            assetSymbol: "USDT",
          },
        },
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xfeed",
        },
        broadcast: {
          txHash: "0xfeed",
        },
      },
    ],
    payback: {
      grossProfitSatsPeriod: 200000,
      carry: { pendingSats: 150000 },
      paidBackSatsLifetime: 50000,
      lastPaybackSettledAt: "2026-04-25T05:30:00.000Z",
      lastPaybackSettledSats: 25000,
    },
    capitalSummary: { totalUsd: 354.5 },
    btcUsd: 100000,
    wrappedBtcLendingLoopSlice: {
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        protocol: "moonwell",
        targetHealthFactor: 1.8,
        healthFactorMin: 1.35,
        liquidationBufferPct: 14.5,
      },
      entryPlan: {
        projectedHealthFactor: 1.92,
        projectedLiquidationBufferPct: 18.2,
      },
    },
    generatedAt: "2026-04-25T06:30:00.000Z",
  });

  assert.equal(slice.metrics.assetValueUsd, 354.5);
  assert.equal(slice.metrics.grossProfitUsdPeriod, 200);
  assert.equal(slice.metrics.pendingCarryUsd, 150);
  assert.equal(slice.metrics.paidBackUsdLifetime, 50);
  assert.equal(slice.recentActivities.length, 4);
  assert.equal(slice.recentActivities[0].kind, "transaction");
  assert.equal(slice.recentActivities[0].status, "broadcasted");
  assert.equal(slice.recentActivities[0].finalAssetId, "USDT");
  assert.equal(slice.recentActivities[1].kind, "execution");
  assert.equal(slice.recentActivities[1].finalAssetId, "cbBTC");
  assert.equal(slice.recentActivities[2].kind, "position");
  assert.equal(slice.recentActivities[3].kind, "payback");
  assert.equal(slice.recentActivities[3].finalAssetId, "btc");
  assert.equal(slice.strategyRiskById["wrapped-btc-loop-base-moonwell"].projectedHealthFactor, 1.92);
  assert.equal(slice.strategyRiskById["wrapped-btc-loop-base-moonwell"].projectedLiquidationBufferPct, 18.2);
});

test("flow dashboard slice exposes live estimated yield in sats from active APR positions", () => {
  const slice = buildFlowDashboardSlice({
    payback: {
      grossProfitSatsPeriod: 0,
      carry: { pendingSats: 0 },
      paidBackSatsLifetime: 0,
    },
    capitalSummary: { totalUsd: 500 },
    btcUsd: 100000,
    merklActivePositions: {
      items: [
        {
          id: "merkl_yield",
          label: "YO USDC",
          chain: "base",
          protocol: "yo",
          capUsd: 365,
          aprPct: 10,
          lastObservedAt: "2026-04-24T06:30:00.000Z",
        },
      ],
    },
    generatedAt: "2026-04-25T06:30:00.000Z",
  });

  assert.equal(slice.liveYield.status, "active");
  assert.equal(slice.liveYield.positionCount, 1);
  assert.equal(slice.liveYield.weightedAprPct, 10);
  assert.equal(slice.liveYield.estimatedYieldUsd, 0.1);
  assert.equal(slice.liveYield.estimatedYieldSats, 100);
  assert.equal(slice.metrics.liveEstimatedYieldSats, 100);
  assert.equal(slice.metrics.liveEstimatedYieldUsd, 0.1);
  assert.equal(slice.metrics.liveYieldAprPct, 10);
  assert.equal(slice.metrics.liveYieldPositionCount, 1);
});
