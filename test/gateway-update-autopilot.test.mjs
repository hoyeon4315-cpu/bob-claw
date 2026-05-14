import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGatewayUpdateAutopilotRefreshPlan,
  summarizeGatewayUpdateAutopilotRuns,
} from "../src/strategy/gateway-update-autopilot.mjs";
import {
  filterOfficialGatewayRoutes,
  summarizeOfficialGatewayRouteSurface,
} from "../src/strategy/autonomous-discovery-board.mjs";

test("autonomous discovery route filter keeps official gateway chains only", () => {
  const routes = [
    { srcChain: "bitcoin", dstChain: "base", srcToken: "native", dstToken: "wbtc.oft" },
    { srcChain: "base", dstChain: "arbitrum", srcToken: "wbtc.oft", dstToken: "wbtc" },
    { srcChain: "polygon", dstChain: "bob", srcToken: "wbtc", dstToken: "wbtc.oft" },
  ];

  const filtered = filterOfficialGatewayRoutes(routes);
  const summary = summarizeOfficialGatewayRouteSurface(routes);

  assert.equal(filtered.length, 1);
  assert.deepEqual(summary.unsupportedChains.sort(), ["arbitrum", "polygon"]);
  assert.equal(summary.supportedRouteCount, 1);
  assert.equal(summary.ignoredRouteCount, 2);
});

test("gateway update autopilot refresh plan stays bounded and planning-only", () => {
  const plan = buildGatewayUpdateAutopilotRefreshPlan({
    watchResult: {
      updateDetected: true,
      changeReasons: ["route_inventory", "eth_family_surface"],
    },
  });

  assert.equal(plan.executionMode, "planning_only");
  assert.equal(plan.triggered, true);
  assert.deepEqual(
    plan.steps.map((step) => step.script),
    [
      "verify:gateway:asset-coverage",
      "report:gateway-gold-readiness",
      "scan:quote-surface",
      "scan:quote-surface",
      "report:autonomous-discovery-board",
      "report:strategy-snapshot",
    ],
  );
  assert.equal(
    plan.steps.every((step) => step.command.startsWith("npm run ")),
    true,
  );
});

test("gateway update autopilot summary retains latest planning-only pnl surface", () => {
  const summary = summarizeGatewayUpdateAutopilotRuns([
    {
      observedAt: "2026-04-26T10:00:00.000Z",
      mode: "execute",
      watch: {
        updateDetected: true,
        changeReasons: ["route_inventory"],
        routeHash: "route-hash-1",
        schemaHash: "schema-hash-1",
        probeHealthHash: "probe-hash-1",
      },
      supportedSurface: {
        supportedRouteCount: 12,
        ignoredRouteCount: 1,
        unsupportedChains: ["arbitrum"],
      },
      refresh: {
        executionStatus: "succeeded",
      },
      planningArtifacts: {
        autonomousDiscoveryBoard: {
          opportunityCount: 4,
          readyNowCount: 1,
          topOpportunity: { id: "wrapped_btc_loop" },
          nextAction: { code: "scan_btc_quote_surface" },
        },
        strategySnapshot: {
          topAction: { code: "review_destination_allocation_plan" },
        },
      },
      pnl: {
        paper: { btc: null, usdProjection: null, status: "board_priority_surface_only" },
        estimated: { btc: null, usdProjection: null, status: "route_measurement_required" },
        realized: { btc: null, usdProjection: null, status: "no_route_receipts" },
      },
    },
  ]);

  assert.equal(summary.executionMode, "planning_only");
  assert.equal(summary.successCount, 1);
  assert.equal(summary.latestSupportedSurface.ignoredRouteCount, 1);
  assert.equal(summary.latestAutonomousDiscoveryBoard.topOpportunity.id, "wrapped_btc_loop");
  assert.equal(summary.pnl.paper.status, "board_priority_surface_only");
});
