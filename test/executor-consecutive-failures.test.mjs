import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConsecutiveFailureState } from "../src/executor/policy/consecutive-failures.mjs";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";

function intentFixture(overrides = {}) {
  return {
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    family: "evm",
    mode: "live",
    intentType: "borrow_loop",
    amountUsd: 25,
    quote: {
      observedAt: "2026-04-17T00:00:00.000Z",
    },
    positionState: {
      currentHealthFactor: 1.7,
      projectedHealthFactor: 1.55,
      currentLiquidationBufferPct: 15,
      projectedLiquidationBufferPct: 13,
    },
    metadata: {
      capCheckAmountUsd: 25,
    },
    ...overrides,
  };
}

test("consecutive failure state counts only terminal failures until the latest success boundary", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "wrapped-btc-loop-base-moonwell",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "older-success",
        timestamp: "2026-04-17T00:00:00.000Z",
        policyVerdict: "approved",
        lifecycle: { stage: "confirmed" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "fail-2",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "fail-3",
        timestamp: "2026-04-17T00:12:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 3);
  assert.equal(state.lastTerminalStatus, "failure");
});

test("evaluateIntentPolicies blocks when the strategy already has three consecutive terminal failures", async () => {
  const policy = await evaluateIntentPolicies({
    intent: intentFixture(),
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "fail-2",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "fail-3",
        timestamp: "2026-04-17T00:12:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
    ],
    now: "2026-04-17T00:13:00.000Z",
  });

  assert.equal(policy.decision, "BLOCK");
  assert.equal(policy.blockers.includes("max_consecutive_failures_reached"), true);
});
