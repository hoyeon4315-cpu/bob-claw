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
  const strategyId = "recursive_wrapped_btc_lending_loop";
  const policy = await evaluateIntentPolicies({
    intent: intentFixture({ strategyId }),
    auditRecords: [
      {
        strategyId,
        intentId: "fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        strategyId,
        intentId: "fail-2",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId,
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

test("consecutive failure state ignores pure circuit-breaker self rejections", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "gateway_native_asset_conversion_sleeve",
    auditRecords: [
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        intentId: "real-fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        intentId: "self-reject-1",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
        broadcast: null,
      },
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        intentId: "self-reject-2",
        timestamp: "2026-04-17T00:12:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
        broadcast: null,
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.terminalRecordCount, 1);
  assert.equal(state.latestFailureAt, "2026-04-17T00:10:00.000Z");
});

test("consecutive failure state ignores pure kill-switch policy rejections", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "wrapped-btc-loop-base-moonwell",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "real-fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "kill-switch-reject-1",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["kill_switch_present"] },
        broadcast: null,
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentId: "kill-switch-reject-2",
        timestamp: "2026-04-17T00:12:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["kill_switch_present"] },
        broadcast: null,
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.terminalRecordCount, 1);
});

test("consecutive failure state still counts rejections with substantive blockers", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "gateway-btc-funding-transfer",
    auditRecords: [
      {
        strategyId: "gateway-btc-funding-transfer",
        intentId: "cap-and-breaker-reject",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "rejected",
        lifecycle: {
          stage: "rejected",
          blockers: ["max_consecutive_failures_reached", "strategy_per_chain_cap_exceeded"],
        },
        broadcast: null,
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.terminalRecordCount, 1);
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

test("LI.FI bridge committed resume timestamp clears older rejection streaks", async () => {
  const policy = await evaluateIntentPolicies({
    intent: intentFixture({
      strategyId: "lifi-bridge",
      chain: "avalanche",
      intentType: "lifi_bridge_transfer",
      amountUsd: 20,
      metadata: {
        capCheckAmountUsd: 20,
      },
    }),
    auditRecords: [
      {
        strategyId: "lifi-bridge",
        intentId: "fail-1",
        timestamp: "2026-04-27T00:55:35.069Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "lifi-bridge",
        intentId: "fail-2",
        timestamp: "2026-04-27T01:01:06.602Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "lifi-bridge",
        intentId: "fail-3",
        timestamp: "2026-04-27T01:17:46.856Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
    ],
    now: "2026-04-27T01:19:00.000Z",
  });

  assert.equal(policy.blockers.includes("max_consecutive_failures_reached"), false);
  const consecutiveResult = policy.results.find((item) => item.policy === "consecutive_failures");
  assert.equal(consecutiveResult.metrics.resumeAfter, "2026-04-27T01:18:00.000Z");
  assert.equal(consecutiveResult.metrics.consecutiveFailures, 0);
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

test("per-intentId consecutive failures catch repeated sub-step reverts masked by sibling successes", () => {
  // Bug fix: wrapped-btc-loop mint step kept reverting, but approve/enter-market
  // succeeded, so the old strategy-level count never reached the threshold.
  const auditRecords = [
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:approve", timestamp: "2026-04-16T20:10:00Z", policyVerdict: "approved", lifecycle: { stage: "confirmed" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:enter", timestamp: "2026-04-16T20:10:05Z", policyVerdict: "approved", lifecycle: { stage: "confirmed" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:mint", timestamp: "2026-04-16T20:10:10Z", policyVerdict: "errored", lifecycle: { stage: "reverted" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:approve", timestamp: "2026-04-16T20:11:00Z", policyVerdict: "approved", lifecycle: { stage: "confirmed" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:enter", timestamp: "2026-04-16T20:11:05Z", policyVerdict: "approved", lifecycle: { stage: "confirmed" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:mint", timestamp: "2026-04-16T20:11:10Z", policyVerdict: "errored", lifecycle: { stage: "reverted" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:approve", timestamp: "2026-04-16T20:12:00Z", policyVerdict: "approved", lifecycle: { stage: "confirmed" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:enter", timestamp: "2026-04-16T20:12:05Z", policyVerdict: "approved", lifecycle: { stage: "confirmed" } },
    { strategyId: "wrapped-btc-loop", intentId: "wrapped-btc-loop:mint", timestamp: "2026-04-16T20:12:10Z", policyVerdict: "errored", lifecycle: { stage: "reverted" } },
  ];

  const mintState = buildConsecutiveFailureState({
    strategyId: "wrapped-btc-loop",
    auditRecords,
    intentId: "wrapped-btc-loop:mint",
  });

  // Strategy-level count is broken by successful approve/enter steps
  assert.equal(mintState.strategyConsecutiveFailures, 1);
  // Intent-level count correctly sees 3 consecutive mint reverts
  assert.equal(mintState.intentConsecutiveFailures, 3);
  // Total uses the max
  assert.equal(mintState.consecutiveFailures, 3);
});
