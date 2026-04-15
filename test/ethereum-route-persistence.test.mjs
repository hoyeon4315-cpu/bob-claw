import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEthereumRoutePersistenceSummary } from "../src/strategy/ethereum-route-persistence.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";

function route(srcChain, dstChain) {
  return { srcChain, dstChain, srcToken: ZERO, dstToken: ZERO };
}

function routeKey(value) {
  return `${value.srcChain}:${value.srcToken}->${value.dstChain}:${value.dstToken}`;
}

test("ethereum route persistence distinguishes stable, emerging, and fading ETH-family routes", () => {
  const stableRoute = route("base", "ethereum");
  const fadingRoute = route("base", "bob");
  const emergingRoute = route("bob", "unichain");
  const summary = buildEthereumRoutePersistenceSummary({
    routeRecords: [
      {
        observedAt: "2026-04-10T00:00:00.000Z",
        routes: [stableRoute],
      },
      {
        observedAt: "2026-04-11T00:00:00.000Z",
        routes: [stableRoute],
      },
      {
        observedAt: "2026-04-12T00:00:00.000Z",
        routes: [stableRoute, fadingRoute],
      },
      {
        observedAt: "2026-04-13T00:00:00.000Z",
        routes: [stableRoute, emergingRoute],
      },
    ],
    shadowObservations: [
      {
        observedAt: "2026-04-11T01:00:00.000Z",
        routeKey: routeKey(stableRoute),
        amount: "10000",
      },
      {
        observedAt: "2026-04-12T05:00:00.000Z",
        routeKey: routeKey(stableRoute),
        amount: "25000",
      },
      {
        observedAt: "2026-04-13T01:00:00.000Z",
        routeKey: routeKey(emergingRoute),
        amount: "10000",
      },
    ],
  });

  assert.equal(summary.snapshotCount, 4);
  assert.equal(summary.currentRouteCount, 2);
  assert.equal(summary.routesEverSeen, 3);
  assert.equal(summary.stableRouteCount, 1);
  assert.equal(summary.emergingRouteCount, 1);
  assert.equal(summary.fadingRouteCount, 1);
  assert.equal(summary.currentSampledRouteCount, 2);
  assert.equal(summary.stableSampledRouteCount, 1);
  assert.equal(summary.sampleSource, "shadow_observations");
  assert.equal(summary.maxAmountLevelsPerRoute, 2);
  assert.equal(summary.routes[0].routeKey, routeKey(stableRoute));
  assert.equal(summary.routes[0].persistence, "stable");
  const fadingResult = summary.routes.find((item) => item.routeKey === routeKey(fadingRoute));
  const emergingResult = summary.routes.find((item) => item.routeKey === routeKey(emergingRoute));
  assert.ok(fadingResult, `expected fading route ${routeKey(fadingRoute)} to be present`);
  assert.ok(emergingResult, `expected emerging route ${routeKey(emergingRoute)} to be present`);
  assert.equal(fadingResult.persistence, "fading");
  assert.equal(emergingResult.persistence, "emerging");
});
