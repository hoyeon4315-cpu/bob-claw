import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDefaultRoutePerformancePolicy, buildRoutePerformanceRanking } from "../src/risk/route-performance.mjs";

function receipt({ routeKey, amount = "10000", status = "reconciled", pnl = 0.5, observedAt }) {
  return {
    observedAt,
    reconciliationStatus: status,
    routeContext: {
      routeKey,
      amount,
      srcChain: "bob",
      dstChain: "base",
    },
    realized: {
      realizedNetPnlUsd: pnl,
      realizedFillVsEstimateBps: 10,
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

function score({ routeKey, amount = "10000", tradeReadiness = "shadow_candidate_review_only", netEdgeUsd = 0.5 }) {
  return {
    observedAt: "2026-04-11T01:10:00.000Z",
    routeKey,
    amount,
    srcChain: "bob",
    dstChain: "base",
    tradeReadiness,
    netEdgeUsd,
    executableNetEdgeUsd: netEdgeUsd,
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
