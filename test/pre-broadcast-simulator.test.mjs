import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  evaluatePreBroadcastSimulation,
  featureEnabled,
} from "../src/executor/policy/pre-broadcast-simulator.mjs";

test("featureEnabled returns true only when preBroadcastSimulationEnabled is explicitly true", () => {
  assert.equal(featureEnabled({ preBroadcastSimulationEnabled: true }), true);
  assert.equal(featureEnabled({ preBroadcastSimulationEnabled: false }), false);
  assert.equal(featureEnabled({}), false);
  assert.equal(featureEnabled(null), false);
  assert.equal(featureEnabled(undefined), false);
});

test("revert caught blocks with pre_broadcast_simulation_revert and appends audit", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-pre-broadcast-"));
  try {
    const auditPath = join(root, "logs", "pre-broadcast-simulation-audit.jsonl");
    const provider = {
      async call() {
        const error = new Error("execution reverted: insufficient allowance");
        error.code = "CALL_EXCEPTION";
        throw error;
      },
    };
    const intent = {
      strategyId: "test-strategy",
      chain: "base",
      to: "0x1234567890123456789012345678901234567890",
      data: "0x",
      value: 0,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const profile = { preBroadcastSimulationEnabled: true };
    const now = "2026-05-10T00:00:00.000Z";

    const result = await evaluatePreBroadcastSimulation({
      intent,
      profile,
      provider,
      now,
      auditPath,
    });

    assert.equal(result.policy, "pre_broadcast_simulation");
    assert.equal(result.observedAt, now);
    assert.equal(result.decision, "BLOCK");
    assert.deepEqual(result.blockers, ["pre_broadcast_simulation_revert"]);
    assert.equal(result.metrics.simulated, true);
    assert.equal(result.metrics.reverted, true);

    const raw = await readFile(auditPath, "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.ts, now);
    assert.equal(record.strategyId, "test-strategy");
    assert.equal(record.chain, "base");
    assert.equal(record.decision, "BLOCK");
    assert.equal(record.blocker, "pre_broadcast_simulation_revert");
    assert.equal(record.errorCode, "CALL_EXCEPTION");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("success pass allows", async () => {
  const provider = {
    async call() {
      return "0x";
    },
  };
  const intent = {
    strategyId: "test-strategy",
    chain: "base",
    to: "0x1234567890123456789012345678901234567890",
    data: "0x",
    value: 0,
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const profile = { preBroadcastSimulationEnabled: true };
  const now = "2026-05-10T00:00:00.000Z";

  const result = await evaluatePreBroadcastSimulation({
    intent,
    profile,
    provider,
    now,
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.metrics.simulated, true);
  assert.equal(result.metrics.reverted, false);
});

test("feature flag off allows even if provider would revert", async () => {
  const provider = {
    async call() {
      throw new Error("should not be called");
    },
  };
  const intent = {
    strategyId: "test-strategy",
    chain: "base",
    to: "0x1234567890123456789012345678901234567890",
    data: "0x",
    value: 0,
  };
  const profile = { id: "safety_first" };
  const now = "2026-05-10T00:00:00.000Z";

  const result = await evaluatePreBroadcastSimulation({
    intent,
    profile,
    provider,
    now,
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.metrics.simulated, false);
});

test("missing provider and no RPC config blocks with pre_broadcast_simulation_unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-pre-broadcast-"));
  try {
    const auditPath = join(root, "logs", "pre-broadcast-simulation-audit.jsonl");
    const intent = {
      strategyId: "test-strategy",
      chain: "unknown_chain_xyz",
      to: "0x1234567890123456789012345678901234567890",
      data: "0x",
      value: 0,
    };
    const profile = { preBroadcastSimulationEnabled: true };
    const now = "2026-05-10T00:00:00.000Z";

    const result = await evaluatePreBroadcastSimulation({
      intent,
      profile,
      now,
      auditPath,
    });

    assert.equal(result.decision, "BLOCK");
    assert.deepEqual(result.blockers, ["pre_broadcast_simulation_unavailable"]);
    assert.equal(result.metrics.simulated, false);
    assert.equal(result.metrics.providerAvailable, false);

    const raw = await readFile(auditPath, "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.decision, "BLOCK");
    assert.equal(record.blocker, "pre_broadcast_simulation_unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
