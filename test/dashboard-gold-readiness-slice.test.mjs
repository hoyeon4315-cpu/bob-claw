import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardStatus } from "../src/status/dashboard-status.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const XAUT = "0x68749665FF8D2d112Fa859AA293F07A622782F38";

function baseInput() {
  return {
    routesRecords: [
      {
        observedAt: "2026-05-14T00:00:00.000Z",
        summary: { totalRoutes: 0 },
        routes: [],
      },
    ],
    quotes: [],
    failures: [],
    gasSnapshots: [],
    gasFailures: [],
    priceSnapshots: [],
    updateSnapshots: [],
    updateAlerts: [],
  };
}

test("dashboard gateway gold readiness exposes explicit route-missing blocker by default", () => {
  const status = buildDashboardStatus(baseInput(), { now: "2026-05-14T00:10:00.000Z" });
  const gold = status.gateway.goldRouteReadiness;
  assert.equal(gold.routeAvailable, false);
  assert.equal(gold.blocker, "route_not_available_yet");
  assert.equal(gold.liveEligible, false);
});

test("dashboard gateway gold readiness includes XAUT quote preflight blocker fields", () => {
  const input = baseInput();
  input.routesRecords[0].summary.totalRoutes = 2;
  input.routesRecords[0].routes = [
    { srcChain: "bitcoin", dstChain: "ethereum", srcToken: ZERO, dstToken: XAUT },
    { srcChain: "ethereum", dstChain: "bitcoin", srcToken: XAUT, dstToken: ZERO },
  ];
  input.gatewayGoldReadiness = {
    observedAt: "2026-05-14T00:09:00.000Z",
    routeAvailable: true,
    bestGoldAsset: "XAUT",
    blocker: "gateway_gold_exit_quote_preflight_failed",
    blockers: ["gateway_gold_exit_quote_preflight_failed"],
    quoteObservedAt: null,
    roundTripCostBtc: null,
    roundTripCostUsd: null,
    slippageBps: null,
    minViableCanarySizeSats: null,
    liveEligible: false,
    preflight: {
      attempted: true,
      successfulAttemptCount: 0,
      attempts: [{ assetTicker: "XAUT", status: "exit_quote_failed" }],
    },
  };

  const status = buildDashboardStatus(input, { now: "2026-05-14T00:10:00.000Z" });
  const gold = status.gateway.goldRouteReadiness;
  assert.equal(gold.routeAvailable, true);
  assert.equal(gold.bestGoldAsset, "XAUT");
  assert.equal(gold.blocker, "gateway_gold_exit_quote_preflight_failed");
  assert.equal(gold.liveEligible, false);
  assert.equal(gold.preflight.attempts[0].status, "exit_quote_failed");
});
