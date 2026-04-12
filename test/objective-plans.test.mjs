import assert from "node:assert/strict";
import { test } from "node:test";
import { buildObjectivePlans } from "../src/strategy/objective-plans.mjs";

test("objective plans build execution review and discovery candidates from measured routes", () => {
  const plans = buildObjectivePlans({
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
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
          srcChain: "bob",
          dstChain: "base",
          srcAsset: { ticker: "wBTC.OFT" },
          dstAsset: { ticker: "wBTC.OFT" },
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.84,
          executableNetEdgeUsd: -0.83,
        },
        {
          routeKey: "ethereum:0x2260->base:0x0555",
          amount: "10000",
          srcChain: "ethereum",
          dstChain: "base",
          srcAsset: { ticker: "WBTC" },
          dstAsset: { ticker: "wBTC.OFT" },
          tradeReadiness: "insufficient_data",
          netEdgeUsd: -1.01,
          executableNetEdgeUsd: 64.99,
          dataGaps: ["stale_src_gas_snapshot", "exact_src_execution_gas_not_estimated"],
        },
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "25000",
          srcChain: "base",
          dstChain: "unichain",
          srcAsset: { ticker: "wBTC.OFT" },
          dstAsset: { ticker: "wBTC.OFT" },
          tradeReadiness: "shadow_candidate_review_only",
          netEdgeUsd: 1.1,
          executableNetEdgeUsd: 1.2,
          dataGaps: [],
        },
      ],
    },
    edgeViability: {
      closestLoop: {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        measuredLoopNetUsd: 64.76,
        gapToPolicyUsd: 0,
        requiredNetProfitUsd: 0.3,
      },
      loops: [
        {
          routeKey: "ethereum:0x2260->base:0x0555",
          amount: "10000",
          measuredLoopNetUsd: 64.76,
          gapToPolicyUsd: 0,
          requiredNetProfitUsd: 0.3,
        },
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "25000",
          measuredLoopNetUsd: 0.72,
          gapToPolicyUsd: 0,
          requiredNetProfitUsd: 0.3,
        },
      ],
    },
    edgeResearch: {
      bestCandidate: {
        routeKey: "base:0x0555->unichain:0x0555",
        classification: "missing_decay_survival",
      },
      routes: [
        {
          routeKey: "base:0x0555->unichain:0x0555",
          classification: "missing_decay_survival",
          profitableLevels: 2,
          amountLevels: 2,
          bestNetEdgeUsd: 1.2,
        },
      ],
    },
  });

  assert.equal(plans.executionReview.status, "measured_hypothesis_under_review");
  assert.equal(plans.executionReview.routeKey, "ethereum:0x2260->base:0x0555");
  assert.equal(plans.executionReview.nextActionCode, "check_wallet_readiness");
  assert.match(plans.executionReview.command, /check:estimator-wallet/);
  assert.equal(plans.executionReview.stepCount >= 2, true);

  assert.equal(plans.discovery.source, "secondary_measured_loop");
  assert.equal(plans.discovery.routeKey, "base:0x0555->unichain:0x0555");
  assert.equal(plans.discovery.nextActionCode, "collect_decay_survival");
  assert.equal(plans.discovery.classification, "missing_decay_survival");
  assert.match(plans.discovery.command, /verify:gateway/);
  assert.match(plans.discovery.command, /quote:dex/);
  assert.match(plans.discovery.command, /score:gateway/);
});
