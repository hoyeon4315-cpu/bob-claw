import assert from "node:assert/strict";
import { test } from "node:test";
import { activeRoute, buildAdvanceSummary, routeArgs, scoringArgsForStep } from "../src/cli/advance-canary-helpers.mjs";

test("route args target the selected address and route", () => {
  assert.deepEqual(
    routeArgs("0xabc", { routeKey: "bob:0x1->base:0x1", amount: "10000" }),
    ["--address=0xabc", "--route-key=bob:0x1->base:0x1", "--amount=10000"],
  );
});

test("active route falls back when the current step has no route", () => {
  const fallback = { routeKey: "bob:0x1->base:0x1", amount: "10000" };
  assert.deepEqual(activeRoute({ decision: "RERUN_SCORING", route: null }, fallback), fallback);
});

test("advance canary uses selective scoring args for exact gas and rerun scoring steps", () => {
  const route = { routeKey: "bob:0x1->base:0x1", amount: "10000" };
  assert.deepEqual(
    scoringArgsForStep({ decision: "RUN_EXACT_GAS", route }),
    ["--write", "--route-key=bob:0x1->base:0x1", "--amount=10000"],
  );
  assert.deepEqual(
    scoringArgsForStep({ decision: "RERUN_SCORING", route }),
    ["--write", "--route-key=bob:0x1->base:0x1", "--amount=10000"],
  );
});

test("advance canary falls back to full scoring when no active route exists", () => {
  assert.deepEqual(scoringArgsForStep({ decision: "RERUN_SCORING", route: null }), ["--write"]);
});

test("advance canary summary captures initial, after-wallet-check, and final decisions", () => {
  const summary = buildAdvanceSummary({
    address: "0xabc",
    initialStep: {
      decision: "RUN_EXACT_GAS",
      headline: "Run exact gas estimate",
      route: { label: "bob->base wBTC.OFT->wBTC.OFT", routeKey: "bob:0x1->base:0x1", amount: "10000" },
      reasons: ["stale_src_gas_snapshot"],
    },
    afterWalletCheckStep: {
      decision: "RUN_EXACT_GAS",
      headline: "Still needs exact gas",
      route: { label: "bob->base wBTC.OFT->wBTC.OFT", routeKey: "bob:0x1->base:0x1", amount: "10000" },
      reasons: ["exact_src_execution_gas_not_estimated"],
    },
    finalStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      headline: "Best prepared route still fails objective score review",
      route: { label: "bob->base wBTC.OFT->wBTC.OFT", routeKey: "bob:0x1->base:0x1", amount: "10000" },
      reasons: ["reject_no_net_edge"],
    },
    actions: ["check-estimator-wallet", "estimate-gateway-gas", "score-gateway", "status-dashboard"],
  });

  assert.equal(summary.address, "0xabc");
  assert.equal(summary.actionCount, 4);
  assert.deepEqual(summary.actions, ["check-estimator-wallet", "estimate-gateway-gas", "score-gateway", "status-dashboard"]);
  assert.equal(summary.initial.decision, "RUN_EXACT_GAS");
  assert.equal(summary.afterWalletCheck.decision, "RUN_EXACT_GAS");
  assert.equal(summary.final.decision, "BLOCKED_NO_VIABLE_PREP_ROUTE");
  assert.equal(summary.final.routeLabel, "bob->base wBTC.OFT->wBTC.OFT");
});

test("advance canary summary preserves a zero amount instead of coercing it to null", () => {
  const summary = buildAdvanceSummary({
    address: "0xabc",
    initialStep: {
      decision: "RUN_EXACT_GAS",
      headline: "Run exact gas estimate",
      route: { label: "zero-route", routeKey: "bob:0x0->base:0x0", amount: 0 },
      reasons: [],
    },
    actions: [],
  });

  assert.equal(summary.initial.amount, 0);
});

test("advance canary summary can record a failed exact gas action without losing the next step", () => {
  const summary = buildAdvanceSummary({
    address: "0xabc",
    initialStep: {
      decision: "RUN_EXACT_GAS",
      headline: "Run exact gas estimate",
      route: { label: "bob->base", routeKey: "bob:0x1->base:0x1", amount: "10000" },
      reasons: ["exact_src_execution_gas_not_estimated"],
    },
    afterWalletCheckStep: {
      decision: "RUN_EXACT_GAS",
      headline: "Run exact gas estimate",
      route: { label: "bob->base", routeKey: "bob:0x1->base:0x1", amount: "10000" },
      reasons: ["exact_src_execution_gas_not_estimated"],
    },
    finalStep: {
      decision: "RUN_EXACT_GAS",
      headline: "Run exact gas estimate",
      route: { label: "bob->base", routeKey: "bob:0x1->base:0x1", amount: "10000" },
      reasons: ["exact_src_execution_gas_not_estimated"],
    },
    actions: ["check-estimator-wallet", "estimate-gateway-gas_failed"],
  });

  assert.deepEqual(summary.actions, ["check-estimator-wallet", "estimate-gateway-gas_failed"]);
  assert.equal(summary.final.decision, "RUN_EXACT_GAS");
  assert.equal(summary.final.reasons[0], "exact_src_execution_gas_not_estimated");
});
