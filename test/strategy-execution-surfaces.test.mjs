import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyExecutionSurfaces } from "../src/strategy/strategy-execution-surfaces.mjs";

function dashboardStatusFixture() {
  return {
    generatedAt: "2026-04-16T03:00:00.000Z",
    overall: {
      liveTrading: "BLOCKED",
    },
    strategy: {
      edgeViability: {
        verdict: { code: "coverage_still_incomplete" },
        measuredNetLoopCount: 0,
        profitableExactCount: 0,
      },
      btcProxySpreads: {
        opportunityCount: 2,
        policyReadyCount: 0,
        overfitAssessment: "coverage_ok",
        bestRebalanceOpportunity: { proxyTicker: "LBTC" },
      },
      crossAssetArbitrage: {
        entryCount: 1,
        exitCount: 1,
        exactAssetPairCount: 0,
        profitableClosedLoopCount: 0,
        bestLoop: null,
        closestLoop: { blockers: ["amount_mismatch"] },
      },
      ethProfitability: {
        gatewayRouteCount: 3,
        routeCount: 3,
        measuredClosedLoopCount: 0,
        profitableClosedLoopCount: 0,
        recommendationCode: "no_multichain_eth_family_surface",
        verdictCode: "no_measured_loops",
      },
      strategyTracks: {
        tracks: [
          { kind: "stable_loop", status: "blocked_loop", reason: "amount_mismatch" },
          { kind: "proxy_spread", status: "blocked_spread", reason: "edge_inside_noise_floor" },
          { kind: "eth_family_loop", status: "unobserved", reason: "no_multichain_eth_family_surface" },
        ],
      },
    },
  };
}

test("execution surfaces classify missing runners separately from runnable observation lanes", () => {
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus: dashboardStatusFixture(),
    state: { scoreSnapshot: { scores: [] } },
    triangleArtifacts: {},
  });

  const gateway = report.strategies.find((strategy) => strategy.id === "gateway_wrapped_btc_loops");
  const proxy = report.strategies.find((strategy) => strategy.id === "btc_proxy_spreads");
  const stable = report.strategies.find((strategy) => strategy.id === "stablecoin_entry_exit_loops");
  const ethGateway = report.strategies.find((strategy) => strategy.id === "eth_family_gateway");
  const ethMixedStable = report.strategies.find((strategy) => strategy.id === "eth_mixed_stable_loops");
  const btcFlash = report.strategies.find((strategy) => strategy.id === "triangular_flash_btc");

  assert.equal(gateway.capabilityBucket, "dry_run_or_shadow_only");
   assert.equal(gateway.liveCapable, true);
  assert.equal(gateway.selectedMode, "shadow");
  assert.equal(gateway.fallbackReason, "route_specific_executor_inputs_required");
  assert.equal(proxy.liveCapable, true);
  assert.equal(proxy.selectedMode, "shadow");
  assert.equal(proxy.fallbackReason, "route_specific_executor_inputs_required");
  assert.equal(ethGateway.liveCapable, true);
  assert.equal(ethGateway.selectedMode, "shadow");
  assert.equal(ethGateway.fallbackReason, "multichain_eth_surface_unconfirmed");
  assert.equal(ethGateway.selectedCommands.some((command) => command.script === "executor:gateway-btc-onramp"), true);
  assert.equal(ethGateway.selectedCommands.some((command) => command.script === "executor:gateway-btc-offramp"), true);
  assert.equal(stable.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(stable.fallbackReason, "analysis_probe_only");
  assert.equal(stable.selectedCommands.some((command) => command.script === "report:lane-reclassification"), true);
  assert.equal(ethMixedStable.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(ethMixedStable.selectedCommands.some((command) => command.script === "analyze:ethereum-routes"), true);
  assert.equal(btcFlash.selectedMode, "dry_run");
  assert.equal(btcFlash.currentLiveEligible, false);
  assert.equal(report.summary.missingExecutorCount, 0);
});
