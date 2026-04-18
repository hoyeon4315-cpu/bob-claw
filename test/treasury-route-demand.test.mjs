import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTreasuryRouteDemand, selectFundingRouteContext } from "../src/treasury/route-demand.mjs";

test("treasury route demand keeps viable canary source demand", () => {
  const demand = buildTreasuryRouteDemand({
    routePlan: {
      topCandidates: [
        {
          viableForPrep: true,
          srcChain: "bob",
          routeKey: "bob:0x0555->base:0x0555",
          tradeReadiness: "insufficient_data",
          netEdgeUsd: 0.4,
        },
        {
          viableForPrep: false,
          srcChain: "base",
          routeKey: "base:0x0555->bob:0x0555",
        },
      ],
    },
    inventory: { native: [] },
    policy: { activeChains: ["bob", "base"], supportedChains: ["bob", "base"] },
  });

  assert.deepEqual(demand, [
    { chain: "bob" },
    { chain: "bob", token: "0x0555" },
  ]);
});

test("treasury route demand drops viable canary demand once net edge is confirmed non-positive", () => {
  const demand = buildTreasuryRouteDemand({
    routePlan: {
      topCandidates: [
        {
          viableForPrep: true,
          srcChain: "avalanche",
          routeKey: "avalanche:0x0555->soneium:0x0555",
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.6,
        },
      ],
    },
    inventory: { native: [] },
    policy: { activeChains: ["bob", "base"], supportedChains: ["bob", "base", "avalanche", "soneium"] },
  });

  assert.deepEqual(demand, []);
});

test("treasury route demand adds announced expansion chains with low native balances", () => {
  const demand = buildTreasuryRouteDemand({
    routePlan: { topCandidates: [] },
    inventory: {
      activeChains: ["bob", "base"],
      supportedChains: ["bob", "base", "bsc", "ethereum", "soneium", "unichain", "bera"],
      native: [
        { chain: "bsc", enabled: true, status: "observe_only_low" },
        { chain: "ethereum", enabled: true, status: "observe_only_low" },
        { chain: "soneium", enabled: true, status: "observe_only_low" },
        { chain: "unichain", enabled: true, status: "observe_only_low" },
        { chain: "bera", enabled: true, status: "observe_only_low" },
        { chain: "base", enabled: true, status: "below_target" },
        { chain: "sonic", enabled: false, status: "observe_only_balance_present" },
      ],
    },
    policy: {
      activeChains: ["bob", "base"],
      supportedChains: ["bob", "base", "bsc", "ethereum", "soneium", "unichain", "bera"],
    },
  });

  assert.deepEqual(demand, [
    { chain: "bsc" },
    { chain: "ethereum" },
    { chain: "soneium" },
    { chain: "unichain" },
    { chain: "bera" },
  ]);
});

test("treasury route demand includes positive insufficient-data candidates for source funding", () => {
  const demand = buildTreasuryRouteDemand({
    routePlan: {
      topCandidates: [],
      candidates: [
        {
          txReady: true,
          tradeReadiness: "insufficient_data",
          netEdgeUsd: 1.75,
          srcChain: "base",
          srcToken: "0x8335",
        },
        {
          txReady: true,
          tradeReadiness: "insufficient_data",
          netEdgeUsd: 1.73,
          srcChain: "bsc",
          srcToken: "0x8ac7",
        },
        {
          txReady: false,
          tradeReadiness: "insufficient_data",
          netEdgeUsd: 9,
          srcChain: "ethereum",
          srcToken: "0x2260",
        },
      ],
    },
    inventory: { native: [] },
    policy: { activeChains: ["bob", "base"], supportedChains: ["bob", "base", "bsc"] },
  });

  assert.deepEqual(demand, [
    { chain: "base" },
    { chain: "base", token: "0x8335" },
    { chain: "bsc" },
    { chain: "bsc", token: "0x8ac7" },
  ]);
});

test("funding route context prefers highest-edge positive insufficient-data candidate", () => {
  const routeContext = selectFundingRouteContext({
    topCandidates: [
      {
        routeKey: "avalanche:0x0555->soneium:0x0555",
        viableForPrep: true,
        txReady: true,
        tradeReadiness: "reject_no_net_edge",
        netEdgeUsd: -0.6,
      },
    ],
    candidates: [
      {
        routeKey: "base:0x8335->bitcoin:0x0000",
        srcChain: "base",
        srcToken: "0x8335",
        txReady: true,
        tradeReadiness: "insufficient_data",
        netEdgeUsd: 1.75,
        prepFundingUsd: 250,
      },
      {
        routeKey: "bsc:0x8ac7->bitcoin:0x0000",
        srcChain: "bsc",
        srcToken: "0x8ac7",
        txReady: true,
        tradeReadiness: "insufficient_data",
        netEdgeUsd: 1.73,
        prepFundingUsd: 251,
      },
    ],
  });

  assert.equal(routeContext.routeKey, "base:0x8335->bitcoin:0x0000");
  assert.equal(routeContext.tradeReadiness, "insufficient_data");
});
