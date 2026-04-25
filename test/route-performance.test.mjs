import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDefaultRoutePerformancePolicy, buildRoutePerformanceRanking } from "../src/risk/route-performance.mjs";

function receipt({
  routeKey,
  amount = "10000",
  status = "reconciled",
  pnl = 0.5,
  estimatedNetPnlUsd = 0.5,
  estimatedOutputUsd = 10.5,
  actualOutputUsd = 10.55,
  estimatedExecutionGasUsd = 0.1,
  receiptGasUsd = 0.11,
  gasDriftUsd = 0.01,
  fillDriftBps = 10,
  estimatedPositiveRealizedNegative = false,
  observedAt,
}) {
  return {
    observedAt,
    reconciliationStatus: status,
    routeContext: {
      routeKey,
      amount,
      srcChain: "bob",
      dstChain: "base",
      estimatedNetPnlUsd,
      estimatedOutputUsd,
      estimatedExecutionGasUsd,
    },
    output: {
      actualOutputUsd: status === "reconciled" ? actualOutputUsd : null,
    },
    realized: {
      realizedNetPnlUsd: pnl,
      realizedFillVsEstimateBps: fillDriftBps,
      receiptGasUsd,
      gasDriftUsd,
    },
    flags: {
      estimatedPositiveButRealizedNegative: estimatedPositiveRealizedNegative,
    },
  };
}

function quote({ routeKey, amount = "10000", latencyMs = 500 }) {
  return {
    observedAt: "2026-04-11T01:00:00.000Z",
    routeKey,
    amount,
    latencyMs,
  };
}

function failure({ routeKey, amount = "10000" }) {
  return {
    observedAt: "2026-04-11T01:05:00.000Z",
    routeKey,
    amount,
  };
}

function score({
  routeKey,
  amount = "10000",
  tradeReadiness = "shadow_candidate_review_only",
  netEdgeUsd = 0.5,
  executableNetEdgeUsd = netEdgeUsd,
  effectiveSystemNetPnlUsd = null,
}) {
  return {
    observedAt: "2026-04-11T01:10:00.000Z",
    routeKey,
    amount,
    srcChain: "bob",
    dstChain: "base",
    tradeReadiness,
    netEdgeUsd,
    executableNetEdgeUsd,
    effectiveSystemNetPnlUsd,
    knownCostUsd: 0.2,
  };
}

test("route performance enables review-only routes with positive realized expectancy", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [
      receipt({ routeKey: "bob:0x1->base:0x1", pnl: 0.6, observedAt: "2026-04-11T02:00:00.000Z" }),
      receipt({ routeKey: "bob:0x1->base:0x1", pnl: 0.4, observedAt: "2026-04-11T03:00:00.000Z" }),
      receipt({ routeKey: "bob:0x1->base:0x1", pnl: 0.5, observedAt: "2026-04-11T04:00:00.000Z" }),
    ],
    quotes: [
      quote({ routeKey: "bob:0x1->base:0x1", latencyMs: 400 }),
      quote({ routeKey: "bob:0x1->base:0x1", latencyMs: 600 }),
      quote({ routeKey: "bob:0x1->base:0x1", latencyMs: 700 }),
    ],
    quoteFailures: [],
    scores: [score({ routeKey: "bob:0x1->base:0x1" })],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  assert.equal(ranking.summary.enabledCount, 1);
  assert.equal(ranking.routes[0].enabledState, "enabled_review_only");
  assert.equal(ranking.routes[0].realizedMedianPnlUsd, 0.5);
  assert.equal(ranking.routes[0].quoteSuccessRate, 1);
});

test("route performance disables routes with insufficient realized samples", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [receipt({ routeKey: "bob:0x2->base:0x2", pnl: 0.4, observedAt: "2026-04-11T02:00:00.000Z" })],
    quotes: [quote({ routeKey: "bob:0x2->base:0x2" })],
    quoteFailures: [],
    scores: [score({ routeKey: "bob:0x2->base:0x2" })],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  assert.equal(ranking.routes[0].enabledState, "disabled_insufficient_realized_samples");
  assert.equal(ranking.routes[0].rejectionReasons.includes("insufficient_realized_samples"), true);
});

test("route performance surfaces receipt-estimated versus realized deltas", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [
      receipt({
        routeKey: "bob:0x2a->base:0x2a",
        pnl: 0.3,
        estimatedNetPnlUsd: 0.6,
        estimatedOutputUsd: 10.8,
        actualOutputUsd: 10.55,
        estimatedExecutionGasUsd: 0.1,
        receiptGasUsd: 0.12,
        gasDriftUsd: 0.02,
        observedAt: "2026-04-11T02:00:00.000Z",
      }),
      receipt({
        routeKey: "bob:0x2a->base:0x2a",
        pnl: 0.35,
        estimatedNetPnlUsd: 0.65,
        estimatedOutputUsd: 10.85,
        actualOutputUsd: 10.6,
        estimatedExecutionGasUsd: 0.1,
        receiptGasUsd: 0.13,
        gasDriftUsd: 0.03,
        observedAt: "2026-04-11T03:00:00.000Z",
      }),
      receipt({
        routeKey: "bob:0x2a->base:0x2a",
        pnl: 0.4,
        estimatedNetPnlUsd: 0.7,
        estimatedOutputUsd: 10.9,
        actualOutputUsd: 10.65,
        estimatedExecutionGasUsd: 0.1,
        receiptGasUsd: 0.14,
        gasDriftUsd: 0.04,
        observedAt: "2026-04-11T04:00:00.000Z",
      }),
    ],
    quotes: [quote({ routeKey: "bob:0x2a->base:0x2a", latencyMs: 400 })],
    quoteFailures: [],
    scores: [
      score({
        routeKey: "bob:0x2a->base:0x2a",
        netEdgeUsd: 0.75,
        executableNetEdgeUsd: 0.7,
        effectiveSystemNetPnlUsd: 0.5,
      }),
    ],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  const route = ranking.routes[0];
  assert.equal(route.currentEffectiveSystemNetPnlUsd, 0.5);
  assert.equal(route.receiptEstimatedSampleCount, 3);
  assert.equal(route.receiptEstimatedMedianNetPnlUsd, 0.65);
  assert.equal(route.receiptEstimatedTotalNetPnlUsd, 1.95);
  assert.equal(route.medianNetDriftUsd, -0.3);
  assert.equal(route.totalNetDriftUsd, -0.9);
  assert.equal(route.receiptEstimatedMedianOutputUsd, 10.85);
  assert.equal(route.realizedMedianOutputUsd, 10.6);
  assert.equal(route.medianOutputDriftUsd, -0.25);
  assert.equal(route.receiptEstimatedMedianExecutionGasUsd, 0.1);
  assert.equal(route.realizedMedianExecutionGasUsd, 0.13);
  assert.equal(route.medianGasDriftUsd, 0.03);
  assert.equal(route.totalGasDriftUsd, 0.09);
  assert.equal(ranking.summary.receiptComparableRouteCount, 1);
  assert.equal(ranking.summary.negativeMedianNetDriftRouteCount, 1);
});

test("route performance disables routes with negative expectancy or high quote failures", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [
      receipt({ routeKey: "bob:0x3->base:0x3", pnl: -0.4, observedAt: "2026-04-11T02:00:00.000Z" }),
      receipt({ routeKey: "bob:0x3->base:0x3", pnl: -0.3, observedAt: "2026-04-11T03:00:00.000Z" }),
      receipt({ routeKey: "bob:0x3->base:0x3", pnl: -0.2, observedAt: "2026-04-11T04:00:00.000Z" }),
    ],
    quotes: [quote({ routeKey: "bob:0x3->base:0x3" })],
    quoteFailures: [failure({ routeKey: "bob:0x3->base:0x3" })],
    scores: [score({ routeKey: "bob:0x3->base:0x3", tradeReadiness: "reject_no_net_edge", netEdgeUsd: -0.5 })],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  assert.equal(ranking.routes[0].enabledState, "disabled_negative_realized_expectancy");
  assert.equal(ranking.routes[0].rejectionReasons.includes("negative_realized_median"), true);
  assert.equal(ranking.routes[0].rejectionReasons.includes("quote_failure_rate_too_high"), true);
  assert.equal(ranking.routes[0].rejectionReasons.includes("current_route_not_tradeable"), true);
});

test("route performance ignores treasury refill receipts without route context", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [
      {
        observedAt: "2026-04-11T02:00:00.000Z",
        reconciliationStatus: "pending_output",
        routeContext: null,
        realized: { realizedNetPnlUsd: null },
      },
    ],
    quotes: [],
    quoteFailures: [],
    scores: [],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  assert.equal(ranking.summary.routeVariantCount, 0);
});

test("route performance attaches canary progress to the current top route and last advance route", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [],
    quotes: [quote({ routeKey: "bob:0x4->base:0x4" })],
    quoteFailures: [],
    scores: [score({ routeKey: "bob:0x4->base:0x4", tradeReadiness: "reject_no_net_edge", netEdgeUsd: -0.2 })],
    canaryProgress: {
      currentRoute: {
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x4->base:0x4",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
        routeBlockers: ["reject_no_net_edge"],
        scoreDataGaps: ["stale_dex_output_quote"],
        blockingInputs: [{ key: "market", state: "stale", ageMinutes: 40, observedAt: "2026-04-11T01:20:00.000Z" }],
        inputStates: {
          market: { state: "stale", ageMinutes: 40, observedAt: "2026-04-11T01:20:00.000Z" },
        },
      },
      lastAdvance: {
        observedAt: "2026-04-11T01:30:00.000Z",
        ageMinutes: 30,
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x4->base:0x4",
        amount: "10000",
        initialDecision: "RUN_EXACT_GAS",
        afterWalletCheckDecision: "RERUN_SCORING",
        finalDecision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
        finalReasons: ["reject_no_net_edge"],
        actionCount: 3,
        actions: ["check-estimator-wallet", "score-gateway", "status-dashboard"],
      },
    },
    policy: buildDefaultRoutePerformancePolicy(),
  });

  assert.equal(ranking.summary.canaryProgress.currentRoute.routeKey, "bob:0x4->base:0x4");
  assert.equal(ranking.routes[0].canaryContext.isCurrentTopRoute, true);
  assert.equal(ranking.routes[0].canaryContext.isLastAdvanceRoute, true);
  assert.deepEqual(ranking.routes[0].canaryContext.currentRoute.blockingInputs.map((item) => item.key), ["market"]);
  assert.equal(ranking.routes[0].canaryContext.lastAdvance.finalDecision, "BLOCKED_NO_VIABLE_PREP_ROUTE");
});

test("route performance treats failed realized outcomes as part of expectancy metrics", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [
      receipt({ routeKey: "bob:0x5->base:0x5", status: "failed", pnl: -0.12, observedAt: "2026-04-11T02:00:00.000Z" }),
      receipt({ routeKey: "bob:0x5->base:0x5", status: "failed", pnl: -0.15, observedAt: "2026-04-11T03:00:00.000Z" }),
      receipt({ routeKey: "bob:0x5->base:0x5", status: "failed", pnl: -0.11, observedAt: "2026-04-11T04:00:00.000Z" }),
    ],
    quotes: [quote({ routeKey: "bob:0x5->base:0x5" })],
    quoteFailures: [],
    scores: [score({ routeKey: "bob:0x5->base:0x5" })],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  assert.equal(ranking.routes[0].realizedSampleCount, 3);
  assert.equal(ranking.routes[0].realizedOutcomeCount, 3);
  assert.equal(ranking.routes[0].enabledState, "disabled_negative_realized_expectancy");
  assert.equal(ranking.routes[0].rejectionReasons.includes("negative_realized_median"), true);
  assert.equal(ranking.routes[0].rejectionReasons.includes("low_realized_win_rate"), true);
  assert.equal(ranking.routes[0].rejectionReasons.includes("insufficient_realized_samples"), false);
});

test("route performance sorts disabled routes stably after enabled routes", () => {
  const ranking = buildRoutePerformanceRanking({
    receiptRecords: [receipt({ routeKey: "bob:0xa->base:0xa", pnl: 0.5, observedAt: "2026-04-11T02:00:00.000Z" })],
    quotes: [
      quote({ routeKey: "bob:0x6->base:0x6" }),
      quote({ routeKey: "bob:0x7->base:0x7" }),
      quote({ routeKey: "bob:0xa->base:0xa" }),
      quote({ routeKey: "bob:0xa->base:0xa", latencyMs: 600 }),
      quote({ routeKey: "bob:0xa->base:0xa", latencyMs: 700 }),
    ],
    quoteFailures: [],
    scores: [
      score({ routeKey: "bob:0x6->base:0x6" }),
      score({ routeKey: "bob:0x7->base:0x7" }),
      score({ routeKey: "bob:0xa->base:0xa" }),
    ],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  assert.deepEqual(
    ranking.routes.map((item) => item.routeKey),
    ["bob:0xa->base:0xa", "bob:0x6->base:0x6", "bob:0x7->base:0x7"],
  );
  assert.equal(ranking.routes[1].enabledState, "disabled_no_realized_data");
  assert.equal(ranking.routes[2].enabledState, "disabled_no_realized_data");
});
