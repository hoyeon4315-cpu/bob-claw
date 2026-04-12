import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardStatus } from "../src/status/dashboard-status.mjs";

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
        {
          observedAt: "2026-04-10T11:58:20.000Z",
          provider: "odos",
          source: "gateway_dst_leg",
          chain: "base",
          inputToken: WBTC_OFT,
          inputAmount: "10000",
          inputValueUsd: 7.302,
        },
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
            chains: ["base", "bob"],
            bobTouchingRouteKeys: ["bob:btc->base:btc", "base:btc->bob:btc"],
            routeHash: "route-hash",
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

  assert.equal(status.overall.liveTrading, "BLOCKED");
  assert.equal(status.exposurePolicy.cloudflare, "dashboard_only");
  assert.equal(status.exposurePolicy.containsPrivateKeys, false);
  assert.equal(status.gateway.updateDetected, false);
  assert.equal(status.gateway.probeOk, 2);
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
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").usd, 72_950);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").coverageReason, "dex_quote_observed");
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").quoteable, false);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").usd, 73_020);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").deltaPct > 0, true);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").stale, false);
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").coverageReason, "dex_quote_observed");
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "base").quoteable, true);
  assert.equal(status.market.observedChainCount, 2);
  assert.equal(status.market.missingChainCount, 0);
  assert.equal(status.market.staleChainCount, 0);
  assert.equal(status.dataCounts.priceSnapshots, 1);
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
  assert.equal(status.market.chainWbtcPrices.find((item) => item.chain === "bob").coverageReason, "odos_chain_not_supported");
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
      {
        provider: "odos",
        observedAt: "2026-04-10T11:59:00.000Z",
        chain: "base",
        inputValueUsd: 7,
        outputValueUsd: 7.01,
        gasEstimateValueUsd: 0.01,
        priceImpactPct: 0,
      },
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
  assert.equal(status.strategy.edgeResearch.routeCount, 2);
  assert.equal(status.strategy.edgeResearch.bestCandidate.classification, "no_edge");
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

test("dashboard status includes shadow cycle summary when available", () => {
  const status = buildDashboardStatus({
    routesRecords: [],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    updateSnapshots: [],
    updateAlerts: [],
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
          },
        ],
      },
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
  assert.equal(status.dataCounts.shadowCyclePresent, 1);
  assert.equal(status.canaryAdvance.initial.decision, "RUN_EXACT_GAS");
  assert.equal(status.canaryAdvance.final.decision, "BLOCKED_NO_VIABLE_PREP_ROUTE");
  assert.deepEqual(status.canaryAdvance.actions, ["check-estimator-wallet", "estimate-gateway-gas", "score-gateway", "status-dashboard"]);
  assert.equal(status.dataCounts.advanceCanaryPresent, 1);
});
