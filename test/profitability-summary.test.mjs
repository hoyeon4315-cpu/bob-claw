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
  });

  assert.equal(summary.measuredClosedLoopCount, 49);
  assert.equal(summary.profitableClosedLoopCount, 0);
  assert.equal(summary.verdictCode, "measured_no_edge");
  assert.equal(summary.canaryTradeReadiness, "reject_no_net_edge");
  assert.equal(summary.bestStablecoinRoute.routeKey, "base:0x8335->bitcoin:0x0000");
  assert.equal(summary.durableNoEdgeRouteCount, 10);
});
