import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadExecutorRuntime } from "../src/status/executor-runtime.mjs";
import { writeHeartbeat } from "../src/executor/watchdog/heartbeat.mjs";

test("executor runtime refreshes a stale heartbeat when signer health responds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-executor-runtime-"));
  const heartbeatPath = join(dir, "executor-heartbeat.json");
  const socketPath = join(dir, "executor-signer.sock");

  await writeHeartbeat({
    path: heartbeatPath,
    now: "2026-04-19T04:00:00.000Z",
    metadata: {
      pid: 12345,
      socketPath,
      status: "listening",
      lastCommand: "sign_and_broadcast",
    },
  });

  await writeFile(socketPath, "");

  const runtime = await loadExecutorRuntime({
    now: "2026-04-19T04:05:00.000Z",
    heartbeatPath,
    signerSocketPath: socketPath,
    ttlMs: 60_000,
    healthReader: async () => ({
      status: "ok",
      pid: 99999,
      socketPath,
    }),
  });

  assert.equal(runtime.runtimeStatus, "healthy");
  assert.equal(runtime.available, true);
  assert.equal(runtime.pid, 99999);
  assert.equal(runtime.watchdog.status, "healthy");
  assert.equal(runtime.killSwitch.halted, false);
});

test("heartbeat writer survives same-millisecond concurrent writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-heartbeat-race-"));
  const heartbeatPath = join(dir, "executor-heartbeat.json");
  const originalNow = Date.now;
  Date.now = () => 1777292627147;
  try {
    await Promise.all([
      writeHeartbeat({ path: heartbeatPath, metadata: { lastCommand: "health" } }),
      writeHeartbeat({ path: heartbeatPath, metadata: { lastCommand: "sign_and_broadcast" } }),
    ]);
  } finally {
    Date.now = originalNow;
  }
});

test("executor runtime stays stale when socket health cannot be refreshed", async () => {
  const runtime = await loadExecutorRuntime({
    now: "2026-04-19T04:05:00.000Z",
    heartbeatPath: join(tmpdir(), "missing-heartbeat.json"),
    signerSocketPath: join(tmpdir(), "missing-socket.sock"),
    ttlMs: 60_000,
    healthReader: async () => {
      throw new Error("unreachable");
    },
  });

  assert.equal(runtime.available, false);
  assert.equal(runtime.runtimeStatus, "missing");
});

test("executor runtime exposes path-filtered kill-switch state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-executor-runtime-kill-"));
  const heartbeatPath = join(dir, "executor-heartbeat.json");
  const socketPath = join(dir, "executor-signer.sock");
  const killSwitchPath = join(dir, "KILL_SWITCH");
  const auditPath = join(dir, "logs", "kill-switch-audit.jsonl");

  await writeHeartbeat({
    path: heartbeatPath,
    now: "2026-05-04T21:14:19.325Z",
    metadata: {
      pid: 63396,
      socketPath,
      status: "listening",
      lastCommand: "health",
    },
  });
  await writeFile(socketPath, "");
  await writeFile(killSwitchPath, JSON.stringify({
    schemaVersion: 1,
    evaluatedAt: "2026-05-04T18:16:45.378Z",
    triggers: [
      {
        trigger: "failure_burst_per_strategy",
        strategyId: "gateway-btc-funding-transfer",
        failureCount: 6,
        threshold: 5,
        windowMs: 300000,
      },
    ],
    killSwitchPath,
    alreadyArmed: false,
  }, null, 2));
  await mkdir(join(dir, "logs"), { recursive: true });
  await writeFile(auditPath, [
    JSON.stringify({
      ts: "2026-05-04T18:16:45.378Z",
      action: "halt",
      reason: "auto_kill:failure_burst_per_strategy",
      actor: "risk:auto-kill",
      killSwitchPath,
      previousState: "running",
    }),
    JSON.stringify({
      ts: "2026-05-04T21:10:26.618Z",
      action: "halt",
      reason: "watchdog_heartbeat_stale",
      actor: "executor:watchdog",
      killSwitchPath: join(dir, "TEST_ONLY.kill"),
      previousState: "running",
    }),
    "",
  ].join("\n"));

  const runtime = await loadExecutorRuntime({
    now: "2026-05-04T21:15:00.000Z",
    heartbeatPath,
    signerSocketPath: socketPath,
    killSwitchPath,
    killSwitchAuditPath: auditPath,
    ttlMs: 60_000,
    healthReader: async () => ({
      status: "ok",
      pid: 63396,
      socketPath,
    }),
  });

  assert.equal(runtime.available, true);
  assert.equal(runtime.killSwitch.halted, true);
  assert.equal(runtime.killSwitch.activeReason, "auto_kill:failure_burst_per_strategy");
  assert.equal(runtime.killSwitch.activeActor, "risk:auto-kill");
  assert.equal(runtime.killSwitch.lastAudit.reason, "auto_kill:failure_burst_per_strategy");
  assert.equal(runtime.killSwitch.triggers[0].strategyId, "gateway-btc-funding-transfer");
});
