import assert from "node:assert/strict";
import { test } from "node:test";
import { selectCandidateLegs } from "../src/cli/quote-dex.mjs";

const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const ZERO = "0x0000000000000000000000000000000000000000";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const BASE_OUSDT = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";
const ETHEREUM_XAUT = "0x68749665FF8D2d112Fa859AA293F07A622782F38";
const ETHEREUM_PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";

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

test("quote-dex direct route selection returns both legs for the latest matching quote", () => {
  const routeA = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const quotes = [
    quote(routeA, "2026-04-11T00:00:00.000Z", "10000", "10000", "9990"),
    quote(routeA, "2026-04-11T00:02:00.000Z", "10000", "10000", "9980"),
  ];

  const legs = selectCandidateLegs(quotes, {
    routeKey: quotes[0].routeKey,
    amount: "10000",
  });

  assert.deepEqual(
    legs.map((item) => `${item.source}:${item.chain}:${item.amount}`),
    ["gateway_src_leg:bob:10000", "gateway_dst_leg:base:9980"],
  );
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

  assert.deepEqual(
    legs.map((item) => item.chain),
    ["base", "ethereum", "bsc", "avalanche"],
  );
});

test("quote-dex candidate selection drops zero-amount destination legs", () => {
  const bobBase = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const legs = selectCandidateLegs([quote(bobBase, "2026-04-11T00:00:00.000Z", "10000", "10000", "0")], {
    routeLimit: 4,
  });

  assert.deepEqual(
    legs.map((item) => `${item.source}:${item.chain}:${item.amount}`),
    ["gateway_src_leg:bob:10000"],
  );
});

test("quote-dex can include stable entry legs for wrapped BTC routes when score input usd is known", () => {
  const baseBob = { srcChain: "base", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const legs = selectCandidateLegs([quote(baseBob, "2026-04-11T00:00:00.000Z", "10000", "10000", "9990")], {
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

  assert.equal(
    legs.some((item) => item.source === "gateway_src_entry_leg"),
    true,
  );
  const entry = legs.find((item) => item.source === "gateway_src_entry_leg");
  assert.equal(entry.chain, "base");
  assert.equal(entry.inputToken, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(entry.outputToken, WBTC_OFT);
  assert.equal(entry.targetTokenAmount, "10000");
});

test("quote-dex includes stable entry leg for tokenized-gold (XAUT) source on EVM chain", () => {
  const xautBtc = { srcChain: "ethereum", dstChain: "bitcoin", srcToken: ETHEREUM_XAUT, dstToken: ZERO };
  const legs = selectCandidateLegs([quote(xautBtc, "2026-05-20T00:00:00.000Z", "10000", "10000", "9990")], {
    includeStableEntry: true,
    routeLimit: 8,
    scoreSnapshot: {
      scores: [
        {
          routeKey: `${xautBtc.srcChain}:${xautBtc.srcToken}->${xautBtc.dstChain}:${xautBtc.dstToken}`,
          amount: "10000",
          inputUsd: 26.4,
        },
      ],
    },
  });

  const entry = legs.find((item) => item.source === "gateway_src_entry_leg");
  assert.ok(entry, "expected gateway_src_entry_leg for XAUT source");
  assert.equal(entry.chain, "ethereum");
  assert.equal(entry.inputToken, ETHEREUM_USDC);
  assert.equal(entry.outputToken, ETHEREUM_XAUT);
  assert.equal(entry.targetTokenAmount, "10000");
});

test("quote-dex includes stable entry leg for tokenized-gold (PAXG) source on EVM chain", () => {
  const paxgBtc = { srcChain: "ethereum", dstChain: "bitcoin", srcToken: ETHEREUM_PAXG, dstToken: ZERO };
  const legs = selectCandidateLegs([quote(paxgBtc, "2026-05-20T00:00:00.000Z", "10000", "10000", "9990")], {
    includeStableEntry: true,
    routeLimit: 8,
    scoreSnapshot: {
      scores: [
        {
          routeKey: `${paxgBtc.srcChain}:${paxgBtc.srcToken}->${paxgBtc.dstChain}:${paxgBtc.dstToken}`,
          amount: "10000",
          inputUsd: 41.2,
        },
      ],
    },
  });

  const entry = legs.find((item) => item.source === "gateway_src_entry_leg");
  assert.ok(entry, "expected gateway_src_entry_leg for PAXG source");
  assert.equal(entry.chain, "ethereum");
  assert.equal(entry.inputToken, ETHEREUM_USDC);
  assert.equal(entry.outputToken, ETHEREUM_PAXG);
});

test("quote-dex includes stable entry leg for stablecoin-family source distinct from chain stable quote", () => {
  const ousdtBtc = { srcChain: "base", dstChain: "bitcoin", srcToken: BASE_OUSDT, dstToken: ZERO };
  const legs = selectCandidateLegs([quote(ousdtBtc, "2026-05-20T00:00:00.000Z", "10000", "10000", "9990")], {
    includeStableEntry: true,
    routeLimit: 8,
    scoreSnapshot: {
      scores: [
        {
          routeKey: `${ousdtBtc.srcChain}:${ousdtBtc.srcToken}->${ousdtBtc.dstChain}:${ousdtBtc.dstToken}`,
          amount: "10000",
          inputUsd: 5.0,
        },
      ],
    },
  });

  const entry = legs.find((item) => item.source === "gateway_src_entry_leg");
  assert.ok(entry, "expected gateway_src_entry_leg for stablecoin source");
  assert.equal(entry.chain, "base");
  assert.equal(entry.inputToken, BASE_USDC);
  assert.equal(entry.outputToken, BASE_OUSDT);
});

test("quote-dex does not emit a stable entry leg when source token equals the chain stable quote token", () => {
  const usdcBtc = { srcChain: "base", dstChain: "bitcoin", srcToken: BASE_USDC, dstToken: ZERO };
  const legs = selectCandidateLegs([quote(usdcBtc, "2026-05-20T00:00:00.000Z", "10000", "10000", "9990")], {
    includeStableEntry: true,
    routeLimit: 8,
    scoreSnapshot: {
      scores: [
        {
          routeKey: `${usdcBtc.srcChain}:${usdcBtc.srcToken}->${usdcBtc.dstChain}:${usdcBtc.dstToken}`,
          amount: "10000",
          inputUsd: 5.0,
        },
      ],
    },
  });

  assert.equal(
    legs.some((item) => item.source === "gateway_src_entry_leg"),
    false,
  );
});

test("quote-dex does not emit a stable entry leg when source chain lacks a stable quote token", () => {
  const btcXaut = { srcChain: "bitcoin", dstChain: "ethereum", srcToken: ZERO, dstToken: ETHEREUM_XAUT };
  const legs = selectCandidateLegs([quote(btcXaut, "2026-05-20T00:00:00.000Z", "10000", "10000", "9990")], {
    includeStableEntry: true,
    routeLimit: 8,
    scoreSnapshot: {
      scores: [
        {
          routeKey: `${btcXaut.srcChain}:${btcXaut.srcToken}->${btcXaut.dstChain}:${btcXaut.dstToken}`,
          amount: "10000",
          inputUsd: 5.0,
        },
      ],
    },
  });

  assert.equal(
    legs.some((item) => item.source === "gateway_src_entry_leg"),
    false,
  );
});

test("quote-dex can include stable entry legs for ETH-family routes when score input usd is known", () => {
  const baseBase = { srcChain: "base", dstChain: "ethereum", srcToken: ZERO, dstToken: ZERO };
  const legs = selectCandidateLegs([quote(baseBase, "2026-04-11T00:00:00.000Z", "10000", "10000", "9990")], {
    includeStableEntry: true,
    routeLimit: 8,
    scoreSnapshot: {
      scores: [
        {
          routeKey: `${baseBase.srcChain}:${baseBase.srcToken}->${baseBase.dstChain}:${baseBase.dstToken}`,
          amount: "10000",
          inputUsd: 7.25,
        },
      ],
    },
  });

  assert.equal(
    legs.some((item) => item.source === "gateway_src_entry_leg"),
    true,
  );
  const entry = legs.find((item) => item.source === "gateway_src_entry_leg");
  assert.equal(entry.chain, "base");
  assert.equal(entry.inputToken, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(entry.outputToken, ZERO);
  assert.equal(entry.targetTokenAmount, "10000");
});
