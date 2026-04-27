import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRoundtripEnforcer } from "../src/risk/roundtrip-enforcer.mjs";

test("non-capital-deploy intent passes immediately", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_rebalance",
    unwindPlan: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.blockers.length, 0);
});

test("capital_deploy without unwindPlan is rejected", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_deploy",
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("missing_unwind_plan"));
});

test("capital_deploy with empty steps is rejected", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_deploy",
    unwindPlan: { steps: [] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("missing_unwind_plan"));
});

test("capital_deploy with terminal chain bitcoin passes", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_deploy",
    unwindPlan: {
      steps: [
        { chain: "base", action: "swap" },
        { chain: "bob", action: "bridge" },
        { chain: "bitcoin", action: "offramp" },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.blockers.length, 0);
});

test("capital_deploy with terminal chain not bitcoin is rejected", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_deploy",
    unwindPlan: {
      steps: [
        { chain: "base", action: "swap" },
        { chain: "ethereum", action: "deposit" },
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("unwind_terminal_chain_not_bitcoin"));
});

test("capital_deploy uses metadata.unwindPlan", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_deploy",
    metadata: {
      unwindPlan: {
        steps: [{ chain: "bitcoin", action: "settle" }],
      },
    },
  });
  assert.equal(result.ok, true);
});

test("capital_deploy uses terminalChain fallback", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_deploy",
    unwindPlan: {
      terminalChain: "bitcoin",
      steps: [{ action: "generic" }],
    },
  });
  assert.equal(result.ok, true);
});

test("capital_deploy rejects when terminalChain fallback is not bitcoin", () => {
  const result = evaluateRoundtripEnforcer({
    kind: "capital_deploy",
    unwindPlan: {
      terminalChain: "base",
      steps: [{ action: "generic" }],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("unwind_terminal_chain_not_bitcoin"));
});

test("intentType capital_deploy is recognized", () => {
  const result = evaluateRoundtripEnforcer({
    intentType: "capital_deploy",
    unwindPlan: {
      steps: [{ chain: "bitcoin", action: "settle" }],
    },
  });
  assert.equal(result.ok, true);
});
