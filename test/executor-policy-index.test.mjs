import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import { buildEmergencyUnwindIntent } from "../src/executor/policy/emergency-unwind-intent.mjs";
import { buildTinyLiveCanaryIntent } from "../src/executor/policy/tiny-live-canary-intent.mjs";

function baseIntent(overrides = {}) {
  return {
    strategyId: "across-bridge",
    chain: "base",
    family: "evm",
    intentType: "swap",
    amountUsd: 100,
    observedAt: "2026-04-22T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

test("policy index blocks intent when liquidity snapshot shows queue_unwind", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent(),
    auditRecords: [],
    riskContext: {
      liquiditySnapshot: {
        poolId: "moonwell-usdc",
        utilizationPct: 0.80,
        utilizationSustainedMinutes: 0,
        withdrawalQueueBlocks: 600,
      },
    },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes("liquidity_queue_unwind"));
  const liquidityResult = policy.results.find((r) => r.policy === "liquidity_watch");
  assert.ok(liquidityResult);
  assert.equal(liquidityResult.decision, "BLOCK");
});

test("policy index blocks intent when liquidity snapshot shows pause_new_entries", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent(),
    auditRecords: [],
    riskContext: {
      liquiditySnapshot: {
        poolId: "moonwell-usdc",
        utilizationPct: 0.97,
        utilizationSustainedMinutes: 60,
      },
    },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes("liquidity_pause_new_entries"));
});

test("policy index blocks intent when concentration guard rejects", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent({ amountUsd: 500 }),
    auditRecords: [],
    activeBudgetUsd: 1000,
    riskContext: {
      currentAllocations: { perStrategy: { "wrapped-btc-loop-base-moonwell": 0.2 } },
      totalOperatingCapitalUsd: 1000,
    },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes("concentration_guard_reject_intent"));
  const concentrationResult = policy.results.find((r) => r.policy === "concentration_guard");
  assert.ok(concentrationResult);
  assert.equal(concentrationResult.decision, "BLOCK");
});

test("policy index allows intent when risk context is absent", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent(),
    auditRecords: [],
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "ALLOW");
  assert.ok(!policy.results.some((r) => r.policy === "liquidity_watch"));
  assert.ok(!policy.results.some((r) => r.policy === "concentration_guard"));
});

test("policy index allows intent when concentration is within caps", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent({ amountUsd: 100 }),
    auditRecords: [],
    activeBudgetUsd: 1000,
    riskContext: {
      currentAllocations: { perStrategy: { "wrapped-btc-loop-base-moonwell": 0.1 } },
      totalOperatingCapitalUsd: 1000,
    },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "ALLOW");
  const concentrationResult = policy.results.find((r) => r.policy === "concentration_guard");
  assert.ok(concentrationResult);
  assert.equal(concentrationResult.decision, "ALLOW");
});

test("policy index propagates requiresUnwind when hf check triggers", async () => {
  const policy = await evaluateIntentPolicies({
    intent: baseIntent({
      strategyId: "wrapped-btc-loop-base-moonwell",
      strategyConfig: {
        isLeverage: true,
        leverage: {
          healthFactorMin: 1.35,
          liquidationBufferPct: 12,
          emergencyUnwindPath: ["repay", "withdraw"],
        },
      },
      positionState: {
        currentHealthFactor: 1.28,
        currentLiquidationBufferPct: 11,
      },
    }),
    auditRecords: [],
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "BLOCK");
  assert.equal(policy.requiresUnwind, true);
  assert.deepEqual(policy.emergencyUnwindPath, ["repay borrow asset", "withdraw collateral", "bridge or swap back to settlement path"]);
});

test("emergency unwind intent builder produces valid skeleton", () => {
  const intent = buildEmergencyUnwindIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    family: "evm",
    emergencyUnwindPath: ["repay", "withdraw"],
    triggers: ["health_factor_below_min"],
    positionState: { currentHealthFactor: 1.28, currentLiquidationBufferPct: 11 },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(intent.intentType, "emergency_unwind");
  assert.equal(intent.mode, "emergency");
  assert.equal(intent.executionReason, "risk_unwind");
  assert.equal(intent.amountUsd, 0);
  assert.deepEqual(intent.metadata.emergencyUnwindPath, ["repay", "withdraw"]);
  assert.equal(intent.metadata.healthFactorPath, 1.28);
  assert.equal(intent.metadata.liquidationBufferPath, 11);
});

test("emergency unwind intent passes cap-check and hf-check via policy", async () => {
  const emergencyIntent = buildEmergencyUnwindIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    emergencyUnwindPath: ["repay", "withdraw"],
    triggers: ["health_factor_below_min"],
    now: "2026-04-22T00:00:00.000Z",
  });
  const policy = await evaluateIntentPolicies({
    intent: emergencyIntent,
    auditRecords: [],
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "ALLOW");
});

test("tiny_live_canary policy can pass while autoExecute disabled blocks live execution", async () => {
  const intent = buildTinyLiveCanaryIntent({
    strategyId: "recursive_wrapped_btc_lending_loop",
    chain: "base",
    amountUsd: 25,
    microCanaryStatus: "minimal_live_proof_exists",
    now: "2026-04-22T00:00:00.000Z",
  });
  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords: [
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        intent: { intentType: "emergency_unwind" },
        lifecycle: { stage: "confirmed" },
        observedAt: "2026-04-22T00:00:00.000Z",
      },
    ],
    riskContext: {
      microCanaryStatus: "minimal_live_proof_exists",
    },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes("strategy_auto_execute_disabled"));
  const tinyLiveResult = policy.results.find((r) => r.policy === "tiny_live_canary");
  assert.ok(tinyLiveResult);
  assert.equal(tinyLiveResult.decision, "ALLOW");
});

test("tiny_live_canary blocked when microCanaryStatus insufficient", async () => {
  const intent = buildTinyLiveCanaryIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    amountUsd: 25,
    microCanaryStatus: "micro_canary_ready",
    now: "2026-04-22T00:00:00.000Z",
  });
  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intent: { intentType: "emergency_unwind" },
        lifecycle: { stage: "confirmed" },
        observedAt: "2026-04-22T00:00:00.000Z",
      },
    ],
    riskContext: {
      microCanaryStatus: "micro_canary_ready",
    },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes("tiny_live_micro_canary_stage_insufficient"));
});

test("tiny_live_canary blocked when amount exceeds tinyLivePerTxUsd", async () => {
  const intent = buildTinyLiveCanaryIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    amountUsd: 100,
    microCanaryStatus: "minimal_live_proof_exists",
    now: "2026-04-22T00:00:00.000Z",
  });
  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intent: { intentType: "emergency_unwind" },
        lifecycle: { stage: "confirmed" },
        observedAt: "2026-04-22T00:00:00.000Z",
      },
    ],
    riskContext: {
      microCanaryStatus: "minimal_live_proof_exists",
    },
    now: "2026-04-22T00:00:00.000Z",
  });
  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes("strategy_per_tx_cap_exceeded"));
});
