import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTinyLiveCanaryPolicy } from "../src/executor/policy/tiny-live-canary-policy.mjs";

test("tiny_live_canary ALLOW when all conditions met", () => {
  const result = evaluateTinyLiveCanaryPolicy({
    intent: { intentType: "tiny_live_canary", strategyId: "wrapped-btc-loop-base-moonwell" },
    strategyCaps: {
      leverage: {
        emergencyUnwindPath: ["repay borrow asset", "withdraw collateral"],
      },
    },
    microCanaryStatus: "minimal_live_proof_exists",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intent: { intentType: "emergency_unwind" },
        lifecycle: { stage: "confirmed" },
        observedAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.requiresTinyLive, true);
});

test("tiny_live_canary BLOCK when microCanaryStatus insufficient", () => {
  const result = evaluateTinyLiveCanaryPolicy({
    intent: { intentType: "tiny_live_canary", strategyId: "wrapped-btc-loop-base-moonwell" },
    strategyCaps: {
      leverage: {
        emergencyUnwindPath: ["repay borrow asset", "withdraw collateral"],
      },
    },
    microCanaryStatus: "micro_canary_ready",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intent: { intentType: "emergency_unwind" },
        lifecycle: { stage: "confirmed" },
        observedAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("tiny_live_micro_canary_stage_insufficient"));
});

test("tiny_live_canary BLOCK when emergencyUnwindPath missing", () => {
  const result = evaluateTinyLiveCanaryPolicy({
    intent: { intentType: "tiny_live_canary", strategyId: "wrapped-btc-loop-base-moonwell" },
    strategyCaps: { leverage: {} },
    microCanaryStatus: "minimal_live_proof_exists",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        intent: { intentType: "emergency_unwind" },
        lifecycle: { stage: "confirmed" },
        observedAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("tiny_live_emergency_unwind_path_missing"));
});

test("tiny_live_canary BLOCK when emergency_unwind not proven in 24h", () => {
  const result = evaluateTinyLiveCanaryPolicy({
    intent: { intentType: "tiny_live_canary", strategyId: "wrapped-btc-loop-base-moonwell" },
    strategyCaps: {
      leverage: {
        emergencyUnwindPath: ["repay borrow asset", "withdraw collateral"],
      },
    },
    microCanaryStatus: "minimal_live_proof_exists",
    auditRecords: [],
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("tiny_live_emergency_unwind_not_proven"));
});

test("non-tiny_live_canary intent returns ALLOW immediately", () => {
  const result = evaluateTinyLiveCanaryPolicy({
    intent: { intentType: "entry", strategyId: "wrapped-btc-loop-base-moonwell" },
    strategyCaps: {},
    microCanaryStatus: "not_started",
    auditRecords: [],
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.requiresTinyLive, false);
});
