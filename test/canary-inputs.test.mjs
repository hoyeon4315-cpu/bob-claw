import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCanaryInputSummary,
  buildCanaryProgressSummary,
  buildCanaryStageChecklist,
  buildExecutionStageSummary,
} from "../src/status/canary-inputs.mjs";

test("canary input summary captures fresh and stale inputs for the active route", () => {
  const summary = buildCanaryInputSummary(
    {
      nextStep: {
        route: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          srcChain: "bob",
          dstChain: "base",
          tradeReadiness: "insufficient_data",
        },
        reasons: ["insufficient_data"],
      },
      scoreSnapshot: {
        generatedAt: "2026-04-11T12:00:00.000Z",
        scores: [
          {
            routeKey: "bob:0x0555->base:0x0555",
            amount: "10000",
            tradeReadiness: "insufficient_data",
            executionGasSource: "eth_estimateGas",
            dataGaps: ["stale_dex_output_quote"],
          },
        ],
      },
      quotes: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          observedAt: "2026-04-11T11:20:00.000Z",
        },
      ],
      gasEstimateSnapshots: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          observedAt: "2026-04-11T11:50:00.000Z",
        },
      ],
      gasSnapshots: [
        {
          chain: "bob",
          observedAt: "2026-04-11T11:10:00.000Z",
        },
      ],
      dexQuotes: [
        {
          source: "gateway_dst_leg",
          gatewayRouteKey: "bob:0x0555->base:0x0555",
          gatewayAmount: "10000",
          observedAt: "2026-04-11T11:15:00.000Z",
        },
      ],
      bitcoinFeeSnapshots: [],
      priceSnapshots: [
        {
          observedAt: "2026-04-11T11:54:00.000Z",
          btcUsd: 80_000,
          tokenByKey: { btc: 80_000, wbtc: 80_000, ethereum: 3_000, usd_stable: 1 },
          nativeByChain: { bob: 3_000, base: 3_000, ethereum: 3_000 },
        },
      ],
    },
    { now: "2026-04-11T12:00:00.000Z" },
  );

  assert.equal(summary.routeLabel, "bob->base wBTC.OFT->wBTC.OFT");
  assert.equal(summary.gatewayQuote.state, "stale");
  assert.equal(summary.exactGas.state, "fresh");
  assert.equal(summary.srcGas.state, "stale");
  assert.equal(summary.dexQuote.state, "stale");
  assert.equal(summary.bitcoinFee.state, "not_needed");
  assert.equal(summary.marketSnapshot.state, "stale");
  assert.deepEqual(summary.scoreDataGaps, ["stale_dex_output_quote"]);
});

test("canary progress summary bundles current input blockers with last advance stage", () => {
  const progress = buildCanaryProgressSummary({
    inputSummary: {
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
      scoreTradeReadiness: "reject_no_net_edge",
      scoreDataGaps: ["stale_dex_output_quote"],
      blockers: ["reject_no_net_edge"],
      gatewayQuote: { state: "fresh", observedAt: "2026-04-11T11:58:00.000Z", ageMinutes: 2 },
      exactGas: { state: "fresh", observedAt: "2026-04-11T11:57:00.000Z", ageMinutes: 3 },
      srcGas: { state: "fresh", observedAt: "2026-04-11T11:56:00.000Z", ageMinutes: 4 },
      dexQuote: { state: "stale", observedAt: "2026-04-11T11:10:00.000Z", ageMinutes: 50 },
      bitcoinFee: { state: "not_needed", observedAt: null, ageMinutes: null },
      marketSnapshot: { state: "stale", observedAt: "2026-04-11T11:20:00.000Z", ageMinutes: 40 },
    },
    shadowCycle: {
      canary: {
        decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        reasons: ["reject_no_net_edge"],
      },
      topRoute: {
        label: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
      },
    },
    advanceCanary: {
      observedAt: "2026-04-11T11:30:00.000Z",
      actions: ["check-estimator-wallet", "score-gateway", "status-dashboard"],
      initial: {
        decision: "RUN_EXACT_GAS",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
      },
      afterWalletCheck: {
        decision: "RERUN_SCORING",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
      },
      final: {
        decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        reasons: ["reject_no_net_edge"],
      },
    },
    now: "2026-04-11T12:00:00.000Z",
  });

  assert.equal(progress.currentRoute.routeKey, "bob:0x0555->base:0x0555");
  assert.equal(progress.currentRoute.tradeReadiness, "reject_no_net_edge");
  assert.deepEqual(progress.currentRoute.routeBlockers, ["reject_no_net_edge"]);
  assert.deepEqual(progress.currentRoute.blockingInputs.map((item) => item.key), ["dex_quote", "market"]);
  assert.equal(progress.lastAdvance.routeKey, "bob:0x0555->base:0x0555");
  assert.equal(progress.lastAdvance.finalDecision, "BLOCKED_NO_VIABLE_PREP_ROUTE");
  assert.deepEqual(progress.lastAdvance.finalReasons, ["reject_no_net_edge"]);
});

test("canary input summary marks structurally unsupported DEX coverage as blocked", () => {
  const summary = buildCanaryInputSummary(
    {
      nextStep: {
        route: {
          label: "avalanche->bera wBTC.OFT->wBTC.OFT",
          routeKey: "avalanche:0x0555->bera:0x0555",
          amount: "10000",
          srcChain: "avalanche",
          dstChain: "bera",
          tradeReadiness: "reject_no_net_edge",
        },
        reasons: ["reject_no_net_edge"],
      },
      scoreSnapshot: {
        generatedAt: "2026-04-11T12:00:00.000Z",
        scores: [
          {
            routeKey: "avalanche:0x0555->bera:0x0555",
            amount: "10000",
            tradeReadiness: "reject_no_net_edge",
            executionGasSource: "eth_estimateGas",
            dataGaps: ["missing_dex_output_quote"],
          },
        ],
      },
      quotes: [],
      gasEstimateSnapshots: [],
      gasSnapshots: [],
      dexQuotes: [],
      dexFailures: [
        {
          source: "gateway_dst_leg",
          gatewayRouteKey: "avalanche:0x0555->bera:0x0555",
          gatewayAmount: "10000",
          reason: "no_supported_router_for_chain:80094",
          observedAt: "2026-04-11T11:58:00.000Z",
        },
        {
          source: "gateway_src_entry_leg",
          gatewayRouteKey: "avalanche:0x0555->bera:0x0555",
          gatewayAmount: "10000",
          reason: "odos_quote_failed",
          observedAt: "2026-04-11T11:59:00.000Z",
        },
      ],
      bitcoinFeeSnapshots: [],
      priceSnapshots: [],
    },
    { now: "2026-04-11T12:00:00.000Z" },
  );

  assert.equal(summary.dexQuote.state, "blocked");
  assert.equal(summary.dexQuote.failureReason, "no_supported_router_for_chain:80094");
  assert.deepEqual(summary.dexQuote.failureReasons, ["odos_quote_failed", "no_supported_router_for_chain:80094"]);
});

test("canary input summary preserves fresh exact-gas failure evidence", () => {
  const summary = buildCanaryInputSummary(
    {
      nextStep: {
        route: {
          label: "avalanche->ethereum wBTC.OFT->WBTC",
          routeKey: "avalanche:0x0555->ethereum:0x2260",
          amount: "10000",
          srcChain: "avalanche",
          dstChain: "ethereum",
          tradeReadiness: "insufficient_data",
        },
        reasons: ["token"],
      },
      scoreSnapshot: {
        generatedAt: "2026-04-11T12:00:00.000Z",
        scores: [
          {
            routeKey: "avalanche:0x0555->ethereum:0x2260",
            amount: "10000",
            tradeReadiness: "insufficient_data",
            executionGasSource: null,
            dataGaps: ["exact_src_execution_gas_not_estimated"],
          },
        ],
      },
      quotes: [],
      gasEstimateSnapshots: [],
      gasEstimateFailures: [
        {
          routeKey: "avalanche:0x0555->ethereum:0x2260",
          amount: "10000",
          observedAt: "2026-04-11T11:58:00.000Z",
          reason: "execution_reverted",
        },
      ],
      gasSnapshots: [],
      dexQuotes: [],
      bitcoinFeeSnapshots: [],
      priceSnapshots: [],
    },
    { now: "2026-04-11T12:00:00.000Z" },
  );

  assert.equal(summary.exactGas.state, "fresh");
  assert.equal(summary.exactGas.failureReason, "execution_reverted");
  assert.deepEqual(summary.exactGas.failureReasons, ["execution_reverted"]);
});

test("canary stage checklist shows completed and remaining stages conservatively", () => {
  const checklist = buildCanaryStageChecklist({
    route: {
      label: "bob->base wBTC.OFT->wBTC.OFT",
      txReady: true,
      exactGasDone: true,
      prepBlockers: [],
      readinessFailureReason: null,
    },
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      reasons: ["insufficient_data"],
    },
    inputSummary: {
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      gatewayQuote: { state: "stale" },
      exactGas: { state: "fresh" },
      srcGas: { state: "fresh" },
      dexQuote: { state: "stale" },
      bitcoinFee: { state: "not_needed" },
      marketSnapshot: { state: "stale" },
    },
    advanceCanary: {
      final: {
        decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      },
    },
  });

  assert.deepEqual(checklist.completed, [
    "top canary route selected",
    "tx payload captured",
    "wallet readiness cleared",
    "exact gas captured",
  ]);
  assert.deepEqual(checklist.remaining, [
    "refresh stale/missing inputs (gateway quote, DEX quote, market)",
    "clear objective blocker (insufficient_data)",
    "advance canary beyond BLOCKED_NO_VIABLE_PREP_ROUTE",
  ]);
});

test("execution stage summary separates manual canary review from live execution", () => {
  const summary = buildExecutionStageSummary({
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      reasons: ["reject_no_net_edge"],
    },
    dashboardStatus: {
      canaryInputs: {
        scoreTradeReadiness: "reject_no_net_edge",
        blockers: ["reject_no_net_edge"],
      },
      overall: {
        liveTrading: "BLOCKED",
        blockers: ["audit_blocks_live", "stale_gas_snapshots"],
      },
      audit: {
        decision: "LIVE_BLOCKED",
      },
    },
  });

  assert.equal(summary.reviewStage, "NOT_READY_FOR_MANUAL_CANARY_REVIEW");
  assert.deepEqual(summary.reviewReasons, ["reject_no_net_edge"]);
  assert.equal(summary.liveStage, "LIVE_EXECUTION_BLOCKED");
  assert.equal(summary.auditDecision, "LIVE_BLOCKED");
  assert.deepEqual(summary.liveReasons, ["audit_blocks_live", "stale_gas_snapshots"]);
});

test("canary stage checklist separates blocked inputs from refreshable inputs", () => {
  const checklist = buildCanaryStageChecklist({
    route: {
      label: "avalanche->bera wBTC.OFT->wBTC.OFT",
    },
    inputSummary: {
      routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
      gatewayQuote: { state: "fresh" },
      exactGas: { state: "fresh" },
      srcGas: { state: "fresh" },
      dexQuote: { state: "blocked", failureReason: "no_supported_router_for_chain:80094" },
      bitcoinFee: { state: "not_needed" },
      marketSnapshot: { state: "stale" },
    },
  });

  assert.deepEqual(checklist.remaining, [
    "refresh stale/missing inputs (market)",
    "resolve blocked inputs (DEX quote)",
  ]);
});
