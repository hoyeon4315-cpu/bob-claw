import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAllChainAutopilotDashboardSlice } from "../src/status/all-chain-autopilot-slice.mjs";
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
  assert.equal(slice.portfolio.openedCount, 1);
  assert.equal(slice.payback.pendingCarrySats, 601);
  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.topBlockers.some((item) => item.reason === "lifi_quote_rejected"), true);
  assert.equal(slice.nextAction, "resolve_refill_routes");
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
