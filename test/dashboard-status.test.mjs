import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardStatus } from "../src/status/dashboard-status.mjs";
import { trustedOdosQuote } from "./helpers/trusted-odos-quote.mjs";

const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const ZERO = "0x0000000000000000000000000000000000000000";

function route(srcChain, dstChain) {
  return { srcChain, dstChain, srcToken: WBTC_OFT, dstToken: WBTC_OFT };
}

function quote(routeValue, observedAt, amount = "10000") {
  return {
    schemaVersion: 2,
    observedAt,
    route: routeValue,
    routeKey: `${routeValue.srcChain}:${routeValue.srcToken}->${routeValue.dstChain}:${routeValue.dstToken}`,
    quoteType: "layerZero",
    amount,
    grossOutputRatio: 0.99,
    feeRatio: 0.01,
  };
}

test("dashboard status is dashboard-only and keeps live trading blocked", () => {
  const now = "2026-04-10T12:00:00.000Z";
  const bobBase = route("bob", "base");
  const baseBob = route("base", "bob");
  const status = buildDashboardStatus(
    {
      routesRecords: [
        {
          observedAt: "2026-04-10T11:58:00.000Z",
          summary: { totalRoutes: 2 },
          routes: [bobBase, baseBob],
        },
      ],
      quotes: [quote(bobBase, "2026-04-10T10:00:00.000Z"), quote(baseBob, "2026-04-10T10:05:00.000Z")],
      failures: [],
      priceSnapshots: [
        {
          schemaVersion: 1,
          observedAt: "2026-04-10T11:57:00.000Z",
          source: "test",
          btcUsd: 72_988,
          tokenByKey: {
            btc: 72_988,
            wbtc: 72_950,
            ethereum: 2_242.72,
            usd_stable: 1,
          },
          nativeByChain: {
            bob: 2_242.72,
            base: 2_242.72,
          },
        },
      ],
      dexQuotes: [
        {
          observedAt: "2026-04-10T11:58:10.000Z",
          provider: "odos",
          source: "gateway_dst_leg",
          chain: "bob",
          inputToken: WBTC_OFT,
          inputAmount: "10000",
          inputValueUsd: 7.295,
        },
        trustedOdosQuote({
          observedAt: "2026-04-10T11:58:20.000Z",
          source: "gateway_dst_leg",
          chain: "base",
          inputToken: WBTC_OFT,
          inputAmount: "10000",
          inputValueUsd: 7.302,
        }),
      ],
      gasSnapshots: [
        {
          observedAt: "2026-04-10T11:55:00.000Z",
          chain: "bob",
          gasPriceWei: "1",
          blockNumber: "10",
          latencyMs: 100,
          fallbackGasUnits: 250000,
          fallbackTxUsd: 0.01,
          nativeUsd: 1,
        },
        {
          observedAt: "2026-04-10T11:55:00.000Z",
          chain: "base",
          gasPriceWei: "1",
          blockNumber: "10",
          latencyMs: 100,
          fallbackGasUnits: 250000,
          fallbackTxUsd: 0.01,
          nativeUsd: 1,
        },
      ],
      gasFailures: [],
      updateSnapshots: [
        {
          observedAt: "2026-04-10T11:59:00.000Z",
          snapshot: {
            routeCount: 2,
            ethFamilyRouteCount: 1,
            ethFamilyChainPairs: ["base->ethereum"],
            chains: ["base", "bob"],
            bobTouchingRouteKeys: ["bob:btc->base:btc", "base:btc->bob:btc"],
            routeHash: "route-hash",
          },
          diff: {
            addedEthFamilyRoutes: ["base:0x0->ethereum:0x0"],
            removedEthFamilyRoutes: [],
          },
          ethFamily: {
            routeCount: 1,
            surfaceChanged: true,
            chainPairs: ["base->ethereum"],
            addedChainPairs: ["base->ethereum"],
            removedChainPairs: [],
          },
          updateDetected: false,
          changeReasons: [],
          probes: [{ ok: true }, { ok: true }],
          probeFailures: [],
          schemaHash: "schema-hash",
          probeHealthHash: "probe-health-hash",
        },
      ],
      updateAlerts: [],
      preliveSimulationRuns: [
        {
          observedAt: "2026-04-10T11:50:00.000Z",
          status: "simulated_ok",
        },
      ],
      preliveForkPlan: {
        plans: [
          {
            observedAt: "2026-04-10T11:51:00.000Z",
            planId: "plan-1",
            routeLabel: "bob->base",
            routeKey: `${bobBase.srcChain}:${bobBase.srcToken}->${bobBase.dstChain}:${bobBase.dstToken}`,
            amount: "10000",
            status: "planned",
            selectionSource: "objective",
          },
        ],
      },
      preliveForkSubmissions: [],
      preliveForkReceipts: [],
      shadowRefreshBatches: [
        {
          observedAt: "2026-04-10T11:52:00.000Z",
          batchId: "batch-1",
          mode: "execute",
          batchStatus: "succeeded",
          stopReason: null,
          selectedCount: 1,
          queueResults: [{ executionStatus: "succeeded" }],
          followUps: [],
          circuitBreaker: { blocked: false },
        },
      ],
      preliveEvidenceCampaigns: [
        {
          observedAt: "2026-04-10T11:53:00.000Z",
          campaignId: "campaign-1",
          mode: "execute",
          finalStatus: "ready",
          stopReason: null,
          finalCampaign: {
            currentStage: "shadow_replay",
            nextAction: {
              code: "execute_refresh_batch",
              status: "ready",
            },
            readyActionCount: 1,
            blockedActionCount: 2,
            manualActionCount: 0,
            simulation: {
              successRemaining: 50,
            },
            forkExecution: {
              successRemaining: 3,
            },
          },
        },
      ],
      executorRuntime: {
        heartbeatPath: "./state/executor-heartbeat.json",
        observedAt: "2026-04-10T11:59:30.000Z",
        heartbeatPresent: true,
        pid: 12345,
        signerSocketPath: "./state/executor-signer.sock",
        signerSocketPresent: true,
        signerStatus: "listening",
        lastCommand: "health",
        watchdog: {
          status: "healthy",
          stale: false,
          ageMs: 30_000,
          ttlMs: 60_000,
        },
        runtimeStatus: "healthy",
        available: true,
      },
    },
    {
      now,
      auditTargets: {
        currentQuoteSchemaVersion: 2,
        minShadowHours: 1,
        minBobNeighborCoveragePct: 0,
        minGlobalRouteCoveragePctForDiscovery: 0,
        minSamplesPerCandidateRoute: 1,
        minAmountLevelsPerCandidateRoute: 1,
        minHourBuckets: 1,
        maxFailureRatePct: 10,
        maxGasSnapshotAgeMinutes: 30,
      },
    },
  );

  assert.equal(status.schemaVersion, 2);
  assert.equal(status.overall.liveTrading, "BLOCKED");
  assert.equal(status.exposurePolicy.cloudflare, "dashboard_only");
  assert.equal(status.exposurePolicy.containsPrivateKeys, false);
  assert.equal(status.gateway.updateDetected, false);
  assert.equal(status.gateway.probeOk, 2);
  assert.equal(status.gateway.ethFamilyWatch.routeCount, 1);
  assert.equal(status.gateway.ethFamilyWatch.surfaceChanged, true);
  assert.equal(status.gateway.ethFamilyWatch.addedRoutesCount, 1);
  assert.deepEqual(status.gateway.ethFamilyWatch.chainPairs, ["base->ethereum"]);
  assert.deepEqual(status.gateway.announcedChainCoverage.missingAnnouncedChains, [
    "avalanche",
    "bera",
    "bitcoin",
    "bsc",
    "ethereum",
    "optimism",
    "sei",
    "soneium",
    "sonic",
    "unichain",
  ]);
  assert.equal(status.gas.missingGatewayGasChainCount, 0);
  assert.equal(status.market.wbtcUsd, 72_950);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").ticker, "wBTC");
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").usd, null);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").coverageReason, "no_supported_router_for_chain:60808");
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").quoteable, false);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").usd, 73_020);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").deltaPct > 0, true);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").stale, false);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").coverageReason, "dex_quote_observed");
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").quoteable, true);
  assert.equal(status.market.observedChainCount, 1);
  assert.equal(status.market.missingChainCount, 1);
  assert.equal(status.market.staleChainCount, 0);
  assert.equal(status.prelive.liveTradingPolicy, "BLOCKED");
  assert.equal(typeof status.prelive.currentStage, "string");
  assert.equal(typeof status.prelive.forkExecution.status, "string");
  assert.equal(typeof status.prelive.executionAudit.status, "string");
  assert.equal(status.prelive.executionAudit.recentTransitions.length, 1);
  assert.equal(status.prelive.forkExecution.planCount, 1);
  assert.equal(status.executorRuntime.runtimeStatus, "healthy");
  assert.equal(status.executorRuntime.signerSocketPresent, true);
  assert.equal(status.shadowCycle == null || typeof status.shadowCycle.refreshBatch?.runCount === "number", true);
  assert.equal(status.shadowCycle == null || typeof status.shadowCycle.refreshBatch?.latestStatus === "string", true);
  assert.equal(status.prelive.evidenceCampaign.runCount, 1);
  assert.equal(status.prelive.evidenceCampaign.latestStatus, "ready");
  assert.equal(status.dataCounts.preliveSimulationRuns, 1);
  assert.equal(status.dataCounts.preliveForkPlans, 1);
  assert.equal(status.dataCounts.shadowRefreshBatches, 1);
  assert.equal(status.dataCounts.preliveEvidenceCampaigns, 1);
  assert.equal(status.dataCounts.priceSnapshots, 1);
  assert.equal(status.dataCounts.executorHeartbeatPresent, 1);
  assert.equal(status.strategy.pivotPlan.budgetScenarios.length, 1);
  assert.equal(status.strategy.yieldShadowBook.topProfile.id, "research_pilot");
  assert.equal(typeof status.strategy.proxySpreadCoveragePlan.planCount, "number");
  assert.equal(status.strategy.strategySnapshot.activeBudgetUsd, 1_000_000);
  assert.equal(status.strategy.strategySnapshot.topPivot.id, "gateway_base_btc_yield");
});

test("dashboard status records chain price coverage reasons for missing dex observations", () => {
  const avalancheBob = route("avalanche", "bob");
  const bobSonic = route("bob", "sonic");
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        summary: { totalRoutes: 2 },
        routes: [avalancheBob, bobSonic],
      },
    ],
    quotes: [
      quote(avalancheBob, "2026-04-10T11:58:10.000Z", "10000", "10000", "9990"),
      quote(bobSonic, "2026-04-10T11:58:20.000Z", "10000", "10000", "9990"),
    ],
    failures: [],
    dexQuotes: [],
    dexFailures: [
      {
        observedAt: "2026-04-10T11:59:00.000Z",
        provider: "odos",
        source: "gateway_src_leg",
        chain: "avalanche",
        token: WBTC_OFT,
        amount: "10000",
        reason: "odos_quote_failed",
      },
    ],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [
      {
        observedAt: "2026-04-10T11:59:00.000Z",
        snapshot: {
          routeCount: 2,
          chains: ["avalanche", "bob", "sonic"],
          bobTouchingRouteKeys: [],
          routeHash: "route-hash",
        },
        updateDetected: false,
        changeReasons: [],
        probes: [{ ok: true }],
        probeFailures: [],
        schemaHash: "schema-hash",
        probeHealthHash: "probe-health-hash",
      },
    ],
    updateAlerts: [],
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "avalanche").coverageReason, "odos_quote_failed");
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "avalanche").quoteable, true);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "sonic").coverageReason, "eligible_quote_not_run");
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "sonic").quoteable, true);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").coverageReason, "no_supported_router_for_chain:60808");
});

test("dashboard status normalizes legacy Odos unsupported failures for Bera market coverage", () => {
  const now = "2026-04-10T12:00:00.000Z";
  const avalancheBera = route("avalanche", "bera");
  const status = buildDashboardStatus(
    {
      routesRecords: [
        {
          observedAt: "2026-04-10T11:58:00.000Z",
          summary: { totalRoutes: 1 },
          routes: [avalancheBera],
        },
      ],
      quotes: [quote(avalancheBera, "2026-04-10T11:50:00.000Z")],
      failures: [],
      priceSnapshots: [
        {
          schemaVersion: 1,
          observedAt: "2026-04-10T11:57:00.000Z",
          source: "test",
          btcUsd: 72_988,
          tokenByKey: {
            btc: 72_988,
            wbtc: 72_950,
            ethereum: 2_242.72,
            usd_stable: 1,
          },
          nativeByChain: {
            avalanche: 30,
            bera: 1,
          },
        },
      ],
      dexQuotes: [],
      dexFailures: [
        {
          observedAt: "2026-04-10T11:58:10.000Z",
          provider: "router_selection",
          source: "gateway_dst_leg",
          chain: "bera",
          token: WBTC_OFT,
          amount: "10000",
          gatewayRouteKey: `${avalancheBera.srcChain}:${avalancheBera.srcToken}->${avalancheBera.dstChain}:${avalancheBera.dstToken}`,
          gatewayAmount: "10000",
          ok: false,
          reason: "odos_chain_not_supported",
        },
      ],
      gasSnapshots: [
        {
          observedAt: "2026-04-10T11:55:00.000Z",
          chain: "avalanche",
          gasPriceWei: "1",
          blockNumber: "10",
          latencyMs: 100,
          fallbackGasUnits: 250000,
          fallbackTxUsd: 0.01,
          nativeUsd: 30,
        },
      ],
      gasFailures: [],
      updateSnapshots: [],
      updateAlerts: [],
      executorRuntime: {
        observedAt: "2026-04-10T11:59:30.000Z",
        heartbeatPresent: true,
        signerSocketPresent: true,
        watchdog: { status: "healthy", stale: false, ageMs: 30_000, ttlMs: 60_000 },
        runtimeStatus: "healthy",
        available: true,
      },
    },
    {
      now,
      auditTargets: {
        currentQuoteSchemaVersion: 2,
        minShadowHours: 1,
        minBobNeighborCoveragePct: 0,
        minGlobalRouteCoveragePctForDiscovery: 0,
        minSamplesPerCandidateRoute: 1,
        minAmountLevelsPerCandidateRoute: 1,
        minHourBuckets: 1,
        maxFailureRatePct: 10,
        maxGasSnapshotAgeMinutes: 30,
      },
    },
  );

  const beraPrice = status.market.chainWbtcPrices.find((item) => item.chain === "bera");
  assert.equal(beraPrice.coverageReason, "no_supported_router_for_chain:80094");
  assert.equal(beraPrice.coverageFailure, "no_supported_router_for_chain:80094");
  assert.equal(status.dex.skippedReasons.find((item) => item.reason === "no_supported_router_for_chain:80094")?.count, 1);
});

test("dashboard status includes Gateway visual routes with segment-specific asset traces", () => {
  const btcBob = { srcChain: "bitcoin", dstChain: "bob", srcToken: ZERO, dstToken: WBTC_OFT };
  const bobBase = route("bob", "base");
  const baseSonic = route("base", "sonic");
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        summary: { totalRoutes: 3, chainPairs: [{ pair: "bitcoin->bob", count: 1 }] },
        routes: [btcBob, bobBase, baseSonic],
      },
    ],
    quotes: [quote(bobBase, "2026-04-10T10:00:00.000Z"), quote(baseSonic, "2026-04-10T10:01:00.000Z")],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [],
    updateAlerts: [],
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.gateway.flowRoutes.some((item) => item.pair === "bob->base"), true);
  assert.equal(status.gateway.flowRoutes.some((item) => item.pair === "base->sonic"), true);
  assert.deepEqual(status.gateway.recentFlowEvents[0].path, ["bob", "bob_gateway", "base"]);
  assert.deepEqual(status.gateway.recentFlowEvents[1].path, ["base", "bob_gateway", "sonic"]);
  assert.equal(status.gateway.recentFlowEvents[0].asset.ticker, "wBTC.OFT");
  assert.equal(status.gateway.recentFlowEvents[0].asset.icon, "wbtc");
  assert.deepEqual(status.gateway.recentFlowEvents[0].segments.map((segment) => segment.asset.ticker), ["wBTC.OFT", "wBTC.OFT"]);
  assert.equal(status.gateway.flowRoutes.find((item) => item.pair === "bob->base").assets[0].ticker, "wBTC.OFT");
  assert.equal(status.gateway.flowRoutes.find((item) => item.pair === "bitcoin->bob").assets[0].ticker, "BTC->wBTC.OFT");
  assert.equal(status.gateway.flowRoutes.find((item) => item.pair === "bitcoin->bob").assets[0].src.ticker, "BTC");
  assert.equal(status.gateway.flowRoutes.find((item) => item.pair === "bitcoin->bob").assets[0].dst.ticker, "wBTC.OFT");
  assert.equal(status.gateway.assetCoverage.supportedAssetCount, 2);
  assert.equal(status.gateway.assetCoverage.sampledAssetCount, 1);
  assert.equal(status.gateway.assetCoverage.unsampledAssets[0].ticker, "BTC->wBTC.OFT");
  assert.deepEqual(status.gateway.btcWatchlist.observedTickers, ["BTC", "wBTC.OFT"]);
  assert.equal(status.gateway.btcWatchlist.missingTickers.includes("xSolvBTC"), true);
  assert.equal(status.gateway.btcWatchlist.watchlistMissing.find((item) => item.ticker === "xSolvBTC").source.label, "BOB launches 1-Click native BTC <-> wBTC.OFT transfers");
  assert.equal(status.gateway.chainPairs[0].pair, "bitcoin->bob");
});

test("dashboard status surfaces update and gas blockers", () => {
  const now = "2026-04-10T12:00:00.000Z";
  const bobBitcoin = { srcChain: "bob", dstChain: "bitcoin", srcToken: WBTC_OFT, dstToken: ZERO };
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-10T09:00:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [bobBitcoin],
      },
    ],
    quotes: [],
    failures: [],
    gasSnapshots: [
      {
        observedAt: "2026-04-10T08:00:00.000Z",
        chain: "bob",
        gasPriceWei: "1",
      },
    ],
    gasFailures: [],
    updateSnapshots: [
      {
        observedAt: "2026-04-10T11:59:00.000Z",
        snapshot: { routeCount: 1, chains: ["bitcoin", "bob"], routeHash: "route-hash" },
        updateDetected: true,
        changeReasons: ["probe_health"],
        probes: [{ ok: false }],
        probeFailures: [{ routeKey: "bob:btc->bitcoin:btc", errorStatus: 500, errorCode: "INTERNAL_ERROR" }],
      },
    ],
    updateAlerts: [{ observedAt: "2026-04-10T11:59:00.000Z", changeReasons: ["probe_health"] }],
  }, { now });

  assert.equal(status.overall.liveTrading, "BLOCKED");
  assert.equal(status.gateway.updateDetected, true);
  assert.equal(status.gateway.probeFailures.length, 1);
  assert.equal(status.overall.blockers.includes("gateway_update_pending_review"), true);
  assert.equal(status.overall.blockers.includes("gateway_probe_failures"), true);
  assert.equal(status.overall.blockers.includes("stale_gas_snapshots"), true);
});

test("dashboard status flags gateway chains missing gas snapshots", () => {
  const status = buildDashboardStatus({
    routesRecords: [],
    quotes: [],
    failures: [],
    gasSnapshots: [{ observedAt: "2026-04-10T11:55:00.000Z", chain: "bob", gasPriceWei: "1" }],
    gasFailures: [],
    updateSnapshots: [
      {
        observedAt: "2026-04-10T11:59:00.000Z",
        snapshot: { routeCount: 2, chains: ["base", "bitcoin", "bob"], routeHash: "route-hash" },
        updateDetected: false,
        changeReasons: [],
        probes: [],
        probeFailures: [],
      },
    ],
    updateAlerts: [],
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.deepEqual(status.gas.missingGatewayGasChains, ["base"]);
  assert.equal(status.overall.blockers.includes("missing_gateway_gas_snapshots"), true);
});

test("dashboard status lists stale gateway gas chains", () => {
  const now = "2026-04-10T12:00:00.000Z";
  const baseBob = route("base", "bob");
  const status = buildDashboardStatus(
    {
      routesRecords: [
        {
          observedAt: "2026-04-10T11:58:00.000Z",
          summary: { totalRoutes: 1 },
          routes: [baseBob],
        },
      ],
      quotes: [quote(baseBob, "2026-04-10T11:00:00.000Z")],
      failures: [],
      priceSnapshots: [
        {
          schemaVersion: 1,
          observedAt: "2026-04-10T11:57:00.000Z",
          source: "test",
          btcUsd: 72_988,
          tokenByKey: { btc: 72_988, wbtc: 72_950, ethereum: 2_242.72, usd_stable: 1 },
          nativeByChain: { base: 2_242.72, bob: 2_242.72 },
        },
      ],
      dexQuotes: [],
      gasSnapshots: [
        {
          observedAt: "2026-04-10T11:20:00.000Z",
          chain: "base",
          gasPriceWei: "1",
          blockNumber: "10",
          latencyMs: 100,
          fallbackGasUnits: 250000,
          fallbackTxUsd: 0.01,
          nativeUsd: 1,
        },
        {
          observedAt: "2026-04-10T11:55:00.000Z",
          chain: "bob",
          gasPriceWei: "1",
          blockNumber: "11",
          latencyMs: 100,
          fallbackGasUnits: 250000,
          fallbackTxUsd: 0.01,
          nativeUsd: 1,
        },
      ],
      gasFailures: [],
      updateSnapshots: [],
      updateAlerts: [],
      preliveSimulationRuns: [],
      preliveForkPlan: { plans: [] },
      preliveForkSubmissions: [],
      preliveForkReceipts: [],
      shadowRefreshBatches: [],
      preliveEvidenceCampaigns: [],
      executorRuntime: null,
    },
    {
      now,
      auditTargets: {
        currentQuoteSchemaVersion: 2,
        minShadowHours: 1,
        minBobNeighborCoveragePct: 0,
        minGlobalRouteCoveragePctForDiscovery: 0,
        minSamplesPerCandidateRoute: 1,
        minAmountLevelsPerCandidateRoute: 1,
        minHourBuckets: 1,
        maxFailureRatePct: 10,
      },
    },
  );

  assert.deepEqual(status.gas.staleGatewayGasChains, ["base"]);
  assert.equal(status.gas.staleChainCount30m, 1);
});

test("dashboard status includes read-only opportunity summary", () => {
  const bobBase = route("bob", "base");
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [bobBase],
      },
    ],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [],
    updateAlerts: [],
    scoreSnapshot: {
      generatedAt: "2026-04-10T12:00:00.000Z",
      scoredQuotes: 2,
      summary: { shadowCandidates: 0, insufficientData: 1 },
      scores: [
        {
          srcChain: "bob",
          dstChain: "base",
          srcAsset: { ticker: "wBTC.OFT" },
          dstAsset: { ticker: "wBTC.OFT" },
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.5,
          dataGaps: [],
          dex: { provider: "odos" },
        },
        {
          srcChain: "bitcoin",
          dstChain: "bob",
          srcAsset: { ticker: "BTC" },
          dstAsset: { ticker: "wBTC.OFT" },
          tradeReadiness: "insufficient_data",
          netEdgeUsd: -0.1,
          dataGaps: ["bitcoin_network_fee_not_modelled"],
        },
      ],
    },
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-04-10T11:59:00.000Z",
        chain: "base",
        inputValueUsd: 7,
        outputValueUsd: 7.01,
        gasEstimateValueUsd: 0.01,
        priceImpactPct: 0,
      }),
    ],
    dexFailures: [{ observedAt: "2026-04-10T11:58:00.000Z", provider: "odos", reason: "input_is_quote_stable" }],
    bitcoinFeeSnapshots: [
      {
        observedAt: "2026-04-10T11:57:00.000Z",
        source: "test",
        selectedFeeRateSatVb: 4,
        vbytes: 180,
        estimatedFeeSats: 720,
        estimatedFeeUsd: 0.52,
        btcUsd: 50_000,
        model: "estimated_single_input_single_output",
      },
    ],
    estimatorWalletReadiness: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        address: "0x000000000000000000000000000000000000dEaD",
        routeKey: "bob:btc->base:btc",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
        overallReady: false,
        native: { ok: false },
        token: { ok: true },
        allowance: { ok: false },
      },
    ],
    estimatorWalletReadinessFailures: [
      {
        observedAt: "2026-04-10T11:59:00.000Z",
        address: "0x000000000000000000000000000000000000dEaD",
        reason: "missing_tx_data",
      },
    ],
    shadowObservations: [
      {
        observedAt: "2026-04-10T10:30:00.000Z",
        routeKey: `${bobBase.srcChain}:${bobBase.srcToken}->${bobBase.dstChain}:${bobBase.dstToken}`,
        amount: "10000",
        observedEdgePct: 0.012,
        requiredEdgePct: 0.01,
        latencyMs: 1200,
        executionGasUsd: 0.03,
      },
      {
        observedAt: "2026-04-10T10:30:08.000Z",
        routeKey: `${bobBase.srcChain}:${bobBase.srcToken}->${bobBase.dstChain}:${bobBase.dstToken}`,
        amount: "10000",
        observedEdgePct: 0.011,
        requiredEdgePct: 0.01,
        latencyMs: 1180,
        executionGasUsd: 0.031,
      },
    ],
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.opportunity.scoredQuotes, 2);
  assert.equal(status.opportunity.candidateCount, 0);
  assert.equal(status.opportunity.dexBacked, 1);
  assert.equal(status.opportunity.rejectedNoEdge, 1);
  assert.equal(status.opportunity.highFailureRate, 0);
  assert.equal(status.opportunity.positiveInsufficientCount, 0);
  assert.equal(status.opportunity.topPositiveInsufficientRoute, null);
  assert.equal(status.opportunity.dataGaps[0].gap, "bitcoin_network_fee_not_modelled");
  assert.equal(status.strategy.profitModel, "non_directional_edge_only");
  assert.equal(status.strategy.directionalBtcAccumulationCountsAsProfit, false);
  assert.equal(status.strategy.liveExecutionBlocked, true);
  assert.equal(status.strategy.bestStablecoinRoute, null);
  assert.equal(typeof status.strategy.dexEnvironment.monitoredRouteCount, "number");
  assert.equal(typeof status.strategy.dexRouteFocus.loopObservableCount, "number");
  assert.equal(typeof status.strategy.dexRouteUniverse.fullyMeasurableRouteCount, "number");
  assert.equal(typeof status.strategy.edgeViability.measuredLoopCount, "number");
  assert.equal(typeof status.strategy.edgeViability.policyReadyCount, "number");
  assert.equal(typeof status.strategy.edgeViability.verdict?.code, "string");
  assert.equal(status.strategy.crossAssetArbitrage.entryCount, 0);
  assert.equal(status.strategy.crossAssetArbitrage.exitCount, 0);
  assert.equal(status.strategy.crossAssetArbitrage.bestLoop, null);
  assert.equal(typeof status.strategy.crossAssetArbitrage.amountLadderPairCount, "number");
  assert.equal(typeof status.strategy.btcProxySpreads.opportunityCount, "number");
  assert.equal(status.strategy.btcProxySpreads.nextCoverageTarget !== undefined, true);
  assert.equal(status.strategy.strategyTracks.trackCount >= 2, true);
  assert.equal(status.strategy.strategyTracks.tracks.some((item) => item.kind === "stable_loop"), true);
  assert.equal(status.strategy.strategyTracks.tracks.some((item) => item.kind === "proxy_spread"), true);
  assert.equal(status.strategy.edgeResearch.routeCount, 2);
  assert.equal(status.strategy.edgeResearch.bestCandidate.classification, "no_edge");
  assert.equal(status.strategy.pivotPlan.topRecommendation.id, "gateway_base_btc_yield");
  assert.equal(status.strategy.pivotPlan.currentBudgetUsd, 1_000_000);
  assert.equal(status.strategy.pivotPlan.pivots.some((item) => item.id === "btc_proxy_spreads"), true);
  assert.equal(status.dex.quoteCount, 1);
  assert.deepEqual(status.dex.quotedChains, ["base"]);
  assert.equal(status.dex.skippedReasons[0].reason, "input_is_quote_stable");
  assert.equal(status.bitcoinFee.latest.feeRateSatVb, 4);
  assert.equal(status.bitcoinFee.latest.estimatedFeeUsd, 0.52);
  assert.equal(status.dataCounts.bitcoinFeeSnapshots, 1);
  assert.equal(status.estimatorWallet.routeCount, 1);
  assert.equal(status.estimatorWallet.nativeBlockedCount, 1);
  assert.equal(status.estimatorWallet.allowanceBlockedCount, 1);
  assert.equal(status.dataCounts.estimatorWalletReadiness, 1);
  assert.equal(status.audit.sampleSource, "shadow_observations");
  assert.equal(status.audit.shadowObservations, 2);
  assert.equal(status.audit.targetShadowHours, 168);
  assert.equal(status.audit.remainingShadowHours > 167, true);
  assert.equal(status.audit.targetHourBuckets, 24);
  assert.equal(status.audit.remainingHourBuckets, 23);
  assert.equal(status.audit.earliestShadowWindowReadyAt, "2026-04-17T10:30:00.000Z");
  assert.equal(status.audit.earliestHourBucketReadyAt, "2026-04-11T09:00:00.000Z");
  assert.equal(status.audit.earliestTimeGateReadyAt, "2026-04-17T10:30:00.000Z");
  assert.equal(status.audit.latencyP95Ms, 1200);
  assert.equal(status.audit.executionGasP95Usd, 0.031);
  assert.equal(status.audit.quoteDecayCoveredGroups, 1);
  assert.equal(status.audit.quoteDecayWindows.find((item) => item.windowSeconds === 5).survivedGroups, 1);
  assert.equal(status.dataCounts.shadowObservations, 2);
});

test("dashboard status exposes positive insufficient-data opportunity separately from no-edge blockers", () => {
  const status = buildDashboardStatus({
    routesRecords: [],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [],
    updateAlerts: [],
    scoreSnapshot: {
      generatedAt: "2026-04-10T12:00:00.000Z",
      scoredQuotes: 2,
      summary: { shadowCandidates: 0, insufficientData: 1 },
      scores: [
        {
          srcChain: "base",
          dstChain: "bitcoin",
          srcAsset: { ticker: "USDC" },
          dstAsset: { ticker: "BTC" },
          tradeReadiness: "insufficient_data",
          netEdgeUsd: 1.75,
          dataGaps: ["exact_src_execution_gas_allowance_insufficient"],
        },
        {
          srcChain: "avalanche",
          dstChain: "soneium",
          srcAsset: { ticker: "wBTC.OFT" },
          dstAsset: { ticker: "wBTC.OFT" },
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.6,
          dataGaps: [],
        },
      ],
    },
    dexQuotes: [],
    dexFailures: [],
    bitcoinFeeSnapshots: [],
    estimatorWalletReadiness: [],
    estimatorWalletReadinessFailures: [],
    shadowObservations: [],
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.opportunity.positiveInsufficientCount, 1);
  assert.equal(status.opportunity.topPositiveInsufficientRoute?.srcChain, "base");
  assert.equal(status.opportunity.topPositiveInsufficientRoute?.dstChain, "bitcoin");
  assert.equal(status.opportunity.topPositiveInsufficientRoute?.srcTicker, "USDC");
  assert.equal(status.opportunity.topPositiveInsufficientRoute?.netEdgeUsd, 1.75);
  assert.deepEqual(status.opportunity.topPositiveInsufficientRoute?.dataGaps, ["exact_src_execution_gas_allowance_insufficient"]);
});

test("dashboard status includes shadow cycle summary when available", () => {
  const status = buildDashboardStatus({
    routesRecords: [],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [],
    updateAlerts: [],
    shadowRefreshExecutions: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        rank: 1,
        scope: "canary",
        code: "check_wallet_readiness",
        routeLabel: "base->bitcoin ETH->BTC",
        amount: "1787455313617158",
        executionStatus: "succeeded",
        stepCount: 1,
        steps: [{ script: "check:estimator-wallet", exitCode: 0 }],
      },
    ],
    shadowCycle: {
      observedAt: "2026-04-10T11:59:00.000Z",
      mode: "SHADOW_ONLY",
      headline: "Collect more shadow and realized data",
      blockers: ["no_realized_enabled_routes"],
      canary: {
        decision: "RERUN_SCORING",
        nextReadinessCheck: {
          label: "base->bitcoin ETH->BTC",
          amount: "1787455313617158",
          srcChain: "base",
          srcTicker: "ETH",
          dstChain: "bitcoin",
          dstTicker: "BTC",
        },
        nextReadinessRefresh: {
          state: "cooldown",
          reason: "fresh_recent_check",
          latestObservedAt: "2026-04-10T11:58:30.000Z",
          ageSeconds: 90,
          maxAgeSeconds: 300,
        },
        readinessCheckCount: 2,
      },
      topRoute: {
        label: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
        netEdgeUsd: -0.83,
      },
      shadowRoster: {
        candidateCount: 3,
        viableCount: 1,
        txReadyCount: 2,
        candidates: [
          {
            role: "active_canary",
            label: "bob->base wBTC.OFT->wBTC.OFT",
            amount: "10000",
            srcChain: "bob",
            dstChain: "base",
            viableForPrep: true,
            txReady: true,
            tradeReadiness: "reject_no_net_edge",
            prepFundingUsd: 0,
            netEdgeUsd: -0.83,
            prepBlockers: [],
            scoreDisqualifiers: [],
            readinessFailureReason: null,
            shadowPriorityScore: 10,
            shadowPriorityReason: "evidence_accumulating",
            evidence: {
            quoteSampleCount: 2,
            quoteFailureCount: 1,
            quoteAttemptCount: 3,
            quoteSuccessRate: 2 / 3,
            quoteLatencyP50Ms: 420,
            quoteLatencyP95Ms: 680,
            shadowObservationCount: 2,
            latestQuoteObservedAt: "2026-04-10T11:57:00.000Z",
            latestFailureObservedAt: "2026-04-10T11:58:00.000Z",
            latestObservationObservedAt: "2026-04-10T11:59:00.000Z",
            latestObservedEdgeUsd: -0.83,
            latestKnownCostUsd: 0.21,
            latestExecutionGasUsd: 0.03,
            latestRouteFailureRate: 0.25,
            latestTradeReadiness: "reject_no_net_edge",
            rejectionReasons: [
              { reason: "reject_no_net_edge", count: 2 },
              { reason: "stale_dex_output_quote", count: 1 },
            ],
          },
        },
        {
          role: "tx_ready_shadow",
            label: "ethereum->base WBTC->wBTC.OFT",
            amount: "10000",
            srcChain: "ethereum",
            dstChain: "base",
            viableForPrep: false,
            txReady: true,
            tradeReadiness: "insufficient_data",
            prepFundingUsd: 4.2,
            netEdgeUsd: 64.77,
            prepBlockers: ["native", "token", "allowance"],
            scoreDisqualifiers: [],
            readinessFailureReason: null,
            shadowPriorityScore: 100,
            shadowPriorityReason: "no_shadow_evidence",
          },
        ],
      },
      shadowActions: [
        {
          role: "active_canary",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          code: "wait_for_fresh_inputs",
          reason: "reject_no_net_edge",
          command: null,
        },
        {
          role: "tx_ready_shadow",
          label: "ethereum->base WBTC->wBTC.OFT",
          amount: "10000",
          code: "check_wallet_readiness",
          reason: "native",
          command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
        },
      ],
      strategyPlans: {
        stableLoop: {
          kind: "stable_loop",
          nextAction: "collect_stable_loop_coverage",
          reason: "no_paired_stable_loop_ladder",
          command: null,
          routeKeys: [],
        },
        proxySpread: {
          kind: "proxy_spread",
          nextAction: "watch_proxy_surface",
          reason: "no_proxy_target",
          command: null,
          chains: [],
        },
      },
      objectivePlans: {
        executionReview: {
          status: "measured_hypothesis_under_review",
          selectionCode: "prefer_viable_prep_route_over_measured_hypothesis",
          selectionLabel: "Measured leader stays review-only until readiness and fresh-input blockers clear.",
          routeKey: "ethereum:0x2260->base:0x0555",
          label: "ethereum->base WBTC->wBTC.OFT",
          amount: "10000",
          tradeReadiness: "insufficient_data",
          measuredNetUsd: 64.77,
          scoreNetUsd: -1.01,
          executableNetUsd: 64.99,
          blockers: ["wallet_not_checked", "stale_src_gas_snapshot"],
          blockerLabels: ["wallet readiness check pending", "source gas snapshot stale"],
          reasonLabels: [
            "current canary is the only viable prep route",
            "measured leader is not viable for prep yet",
          ],
          nextActionCode: "check_wallet_readiness",
          nextActionLabel: "wallet readiness check",
          command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
          stepCount: 4,
          steps: [
            {
              code: "check_wallet_readiness",
              label: "wallet readiness check",
              command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
            },
          ],
          hypothesisGuard: "Positive measured edge is still a hypothesis until wallet, gas, and exact execution inputs are all fresh.",
        },
        discovery: {
          source: "secondary_measured_loop",
          sourceLabel: "secondary measured loop",
          status: "missing_decay_survival",
          selectionCode: "secondary_measured_loop",
          selectionLabel: "Use the next measured loop to widen objective route discovery without promoting it to canary prematurely.",
          routeKey: "base:0x0555->unichain:0x0555",
          label: "base->unichain wBTC.OFT->wBTC.OFT",
          amount: "25000",
          classification: "missing_decay_survival",
          measuredNetUsd: 0.72,
          gapToPolicyUsd: 0,
          requiredNetProfitUsd: 0.3,
          bestNetEdgeUsd: 1.2,
          profitableLevels: 2,
          amountLevels: 2,
          nextActionCode: "collect_decay_survival",
          nextActionLabel: "collect decay survival samples",
          reason: "missing_decay_survival",
          command: "npm run verify:gateway -- --route-key=base:0x0555->unichain:0x0555 --amounts=25000 && npm run quote:dex -- --route-key=base:0x0555->unichain:0x0555 --amount=25000 --include-stable-entry && npm run score:gateway -- --write --route-key=base:0x0555->unichain:0x0555 --amount=25000",
          stepCount: 2,
          steps: [
            {
              code: "collect_decay_survival",
              label: "collect decay survival samples",
              command: "npm run verify:gateway -- --route-key=base:0x0555->unichain:0x0555 --amounts=25000 && npm run quote:dex -- --route-key=base:0x0555->unichain:0x0555 --amount=25000 --include-stable-entry && npm run score:gateway -- --write --route-key=base:0x0555->unichain:0x0555 --amount=25000",
            },
          ],
        },
      },
      refreshQueue: [
        {
          rank: 1,
          priority: 100,
          kind: "canary_readiness",
          scope: "canary",
          code: "check_wallet_readiness",
          label: "refresh canary readiness",
          reason: "fresh_recent_check",
          command: "npm run check:estimator-wallet -- --route-key=base:eth->bitcoin:btc --amount=1787455313617158 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
          routeKey: "base:eth->bitcoin:btc",
          routeLabel: "base->bitcoin ETH->BTC",
          amount: "1787455313617158",
          routeKeys: [],
          chains: [],
          proxyGroup: null,
        },
        {
          rank: 2,
          priority: 89,
          kind: "objective_plan",
          scope: "execution_review",
          code: "check_wallet_readiness",
          label: "wallet readiness check",
          reason: "wallet_not_checked",
          command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
          routeKey: "ethereum:0x2260->base:0x0555",
          routeLabel: "ethereum->base WBTC->wBTC.OFT",
          amount: "10000",
          routeKeys: [],
          chains: [],
          proxyGroup: null,
          status: "measured_hypothesis_under_review",
          selectionCode: "prefer_viable_prep_route_over_measured_hypothesis",
          source: null,
        },
        {
          rank: 3,
          priority: 35,
          kind: "ops",
          scope: "route_performance",
          code: "report_route_performance",
          label: "refresh route performance report",
          reason: "no_realized_enabled_routes",
          command: "npm run report:route-performance -- --write",
          routeKey: null,
          routeLabel: null,
          amount: null,
          routeKeys: [],
          chains: [],
          proxyGroup: null,
        },
      ],
      treasury: {
        decision: "BLOCKED",
        estimatedWalletUsd: 25.01,
        walletValueFloorUsd: 250,
        walletValueShortfallUsd: 224.99,
        noDemandBlockerCount: 2,
        nextNeeds: [
          {
            state: "waiting_demand",
            chain: "base",
            ticker: "ETH",
            refillAmountDecimal: 0.0032,
            refillEstimatedUsd: 7.11,
            activation: {
              code: "awaiting_wallet_readiness_check",
              routeLabel: "base->bitcoin ETH->BTC",
              candidateCount: 2,
            },
          },
        ],
      },
      audit: {
        address: {
          consistent: false,
          issues: ["configured_address_stale_vs_resolved_cycle_address"],
        },
        inventory: {
          consistent: true,
          issues: [],
        },
      },
    },
    advanceCanary: {
      observedAt: "2026-04-10T11:59:00.000Z",
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      actionCount: 4,
      actions: ["check-estimator-wallet", "estimate-gateway-gas", "score-gateway", "status-dashboard"],
      initial: {
        decision: "RUN_EXACT_GAS",
        headline: "Run exact gas estimate",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        reasons: ["stale_src_gas_snapshot"],
      },
      final: {
        decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        headline: "Best prepared route still fails objective score review",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        reasons: ["reject_no_net_edge"],
      },
    },
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.shadowCycle.mode, "SHADOW_ONLY");
  assert.equal(status.shadowCycle.blockerCount, 1);
  assert.equal(status.shadowCycle.canaryDecision, "RERUN_SCORING");
  assert.deepEqual(status.shadowCycle.canary, {
    decision: "RERUN_SCORING",
    nextReadinessCheck: {
      label: "base->bitcoin ETH->BTC",
      amount: "1787455313617158",
      srcChain: "base",
      srcTicker: "ETH",
      dstChain: "bitcoin",
      dstTicker: "BTC",
    },
    nextReadinessRefresh: {
      state: "cooldown",
      reason: "fresh_recent_check",
      latestObservedAt: "2026-04-10T11:58:30.000Z",
      ageSeconds: 90,
      maxAgeSeconds: 300,
    },
    readinessCheckCount: 2,
  });
  assert.equal(status.shadowCycle.topRoute.label, "bob->base wBTC.OFT->wBTC.OFT");
  assert.equal(status.shadowCycle.topRoute.tradeReadinessLabel, "알려진 비용 반영 후 순이익이 아직 음수");
  assert.equal(status.shadowCycle.topRoute.tradeReadinessDetail, "순엣지 -$0.83");
  assert.equal(status.shadowCycle.shadowRoster.candidateCount, 3);
  assert.equal(status.shadowCycle.shadowRoster.candidates[0].roleLabel, "현재 canary");
  assert.equal(status.shadowCycle.shadowRoster.candidates[1].roleLabel, "payload 확보 shadow 후보");
  assert.equal(status.shadowCycle.shadowRoster.candidates[1].tradeReadinessLabel, "가격 또는 가스 데이터가 아직 부족함");
  assert.equal(status.shadowCycle.shadowRoster.candidates[1].shadowPriorityReason, "no_shadow_evidence");
  assert.equal(status.shadowCycle.shadowRoster.candidates[0].evidence.quoteSampleCount, 2);
  assert.equal(status.shadowCycle.shadowRoster.candidates[0].evidence.quoteFailureCount, 1);
  assert.equal(Number(status.shadowCycle.shadowRoster.candidates[0].evidence.quoteSuccessRate.toFixed(3)), 0.667);
  assert.equal(status.shadowCycle.shadowRoster.candidates[0].evidence.latestKnownCostUsd, 0.21);
  assert.equal(status.shadowCycle.shadowRoster.candidates[0].evidence.rejectionReasons[0].reason, "reject_no_net_edge");
  assert.equal(status.shadowCycle.shadowActions[0].actionLabel, "신선한 입력 대기");
  assert.equal(status.shadowCycle.shadowActions[1].actionLabel, "지갑 준비 점검");
  assert.equal(status.shadowCycle.shadowActions[1].command.includes("check:estimator-wallet"), true);
  assert.equal(status.shadowCycle.strategyPlans.stableLoop.nextAction, "collect_stable_loop_coverage");
  assert.equal(status.shadowCycle.strategyPlans.proxySpread.nextAction, "watch_proxy_surface");
  assert.equal(status.shadowCycle.objectivePlans.executionReview.nextActionCode, "check_wallet_readiness");
  assert.equal(status.shadowCycle.objectivePlans.discovery.nextActionCode, "collect_decay_survival");
  assert.equal(status.shadowCycle.refreshQueue[0].scope, "tx_ready_shadow");
  assert.equal(status.shadowCycle.refreshQueue[0].code, "check_wallet_readiness");
  assert.equal(status.shadowCycle.refreshQueue.some((item) => item.code === "check_wallet_readiness"), true);
  assert.equal(
    status.shadowCycle.refreshQueue.some((item) => item.command === "npm run report:route-performance -- --write"),
    true,
  );
  assert.equal(status.strategy.objectivePlans.executionReview.routeKey, "ethereum:0x2260->base:0x0555");
  assert.equal(status.strategy.objectivePlans.discovery.source, "secondary_measured_loop");
  assert.equal(status.shadowCycle.treasury.estimatedWalletUsd, 25.01);
  assert.equal(status.shadowCycle.treasury.walletValueShortfallUsd, 224.99);
  assert.equal(status.shadowCycle.treasury.noDemandBlockerCount, 2);
  assert.deepEqual(status.shadowCycle.treasury.nextNeeds[0], {
    state: "waiting_demand",
    chain: "base",
    ticker: "ETH",
    refillAmountDecimal: 0.0032,
    refillEstimatedUsd: 7.11,
    activation: {
      code: "awaiting_wallet_readiness_check",
      label: "지갑 준비 점검이 더 필요함",
      routeLabel: "base->bitcoin ETH->BTC",
      candidateCount: 2,
    },
  });
  assert.equal(status.shadowCycle.audit.addressConsistent, false);
  assert.equal(status.shadowCycle.audit.inventoryConsistent, true);
  assert.equal(status.shadowCycle.audit.issueCount, 1);
  assert.equal(status.shadowCycle.audit.issues[0].label, "기본 지갑 설정이 최신 운영 주소와 다름");
  assert.equal(status.shadowCycle.refreshExecution.runCount, 1);
  assert.equal(status.shadowCycle.refreshExecution.recentExecutions[0].executionStatus, "succeeded");
  assert.equal(status.dataCounts.shadowCyclePresent, 1);
  assert.equal(status.dataCounts.shadowRefreshExecutions, 1);
  assert.equal(status.canaryAdvance.initial.decision, "RUN_EXACT_GAS");
  assert.equal(status.canaryAdvance.final.decision, "BLOCKED_NO_VIABLE_PREP_ROUTE");
  assert.deepEqual(status.canaryAdvance.actions, ["check-estimator-wallet", "estimate-gateway-gas", "score-gateway", "status-dashboard"]);
  assert.equal(status.dataCounts.advanceCanaryPresent, 1);
});

test("dashboard status adds manual memos for refresh, review, and treasury follow-up", () => {
  const bobBase = route("bob", "base");
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [bobBase],
      },
    ],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [],
    updateAlerts: [],
    scoreSnapshot: {
      generatedAt: "2026-04-10T10:00:00.000Z",
      scoredQuotes: 1,
      summary: { shadowCandidates: 0, insufficientData: 1 },
      scores: [],
    },
    shadowCycle: {
      observedAt: "2026-04-10T10:05:00.000Z",
      mode: "shadow",
      objectivePlans: {
        executionReview: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          blockers: ["token"],
          blockerLabels: ["source token needed"],
          command: "npm run run:execution-review -- --execute --write --continue-on-error",
        },
      },
      treasury: {
        decision: "BLOCKED",
        walletValueShortfallUsd: 225,
        nextNeeds: [
          {
            chain: "base",
            ticker: "ETH",
            refillAmountDecimal: 0.003,
            refillEstimatedUsd: 6.25,
          },
        ],
      },
    },
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.manualMemos.length, 3);
  assert.equal(status.manualMemos[0].id, "refresh_inputs");
  assert.equal(status.manualMemos[0].command, "npm run watch:canary-readiness");
  assert.equal(status.manualMemos[1].id, "execution_review");
  assert.equal(status.manualMemos[1].whenLabel, "자금 준비 후");
  assert.equal(status.manualMemos[2].id, "treasury_check");
  assert.equal(status.manualMemos[2].command, "npm run plan:treasury-actions -- --json");
});

test("dashboard status adds ETH-family evidence memo when a new ETH surface appears", () => {
  const bobBase = route("bob", "base");
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [bobBase],
      },
    ],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [
      {
        observedAt: "2026-04-10T11:59:00.000Z",
        snapshot: {
          routeCount: 1,
          ethFamilyRouteCount: 1,
          ethFamilyChainPairs: ["base->ethereum"],
          chains: ["base", "bob", "ethereum"],
          bobTouchingRouteKeys: ["bob:btc->base:btc"],
          routeHash: "route-hash",
        },
        diff: {
          addedEthFamilyRoutes: ["base:0x0->ethereum:0x0"],
          removedEthFamilyRoutes: [],
        },
        ethFamily: {
          routeCount: 1,
          surfaceChanged: true,
          chainPairs: ["base->ethereum"],
          addedChainPairs: ["base->ethereum"],
          removedChainPairs: [],
        },
        updateDetected: true,
        changeReasons: ["eth_family_surface"],
        probes: [{ ok: true }],
        probeFailures: [],
        schemaHash: "schema-hash",
        probeHealthHash: "probe-health-hash",
      },
    ],
    updateAlerts: [],
    scoreSnapshot: {
      generatedAt: "2026-04-10T10:00:00.000Z",
      scoredQuotes: 0,
      summary: { shadowCandidates: 0, insufficientData: 0 },
      scores: [],
    },
  }, { now: "2026-04-10T12:00:00.000Z" });

  const memo = status.manualMemos.find((item) => item.id === "eth_family_surface");
  assert.equal(Boolean(memo), true);
  assert.match(memo.command, /audit:eth-family-overfit/);
  assert.match(memo.summary, /base->ethereum/);
});

test("dashboard status exposes ETH profitability and ETH strategy track when ETH-family quotes are measurable", () => {
  const ethRoute = { srcChain: "base", dstChain: "ethereum", srcToken: ZERO, dstToken: ZERO };
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-07T11:58:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [ethRoute],
      },
      {
        observedAt: "2026-04-09T11:58:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [ethRoute],
      },
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [ethRoute],
      },
    ],
    quotes: [
      {
        schemaVersion: 2,
        observedAt: "2026-04-10T11:59:00.000Z",
        route: ethRoute,
        routeKey: `base:${ZERO}->ethereum:${ZERO}`,
        quoteType: "layerZero",
        amount: "10000",
        grossOutputRatio: 0.99,
        feeRatio: 0.01,
      },
    ],
    failures: [],
    dexQuotes: [
      trustedOdosQuote({
        observedAt: "2026-04-10T11:58:10.000Z",
        source: "gateway_src_entry_leg",
        chain: "base",
        gatewayRouteKey: `base:${ZERO}->ethereum:${ZERO}`,
        gatewayAmount: "10000",
        inputTicker: "USDC",
        outputTicker: "ETH",
        inputValueUsd: 7.4,
        gasEstimateValueUsd: 0.03,
        outputAmount: "2000000000000000",
      }),
      trustedOdosQuote({
        observedAt: "2026-04-10T11:58:20.000Z",
        source: "gateway_dst_leg",
        chain: "ethereum",
        gatewayRouteKey: `base:${ZERO}->ethereum:${ZERO}`,
        gatewayAmount: "10000",
        inputTicker: "ETH",
        outputTicker: "USDC",
        inputValueUsd: 7.83,
      }),
    ],
    scoreSnapshot: {
      generatedAt: "2026-04-10T12:00:00.000Z",
      scores: [
        {
          observedAt: "2026-04-10T11:59:30.000Z",
          routeKey: `base:${ZERO}->ethereum:${ZERO}`,
          srcChain: "base",
          srcToken: ZERO,
          dstChain: "ethereum",
          dstToken: ZERO,
          srcAsset: { ticker: "ETH", family: "native_or_wrapped", priceKey: "ethereum", decimals: 18 },
          dstAsset: { ticker: "ETH", family: "native_or_wrapped", priceKey: "ethereum", decimals: 18 },
          amount: "10000",
          inputAmount: 0.002,
          tradeReadiness: "ethereum_l1_policy_override_disabled",
          netEdgeUsd: -0.1,
          executableOutputUsd: 7.83,
          executableNetEdgeUsd: -0.05,
          knownCostUsd: 0.2,
        },
      ],
    },
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.strategy.ethProfitability.routeCount, 1);
  assert.equal(status.strategy.ethProfitability.gatewayRouteCount, 1);
  assert.equal(status.strategy.ethProfitability.recommendationCode, "eth_l1_positive_ev_unconfirmed");
  assert.equal(status.strategy.ethProfitability.followUpActionCode, "measure_eth_fee_domain");
  assert.equal(status.strategy.strategyTracks.tracks.some((item) => item.kind === "eth_family_loop"), true);
});

test("dashboard status includes pnl and trade history summaries", () => {
  const bobBase = route("bob", "base");
  const status = buildDashboardStatus({
    routesRecords: [
      {
        observedAt: "2026-04-10T11:58:00.000Z",
        summary: { totalRoutes: 1 },
        routes: [bobBase],
      },
    ],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [],
    updateAlerts: [],
    scoreSnapshot: {
      generatedAt: "2026-04-10T11:59:00.000Z",
      scoredQuotes: 1,
      summary: { shadowCandidates: 0, insufficientData: 0 },
      scores: [
        {
          srcChain: "bob",
          dstChain: "base",
          srcAsset: { ticker: "wBTC.OFT" },
          dstAsset: { ticker: "wBTC.OFT" },
          tradeReadiness: "shadow_candidate_review_only",
          netEdgeUsd: 0.42,
          dataGaps: [],
        },
      ],
    },
    shadowCycle: {
      observedAt: "2026-04-10T11:58:30.000Z",
      topRoute: {
        label: "bob->base wBTC.OFT->wBTC.OFT",
        tradeReadiness: "shadow_candidate_review_only",
        netEdgeUsd: 0.42,
      },
      objectivePlans: {
        executionReview: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          executableNetUsd: 0.35,
          nextActionLabel: "refresh_dex_and_score",
        },
      },
    },
    executionEvents: [
      {
        observedAt: "2026-04-10T11:59:30.000Z",
        eventType: "execution_reconciled",
        status: "confirmed",
        chain: "base",
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        realized: { realizedNetPnlUsd: 0.18 },
      },
    ],
    receiptReconciliations: [
      {
        observedAt: "2026-04-10T11:59:20.000Z",
        kind: "across_bridge",
        chain: "base",
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        reconciliationStatus: "reconciled",
        routeContext: {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          estimatedNetPnlUsd: 0.22,
        },
        realized: {
          realizedNetPnlUsd: 0.18,
          receiptGasUsd: 0.02,
        },
      },
      {
        observedAt: "2026-04-10T11:59:10.000Z",
        kind: "native_dex_experiment",
        chain: "base",
        txHash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        reconciliationStatus: "reconciled",
        routeContext: {
          routeKey: "base:native->base:usdc",
          amount: "10000",
          estimatedNetPnlUsd: -0.45,
        },
        realized: {
          realizedNetPnlUsd: -0.5,
          receiptGasUsd: 0.04,
        },
      },
    ],
  }, { now: "2026-04-10T12:00:00.000Z" });

  assert.equal(status.pnl.paper.valueUsd, 0.42);
  assert.equal(status.pnl.estimated.valueUsd, 0.35);
  assert.equal(status.pnl.realized.valueUsd, 0.18);
  assert.equal(status.pnl.realized.totalValueUsd, -0.32);
  assert.equal(status.pnl.realized.evidenceCostUsd, -0.5);
  assert.equal(status.pnl.realized.tradeCount, 1);
  assert.equal(status.pnl.realized.evidenceCount, 1);
  assert.equal(status.pnl.realized.breakdown.strategyRealizedPnlUsd, 0.18);
  assert.equal(status.pnl.realized.breakdown.executionEvidenceCostUsd, -0.5);
  assert.equal(status.tradeHistory.count, 1);
  assert.equal(status.tradeHistory.items[0].statusLabel, "체결 확인");
  assert.equal(status.tradeHistory.items[0].chainLabel, "Base");
  assert.equal(status.tradeHistory.items[0].realizedNetPnlUsd, 0.18);
});
