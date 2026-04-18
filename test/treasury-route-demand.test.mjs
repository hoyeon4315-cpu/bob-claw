import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTreasuryRouteDemand } from "../src/treasury/route-demand.mjs";

test("treasury route demand keeps viable canary source demand", () => {
  const demand = buildTreasuryRouteDemand({
    routePlan: {
      topCandidates: [
        {
          viableForPrep: true,
          srcChain: "bob",
          routeKey: "bob:0x0555->base:0x0555",
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
