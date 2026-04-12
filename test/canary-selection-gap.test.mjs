import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanarySelectionGap } from "../src/strategy/canary-selection-gap.mjs";

test("canary selection gap explains why a measured leader is not the current canary", () => {
  const gap = buildCanarySelectionGap({
    routePlan: {
      topCandidates: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          viableForPrep: true,
          tradeReadiness: "reject_no_net_edge",
        },
      ],
      candidates: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          viableForPrep: true,
          txReady: true,
          exactGasDone: true,
          tradeReadiness: "reject_no_net_edge",
        },
        {
          routeKey: "ethereum:0x2260->base:0x0555",
          amount: "10000",
          label: "ethereum->base WBTC->wBTC.OFT",
          viableForPrep: false,
          txReady: true,
          exactGasDone: false,
          prepBlockers: ["wallet_not_checked"],
          scoreDisqualifiers: ["stale_src_gas_snapshot"],
          tradeReadiness: "insufficient_data",
        },
      ],
    },
    edgeViability: {
      closestLoop: {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        measuredLoopNetUsd: 64.76,
      },
    },
    canaryInputs: {
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      scoreTradeReadiness: "reject_no_net_edge",
    },
    scoreSnapshot: {
      scores: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.84,
          executableNetEdgeUsd: -0.83,
        },
        {
          routeKey: "ethereum:0x2260->base:0x0555",
          amount: "10000",
          tradeReadiness: "insufficient_data",
          netEdgeUsd: -1.01,
          executableNetEdgeUsd: 64.99,
          dataGaps: ["stale_src_gas_snapshot", "exact_src_execution_gas_not_estimated"],
        },
      ],
    },
  });

  assert.equal(gap.selectionCode, "prefer_viable_prep_route_over_measured_hypothesis");
  assert.equal(gap.currentCanary.label, "bob->base wBTC.OFT->wBTC.OFT");
  assert.equal(gap.measuredLeader.label, "ethereum->base WBTC->wBTC.OFT");
  assert.deepEqual(gap.reasons, [
    "current_canary_is_only_viable_prep_route",
    "measured_route_not_viable_for_prep",
    "measured_route_exact_gas_pending",
    "measured_route_wallet_checks_pending",
    "measured_route_insufficient_data",
    "measured_route_data_gaps",
  ]);
  assert.deepEqual(gap.blockers, [
    "wallet_not_checked",
    "stale_src_gas_snapshot",
    "exact_src_execution_gas_not_estimated",
  ]);
  assert.deepEqual(gap.reviewPlan.actionCodes, [
    "check_wallet_readiness",
    "refresh_exact_gas",
    "rerun_route_scoring",
    "refresh_public_status",
  ]);
  assert.match(gap.hypothesisGuard, /Positive measured edge is still a hypothesis/);
});

test("canary selection gap is omitted when measured leader already matches the canary", () => {
  const gap = buildCanarySelectionGap({
    edgeViability: {
      closestLoop: {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        measuredLoopNetUsd: -0.83,
      },
    },
    canaryInputs: {
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
    },
  });

  assert.equal(gap, null);
});
