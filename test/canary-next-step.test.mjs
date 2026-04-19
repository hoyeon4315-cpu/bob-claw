import assert from "node:assert/strict";
import { test } from "node:test";
import { determineCanaryNextStep } from "../src/estimator/canary-next-step.mjs";

test("next step asks for funding when best viable route still has wallet blockers", () => {
  const next = determineCanaryNextStep({
    routePlan: {
      topCandidates: [
        {
          routeKey: "bob:token->base:token",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "bob",
          viableForPrep: true,
          exactGasDone: false,
          prepBlockers: ["native", "token", "allowance"],
        },
      ],
    },
    fundingPlan: {
      chains: [
        {
          chain: "bob",
          native: { ticker: "ETH", shortfallDecimal: 0.00035, shortfall: "350", ok: false },
          tokens: [{ ticker: "wBTC.OFT", token: "0xtoken", shortfallDecimal: 0.0001, shortfall: "10000", ok: false }],
          allowances: [{ ticker: "wBTC.OFT", token: "0xtoken", spender: "0xspender", shortfallDecimal: 0.0001, shortfall: "10000", ok: false }],
        },
      ],
    },
  });

  assert.equal(next.decision, "FUND_AND_APPROVE_WALLET");
  assert.equal(next.actions.length, 3);
  assert.deepEqual(next.reasons, ["native", "token", "allowance"]);
});

test("next step blocks wallet funding when the best prep route has non-positive system economics", () => {
  const next = determineCanaryNextStep({
    routePlan: {
      topCandidates: [
        {
          routeKey: "soneium:token->bob:token",
          label: "soneium->bob wBTC.OFT->wBTC.OFT",
          amount: "100",
          srcChain: "soneium",
          viableForPrep: true,
          exactGasDone: false,
          prepBlockers: ["native"],
          effectiveSystemNetPnlUsd: -0.96,
          tradeReadiness: "insufficient_data",
        },
      ],
    },
    fundingPlan: {
      chains: [
        {
          chain: "soneium",
          native: { ticker: "ETH", shortfallDecimal: 0.00051, shortfall: "510", ok: false },
          tokens: [],
          allowances: [],
        },
      ],
    },
  });

  assert.equal(next.decision, "BLOCKED_ECONOMICALLY_UNJUSTIFIED_PREP");
  assert.equal(next.actions.length, 0);
  assert.deepEqual(next.reasons, ["effective_system_net_pnl_not_positive", "insufficient_data"]);
});

test("next step blocks exact gas when executable economics are already non-positive", () => {
  const next = determineCanaryNextStep({
    routePlan: {
      topCandidates: [
        {
          routeKey: "bob:token->base:token",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "bob",
          viableForPrep: true,
          exactGasDone: false,
          prepBlockers: [],
          executableNetEdgeUsd: 0,
        },
      ],
    },
    fundingPlan: { chains: [] },
  });

  assert.equal(next.decision, "BLOCKED_ECONOMICALLY_UNJUSTIFIED_PREP");
  assert.deepEqual(next.reasons, ["executable_net_edge_not_positive"]);
});

test("next step asks for exact gas when route is funded and viable", () => {
  const next = determineCanaryNextStep({
    routePlan: {
      topCandidates: [
        {
          routeKey: "bob:token->base:token",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "bob",
          viableForPrep: true,
          exactGasDone: false,
          prepBlockers: [],
        },
      ],
    },
    fundingPlan: { chains: [] },
  });

  assert.equal(next.decision, "RUN_EXACT_GAS");
  assert.equal(next.actions[0].type, "estimate_exact_gas");
});

test("next step blocks when best candidate is not viable for prep", () => {
  const next = determineCanaryNextStep({
    routePlan: {
      topCandidates: [
        {
          routeKey: "base:token->bob:token",
          label: "base->bob wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "base",
          viableForPrep: false,
          txReady: false,
          scoreDisqualifiers: ["implausible_quote_value_ratio"],
          readinessFailureReason: "missing_tx_data",
        },
      ],
    },
    fundingPlan: { chains: [] },
  });

  assert.equal(next.decision, "BLOCKED_NO_VIABLE_PREP_ROUTE");
  assert.equal(next.reasons.includes("missing_tx_data"), true);
});

test("next step reruns exact gas when stale gas is the only blocker", () => {
  const next = determineCanaryNextStep({
    routePlan: {
      topCandidates: [
        {
          routeKey: "bob:token->base:token",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "bob",
          viableForPrep: false,
          txReady: true,
          prepBlockers: [],
          scoreDisqualifiers: ["stale_src_gas_snapshot"],
          readinessFailureReason: null,
        },
      ],
    },
    fundingPlan: { chains: [] },
  });

  assert.equal(next.decision, "RUN_EXACT_GAS");
  assert.equal(next.actions[0].type, "estimate_exact_gas");
  assert.deepEqual(next.reasons, ["stale_src_gas_snapshot"]);
});

test("next step blocks after exact gas when objective score still rejects the route", () => {
  const next = determineCanaryNextStep({
    routePlan: {
      topCandidates: [
        {
          routeKey: "bob:token->base:token",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "bob",
          viableForPrep: true,
          txReady: true,
          exactGasDone: true,
          prepBlockers: [],
          tradeReadiness: "reject_no_net_edge",
        },
      ],
    },
    fundingPlan: { chains: [] },
  });

  assert.equal(next.decision, "BLOCKED_NO_VIABLE_PREP_ROUTE");
  assert.deepEqual(next.reasons, ["reject_no_net_edge"]);
});
