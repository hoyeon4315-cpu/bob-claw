import assert from "node:assert/strict";
import { test } from "node:test";
import { activeRoute, routeArgs, scoringArgsForStep } from "../src/cli/advance-canary-helpers.mjs";

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
