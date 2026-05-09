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
    chain: "base",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "older-success",
        timestamp: "2026-04-17T00:00:00.000Z",
        policyVerdict: "approved",
        lifecycle: { stage: "confirmed" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "fail-2",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "fail-3",
        timestamp: "2026-04-17T00:12:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 3);
  assert.equal(state.lastTerminalStatus, "broadcastFailed");
});

test("evaluateIntentPolicies blocks when the strategy already has three consecutive terminal failures", async () => {
  const strategyId = "tokenized_reserve_sleeve";
  const policy = await evaluateIntentPolicies({
    intent: intentFixture({ strategyId }),
    auditRecords: [
      {
        strategyId,
        chain: "base",
        intentId: "fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId,
        chain: "base",
        intentId: "fail-2",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId,
        chain: "base",
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
  const strategyId = "wrapped-btc-loop-base-moonwell";
  const state = buildConsecutiveFailureState({
    strategyId,
    chain: "base",
    auditRecords: [
      {
        strategyId,
        chain: "base",
        intentId: "real-fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId,
        chain: "base",
        intentId: "self-reject-1",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
        broadcast: null,
      },
      {
        strategyId,
        chain: "base",
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
    chain: "base",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "real-fail-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "kill-switch-reject-1",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["kill_switch_present"] },
        broadcast: null,
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
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

test("consecutive failure state ignores no-tx cap policy rejections", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "gateway-btc-funding-transfer",
    chain: "base",
    auditRecords: [
      {
        strategyId: "gateway-btc-funding-transfer",
        chain: "base",
        intentId: "cap-reject-1",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "rejected",
        lifecycle: {
          stage: "rejected",
          blockers: ["strategy_per_chain_cap_exceeded"],
        },
        broadcast: null,
      },
      {
        strategyId: "gateway-btc-funding-transfer",
        chain: "base",
        intentId: "cap-and-breaker-reject",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: {
          stage: "rejected",
          blockers: ["max_consecutive_failures_reached", "strategy_per_day_cap_exceeded"],
        },
        broadcast: null,
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.terminalRecordCount, 0);
});

test("consecutive failure state still counts rejections with substantive blockers", () => {
  const state = buildConsecutiveFailureState({
    strategyId: "gateway-btc-funding-transfer",
    chain: "base",
    auditRecords: [
      {
        strategyId: "gateway-btc-funding-transfer",
        chain: "base",
        intentId: "executor-binding-reject",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "rejected",
        lifecycle: {
          stage: "rejected",
          blockers: ["protocol_executor_missing"],
        },
        broadcast: null,
      },
    ],
  });

  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.policyRejectedCount, 1);
  assert.equal(state.terminalRecordCount, 0);
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
        chain: "base",
        intentId: "fail-1",
        timestamp: "2026-04-24T01:35:22.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        intentId: "fail-2",
        timestamp: "2026-04-24T01:36:22.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
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
      expectedNetUsd: 10,
      quote: { observedAt: "2026-04-22T15:17:00.000Z" },
    }),
    auditRecords: [
      {
        strategyId: "native-dex-experiment",
        chain: "optimism",
        intentId: "fail-1",
        timestamp: "2026-04-22T15:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "native-dex-experiment",
        chain: "optimism",
        intentId: "fail-2",
        timestamp: "2026-04-22T15:11:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "native-dex-experiment",
        chain: "optimism",
        intentId: "fail-3",
        timestamp: "2026-04-22T15:16:41.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
    ],
    now: "2026-04-22T15:17:00.000Z",
    killSwitchPath: null,
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
        chain: "optimism",
        intentId: "older-fail",
        timestamp: "2026-04-22T15:16:41.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "native-dex-experiment",
        chain: "optimism",
        intentId: "new-fail",
        timestamp: "2026-04-22T15:17:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
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
        chain: "avalanche",
        intentId: "fail-1",
        timestamp: "2026-04-27T00:55:35.069Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "lifi-bridge",
        chain: "avalanche",
        intentId: "fail-2",
        timestamp: "2026-04-27T01:01:06.602Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
      },
      {
        strategyId: "lifi-bridge",
        chain: "avalanche",
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
    chain: "sonic",
    auditRecords: [
      {
        strategyId: "prelive_fork_execution",
        chain: "sonic",
        intentId: "fork-reject-1",
        timestamp: "2026-04-19T10:00:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected" },
        broadcast: null,
      },
      {
        strategyId: "prelive_fork_execution",
        chain: "sonic",
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

test("successful broadcast on the same strategy and chain resets the auto-pause streak", () => {
  const auditRecords = [
    { strategyId: "wrapped-btc-loop", chain: "base", intentId: "wrapped-btc-loop:mint:1", timestamp: "2026-04-16T20:10:10Z", policyVerdict: "errored", lifecycle: { stage: "reverted" } },
    { strategyId: "wrapped-btc-loop", chain: "base", intentId: "wrapped-btc-loop:mint:2", timestamp: "2026-04-16T20:11:10Z", policyVerdict: "errored", lifecycle: { stage: "reverted" } },
    { strategyId: "wrapped-btc-loop", chain: "base", intentId: "wrapped-btc-loop:approve", timestamp: "2026-04-16T20:12:00Z", policyVerdict: "approved", lifecycle: { stage: "confirmed" } },
    { strategyId: "wrapped-btc-loop", chain: "base", intentId: "wrapped-btc-loop:mint:3", timestamp: "2026-04-16T20:13:10Z", policyVerdict: "errored", lifecycle: { stage: "reverted" } },
  ];

  const state = buildConsecutiveFailureState({
    strategyId: "wrapped-btc-loop",
    chain: "base",
    auditRecords,
  });

  assert.equal(state.strategyConsecutiveFailures, 1);
  assert.equal(state.successfulBroadcastCount, 1);
  assert.equal(state.consecutiveFailures, 1);
});

test("approval-only successes do not reset downstream execution failure streaks", async () => {
  const strategyId = "beefy-folding-vault";
  const auditRecords = [
    {
      strategyId,
      chain: "base",
      intentId: "beefy:approve:1",
      intentHash: "approve-1",
      timestamp: "2026-05-07T19:11:37.771Z",
      policyVerdict: "approved",
      intent: { intentType: "approve_exact" },
      lifecycle: { stage: "confirmed" },
    },
    {
      strategyId,
      chain: "base",
      intentId: "beefy:deposit:1",
      intentHash: "deposit-1",
      timestamp: "2026-05-07T19:11:43.846Z",
      policyVerdict: "errored",
      intent: { intentType: "vault_deposit" },
      lifecycle: { stage: "reverted" },
    },
    {
      strategyId,
      chain: "base",
      intentId: "beefy:approve:2",
      intentHash: "approve-2",
      timestamp: "2026-05-07T21:45:08.060Z",
      policyVerdict: "approved",
      intent: { intentType: "approve_exact" },
      lifecycle: { stage: "confirmed" },
    },
    {
      strategyId,
      chain: "base",
      intentId: "beefy:deposit:2",
      intentHash: "deposit-2",
      timestamp: "2026-05-07T21:45:14.569Z",
      policyVerdict: "errored",
      intent: { intentType: "vault_deposit" },
      lifecycle: { stage: "reverted" },
    },
  ];

  const state = buildConsecutiveFailureState({
    strategyId,
    chain: "base",
    auditRecords,
  });

  assert.equal(state.consecutiveFailures, 2);
  assert.equal(state.successfulBroadcastCount, 0);

  const policy = await evaluateIntentPolicies({
    intent: intentFixture({
      strategyId,
      chain: "base",
      intentType: "vault_deposit",
      amountUsd: 10,
      metadata: {
        capCheckAmountUsd: 10,
      },
    }),
    auditRecords: [
      ...auditRecords,
      {
        strategyId,
        chain: "base",
        intentId: "beefy:deposit:3",
        intentHash: "deposit-3",
        timestamp: "2026-05-07T21:46:00.000Z",
        policyVerdict: "errored",
        intent: { intentType: "vault_deposit" },
        lifecycle: { stage: "reverted" },
      },
    ],
    now: "2026-05-07T21:47:00.000Z",
  });

  assert.equal(policy.blockers.includes("max_consecutive_failures_reached"), true);
});

test("policy rejections and no-tx errors do not trip the 3-strike auto-pause", async () => {
  const policy = await evaluateIntentPolicies({
    intent: intentFixture({
      strategyId: "gateway_proxy_spread_rebalance_recheck",
      chain: "base",
    }),
    auditRecords: [
      {
        strategyId: "gateway_proxy_spread_rebalance_recheck",
        chain: "base",
        intentId: "reject-1",
        timestamp: "2026-05-04T00:00:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["kill_switch_present"] },
      },
      {
        strategyId: "gateway_proxy_spread_rebalance_recheck",
        chain: "base",
        intentId: "error-1",
        timestamp: "2026-05-04T00:01:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
        error: { name: "Error", message: "insufficient_native_balance_for_gas" },
      },
      {
        strategyId: "gateway_proxy_spread_rebalance_recheck",
        chain: "base",
        intentId: "reject-2",
        timestamp: "2026-05-04T00:02:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["strategy_per_day_cap_exceeded"] },
      },
    ],
    now: "2026-05-04T00:03:00.000Z",
  });

  assert.equal(policy.blockers.includes("max_consecutive_failures_reached"), false);
  const consecutiveResult = policy.results.find((item) => item.policy === "consecutive_failures");
  assert.equal(consecutiveResult.metrics.consecutiveFailures, 0);
  assert.equal(consecutiveResult.metrics.policyRejectedCount, 2);
  assert.equal(consecutiveResult.metrics.noTxFailureCount, 1);
});

test("strategy and chain streaks are isolated", async () => {
  const policy = await evaluateIntentPolicies({
    intent: intentFixture({
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
    }),
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "ethereum",
        intentId: "eth-fail-1",
        timestamp: "2026-05-04T00:00:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "ethereum",
        intentId: "eth-fail-2",
        timestamp: "2026-05-04T00:01:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "ethereum",
        intentId: "eth-fail-3",
        timestamp: "2026-05-04T00:02:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
    ],
    now: "2026-05-04T00:03:00.000Z",
  });

  assert.equal(policy.blockers.includes("max_consecutive_failures_reached"), false);
});
