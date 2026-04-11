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

test("quote-dex candidate selection prioritizes supported chain coverage before duplicate route amounts", () => {
  const avalancheBob = { srcChain: "avalanche", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const ethereumBob = { srcChain: "ethereum", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const bscBob = { srcChain: "bsc", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const baseBob = { srcChain: "base", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const quotes = [
    quote(baseBob, "2026-04-11T00:04:00.000Z", "10000", "10000", "9990"),
    quote(baseBob, "2026-04-11T00:03:00.000Z", "25000", "25000", "24990"),
    quote(ethereumBob, "2026-04-11T00:02:00.000Z", "10000", "10000", "9991"),
    quote(bscBob, "2026-04-11T00:01:00.000Z", "10000", "10000", "9989"),
    quote(avalancheBob, "2026-04-11T00:00:00.000Z", "10000", "10000", "9988"),
  ];

  const legs = selectCandidateLegs(quotes, { routeLimit: 4 });

  assert.deepEqual(legs.map((item) => item.chain), ["base", "ethereum", "bsc", "avalanche"]);
});

test("quote-dex candidate selection drops zero-amount destination legs", () => {
  const bobBase = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const legs = selectCandidateLegs([
    quote(bobBase, "2026-04-11T00:00:00.000Z", "10000", "10000", "0"),
  ], { routeLimit: 4 });

  assert.deepEqual(legs.map((item) => `${item.source}:${item.chain}:${item.amount}`), [
    "gateway_src_leg:bob:10000",
  ]);
});

test("quote-dex can include stable entry legs for wrapped BTC routes when score input usd is known", () => {
  const baseBob = { srcChain: "base", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const legs = selectCandidateLegs([
    quote(baseBob, "2026-04-11T00:00:00.000Z", "10000", "10000", "9990"),
  ], {
    includeStableEntry: true,
    routeLimit: 8,
    scoreSnapshot: {
      scores: [
        {
          routeKey: `${baseBob.srcChain}:${baseBob.srcToken}->${baseBob.dstChain}:${baseBob.dstToken}`,
          amount: "10000",
          inputUsd: 7.25,
        },
      ],
    },
  });

  assert.equal(legs.some((item) => item.source === "gateway_src_entry_leg"), true);
  const entry = legs.find((item) => item.source === "gateway_src_entry_leg");
  assert.equal(entry.chain, "base");
  assert.equal(entry.inputToken, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(entry.outputToken, WBTC_OFT);
  assert.equal(entry.targetTokenAmount, "10000");
});
