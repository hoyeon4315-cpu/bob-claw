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
  const stable = report.strategies.find((strategy) => strategy.id === "stablecoin_entry_exit_loops");
  const btcFlash = report.strategies.find((strategy) => strategy.id === "triangular_flash_btc");

  assert.equal(gateway.capabilityBucket, "dry_run_or_shadow_only");
  assert.equal(gateway.selectedMode, "shadow");
  assert.equal(gateway.fallbackReason, "deterministic_closed_loop_executor_missing");
  assert.equal(stable.capabilityBucket, "missing_executor_adapter");
  assert.equal(stable.fallbackReason, "dedicated_entry_exit_loop_runner_missing");
  assert.equal(btcFlash.selectedMode, "dry_run");
  assert.equal(btcFlash.currentLiveEligible, false);
  assert.equal(report.summary.missingExecutorCount >= 2, true);
});
