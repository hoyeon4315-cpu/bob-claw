import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildDexRouteFocusSummary } from "../src/strategy/dex-route-focus.mjs";

test("dex route focus ranks fully measurable routes by how close they are to observable loops", () => {
  const routeKey = `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:${WBTC_OFT_TOKEN}`;
  const partialRouteKey = `ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->unichain:${WBTC_OFT_TOKEN}`;
  const missingRouteKey = `base:${WBTC_OFT_TOKEN}->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599`;
  const summary = buildDexRouteFocusSummary({
    routes: [
      { srcChain: "ethereum", dstChain: "base", srcToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", dstToken: WBTC_OFT_TOKEN },
      { srcChain: "ethereum", dstChain: "unichain", srcToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", dstToken: WBTC_OFT_TOKEN },
      { srcChain: "base", dstChain: "ethereum", srcToken: WBTC_OFT_TOKEN, dstToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
    ],
    quotes: [
      { routeKey, amount: "10000" },
      { routeKey, amount: "25000" },
      { routeKey: partialRouteKey, amount: "10000" },
    ],
    scoreSnapshot: {
      scores: [
        { routeKey, amount: "10000", netEdgeUsd: -0.3, executableNetEdgeUsd: -0.1, tradeReadiness: "reject_no_net_edge" },
        { routeKey, amount: "25000", netEdgeUsd: 0.1, executableNetEdgeUsd: 0.05, tradeReadiness: "reject_below_min_profit" },
        { routeKey: partialRouteKey, amount: "10000", netEdgeUsd: -0.4, executableNetEdgeUsd: null, tradeReadiness: "insufficient_data" },
      ],
    },
    dexQuotes: [
      { gatewayRouteKey: routeKey, source: "gateway_src_entry_leg" },
      { gatewayRouteKey: routeKey, source: "gateway_dst_leg" },
      { gatewayRouteKey: partialRouteKey, source: "gateway_src_entry_leg" },
    ],
  });

  assert.equal(summary.fullyMeasurableRouteCount, 3);
  assert.equal(summary.loopObservableCount, 1);
  assert.equal(summary.partialLoopMeasurementCount, 1);
  assert.equal(summary.missingGatewayQuoteCount, 1);
  assert.equal(summary.bestRoute.routeKey, routeKey);
  assert.equal(summary.bestRoute.classification, "loop_observable");
  assert.equal(summary.routes[1].routeKey, partialRouteKey);
  assert.equal(summary.routes[2].routeKey, missingRouteKey);
});
