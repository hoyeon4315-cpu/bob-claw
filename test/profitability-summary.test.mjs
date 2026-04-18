import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProfitabilitySummary } from "../src/strategy/profitability-summary.mjs";

test("profitability summary condenses measured routes into a readable snapshot", () => {
  const summary = buildProfitabilitySummary({
    scoreSnapshot: {
      scores: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          netEdgeUsd: -0.85,
          executableNetEdgeUsd: -0.84,
          srcAsset: { family: "wrapped_btc" },
          dstAsset: { family: "wrapped_btc" },
        },
        {
          routeKey: "base:0x8335->bitcoin:0x0000",
          amount: "4022463",
          netEdgeUsd: -1.37,
          tradeReadiness: "insufficient_data",
          srcAsset: { family: "stablecoin" },
          dstAsset: { family: "btc" },
        },
      ],
    },
    dexRouteFocus: {
      loopObservableCount: 10,
      missingGatewayQuoteCount: 0,
    },
    dexGatewayArbitrage: {
      measuredNetLoopCount: 49,
      profitableExactCount: 0,
    },
    edgeViability: {
      verdict: { code: "measured_no_edge", label: "measured no-edge universe", detail: "below policy" },
      bestMeasuredLoop: {
        routeKey: "ethereum:0x2260->unichain:0x0555",
        amount: "10000",
        measuredLoopNetUsd: -0.49,
        gapToPolicyUsd: 0.79,
      },
      closestLoop: {
        routeKey: "base:0x0555->unichain:0x0555",
        amount: "10000",
        measuredLoopNetUsd: -0.59,
        gapToPolicyUsd: 0.89,
        requiredNetProfitUsd: 0.3,
      },
    },
    noEdgePersistence: {
      durableNoEdgeRouteCount: 10,
    },
    canaryInputs: {
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
      scoreTradeReadiness: "reject_no_net_edge",
    },
    routePlan: {
      topCandidates: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          viableForPrep: true,
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
        },
        {
          routeKey: "ethereum:0x2260->unichain:0x0555",
          amount: "10000",
          label: "ethereum->unichain WBTC->wBTC.OFT",
          viableForPrep: false,
          txReady: true,
          exactGasDone: false,
          prepBlockers: ["wallet_not_checked"],
          scoreDisqualifiers: ["stale_src_gas_snapshot"],
        },
      ],
    },
    ethAnalysis: {
      capability: {
        gatewayRouteCount: 3,
        ethFamilyRouteCount: 1,
      },
      scores: {
        policyBlockedCount: 1,
        bestOpenResearchRoute: {
          routeKey: "base:0x0->ethereum:0x0",
          tradeReadiness: "ethereum_l1_policy_override_disabled",
          executableNetEdgeUsd: -0.04,
        },
      },
      recommendation: {
        code: "collect_more_eth_evidence",
        label: "Collect more ETH evidence first",
        detail: "Sample breadth is still too thin.",
      },
      ethFamily: {
        overfit: {
          risks: ["thin_quote_samples"],
        },
        persistence: {
          stableRouteCount: 1,
        },
        routeUniverse: {
          fullyMeasurableRouteCount: 1,
        },
        routeFocus: {
          loopObservableCount: 1,
          bestRoute: {
            routeKey: "base:0x0->ethereum:0x0",
            classification: "loop_observable",
            bestTradeReadiness: "ethereum_l1_policy_override_disabled",
            bestExecutableNetEdgeUsd: -0.04,
            amountLevels: ["10000"],
            amountLevelCount: 1,
          },
        },
        gatewayArbitrage: {
          measuredNetLoopCount: 1,
          profitableExactCount: 0,
          closestLoop: {
            routeKey: "base:0x0->ethereum:0x0",
            amount: "10000",
            measuredLoopNetUsd: -0.12,
            gapToPolicyUsd: 0.42,
            requiredNetProfitUsd: 0.3,
            blockers: ["non_positive_loop_net_edge"],
          },
        },
        viability: {
          bestMeasuredLoop: {
            routeKey: "base:0x0->ethereum:0x0",
            amount: "10000",
            measuredLoopNetUsd: -0.12,
            gapToPolicyUsd: 0.42,
            requiredNetProfitUsd: 0.3,
            blockers: ["non_positive_loop_net_edge"],
          },
          closestLoop: {
            routeKey: "base:0x0->ethereum:0x0",
            amount: "10000",
            measuredLoopNetUsd: -0.12,
            gapToPolicyUsd: 0.42,
            requiredNetProfitUsd: 0.3,
            blockers: ["non_positive_loop_net_edge"],
          },
        },
        verdict: {
          code: "positive_but_below_policy",
          label: "positive but still below policy",
          detail: "Measured loops are still below the policy floor.",
        },
      },
    },
  });

  assert.equal(summary.measuredClosedLoopCount, 49);
  assert.equal(summary.profitableClosedLoopCount, 0);
  assert.equal(summary.verdictCode, "measured_no_edge");
  assert.equal(summary.canaryTradeReadiness, "reject_no_net_edge");
  assert.equal(summary.bestStablecoinRoute.routeKey, "base:0x8335->bitcoin:0x0000");
  assert.equal(summary.canarySelectionGap.measuredLeader.routeKey, "base:0x0555->unichain:0x0555");
  assert.deepEqual(summary.canarySelectionGap.reviewPlan.actionLabels, [
    "selective route scoring",
    "status dashboard refresh",
  ]);
  assert.equal(summary.canarySelectionGap.hypothesisGuard, null);
  assert.equal(summary.durableNoEdgeRouteCount, 10);
  assert.equal(summary.ethFamily.routeCount, 1);
  assert.equal(summary.ethFamily.gatewayRouteCount, 3);
  assert.equal(summary.ethFamily.measuredClosedLoopCount, 1);
  assert.equal(summary.ethFamily.verdictCode, "positive_but_below_policy");
  assert.equal(summary.ethFamily.recommendationCode, "collect_more_eth_evidence");
  assert.equal(summary.ethFamily.bestMeasuredRoute.routeKey, "base:0x0->ethereum:0x0");
  assert.equal(summary.ethFamily.followUpActionCode, "collect_eth_family_evidence");
  assert.match(summary.ethFamily.followUpCommand, /analyze:ethereum-routes/);
});
