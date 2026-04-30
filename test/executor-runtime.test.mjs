import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
