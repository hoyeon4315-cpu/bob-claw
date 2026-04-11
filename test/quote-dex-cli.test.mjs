import assert from "node:assert/strict";
import { test } from "node:test";
import { selectCandidateLegs } from "../src/cli/quote-dex.mjs";

const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

function quote(route, observedAt, amount, inputAmount, outputAmount) {
  return {
    observedAt,
    route,
    routeKey: `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`,
    amount,
    inputAmount,
    outputAmount,
  };
}

test("quote-dex candidate selection can narrow to a specific route and amount", () => {
  const routeA = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const routeB = { srcChain: "ethereum", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const quotes = [
    quote(routeA, "2026-04-11T00:00:00.000Z", "10000", "10000", "9990"),
    quote(routeA, "2026-04-11T00:01:00.000Z", "25000", "25000", "24900"),
    quote(routeB, "2026-04-11T00:02:00.000Z", "10000", "10000", "10010"),
  ];

  const legs = selectCandidateLegs(quotes, {
    routeKey: quotes[0].routeKey,
    amount: "10000",
    chains: ["base"],
  });

  assert.equal(legs.length, 1);
  assert.equal(legs[0].gatewayRouteKey, quotes[0].routeKey);
  assert.equal(legs[0].gatewayAmount, "10000");
  assert.equal(legs[0].chain, "base");
});
