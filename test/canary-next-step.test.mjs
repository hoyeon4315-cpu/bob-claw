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
