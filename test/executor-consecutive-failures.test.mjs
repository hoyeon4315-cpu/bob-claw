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

test("approval revocations bypass consecutive failure blocking", async () => {
  const policy = await evaluateIntentPolicies({
    intent: intentFixture({
      strategyId: "gateway_native_asset_conversion_sleeve",
      intentType: "approve_exact",
      amountUsd: 0,
      approval: {
        mode: "per_tx",
        token: "0xabc",
        spender: "0xdef",
        amount: "0",
      },
      metadata: {
        capCheckAmountUsd: 0,
      },
    }),
    auditRecords: [
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        intentId: "fail-1",
        timestamp: "2026-04-24T01:35:22.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        intentId: "fail-2",
        timestamp: "2026-04-24T01:36:22.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        intentId: "fail-3",
        timestamp: "2026-04-24T01:37:22.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
    ],
    now: "2026-04-24T01:38:00.000Z",
  });

  assert.equal(policy.blockers.includes("max_consecutive_failures_reached"), false);
  const consecutiveResult = policy.results.find((item) => item.policy === "consecutive_failures");
  assert.equal(consecutiveResult.metrics.bypassReason, "approval_revocation");
});

test("committed resume timestamp ignores older terminal failures without rewriting audit history", async () => {
  const policy = await evaluateIntentPolicies({
    intent: intentFixture({
      strategyId: "native-dex-experiment",
      chain: "optimism",
      intentType: "dex_swap",
      quote: { observedAt: "2026-04-22T15:17:00.000Z" },
    }),
    auditRecords: [
      {
        strategyId: "native-dex-experiment",
        intentId: "fail-1",
        timestamp: "2026-04-22T15:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        strategyId: "native-dex-experiment",
        intentId: "fail-2",
        timestamp: "2026-04-22T15:11:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        strategyId: "native-dex-experiment",
        intentId: "fail-3",
        timestamp: "2026-04-22T15:16:41.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
    ],
    now: "2026-04-22T15:17:00.000Z",
  });

  assert.equal(policy.decision, "ALLOW");
  assert.equal(policy.blockers.includes("max_consecutive_failures_reached"), false);
  const consecutiveResult = policy.results.find((item) => item.policy === "consecutive_failures");
  assert.equal(consecutiveResult.metrics.consecutiveFailures, 0);
  assert.equal(consecutiveResult.metrics.resumeAfter, "2026-04-22T15:16:42.000Z");
});

test("new failures after a committed resume timestamp are still counted", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "native-dex-experiment",
    resumeAfter: "2026-04-22T15:16:42.000Z",
    auditRecords: [
      {
        strategyId: "native-dex-experiment",
        intentId: "older-fail",
        timestamp: "2026-04-22T15:16:41.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        strategyId: "native-dex-experiment",
        intentId: "new-fail",
        timestamp: "2026-04-22T15:17:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.latestFailureAt, "2026-04-22T15:17:00.000Z");
});

test("prelive fork sign-only rejections do not count as terminal failures", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "prelive_fork_execution",
    auditRecords: [
      {
        strategyId: "prelive_fork_execution",
        intentId: "fork-reject-1",
        timestamp: "2026-04-19T10:00:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
        broadcast: null,
      },
      {
        strategyId: "prelive_fork_execution",
        intentId: "fork-reject-2",
        timestamp: "2026-04-19T10:01:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
        broadcast: null,
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.terminalRecordCount, 0);
});
