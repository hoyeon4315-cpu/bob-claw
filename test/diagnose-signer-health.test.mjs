import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkSignerProcesses,
  classifySignerHealth,
  diagnoseSignerHealth,
} from "../src/executor/signer/health-check.mjs";

test("classifySignerHealth returns the first hard blocker in restart-safe order", () => {
  assert.equal(classifySignerHealth({ process: { daemonRunning: false } }), "process_down");
  assert.equal(classifySignerHealth({
    process: { daemonRunning: true },
    heartbeat: { stale: true },
  }), "heartbeat_stale");
  assert.equal(classifySignerHealth({
    process: { daemonRunning: true },
    heartbeat: { stale: false },
    socket: { ok: false },
  }), "socket_unreachable");
  assert.equal(classifySignerHealth({
    process: { daemonRunning: true },
    heartbeat: { stale: false },
    socket: { ok: true },
    rpc: { chains: [{ chain: "base", ok: false }] },
  }), "rpc_unreachable_base");
  assert.equal(classifySignerHealth({
    process: { daemonRunning: true },
    heartbeat: { stale: false },
    socket: { ok: true },
    rpc: { chains: [{ chain: "base", ok: true }] },
    btcRpc: { ok: false },
  }), "btc_rpc_unreachable");
  assert.equal(classifySignerHealth({
    process: { daemonRunning: true },
    heartbeat: { stale: false },
    socket: { ok: true },
    rpc: { chains: [{ chain: "base", ok: true }] },
    btcRpc: { ok: true },
    nonceManagers: { ok: false },
  }), "nonce_manager_error");
  assert.equal(classifySignerHealth({
    process: { daemonRunning: true },
    heartbeat: { stale: false },
    socket: { ok: true },
    rpc: { chains: [{ chain: "base", ok: true }] },
    btcRpc: { ok: true },
    nonceManagers: { ok: true },
  }), "clean");
});

test("diagnoseSignerHealth combines fixtures into a clean report without touching keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-signer-health-"));
  const heartbeatPath = join(root, "executor-heartbeat.json");
  const auditPath = join(root, "logs", "signer-audit.jsonl");
  await writeFile(heartbeatPath, JSON.stringify({
    schemaVersion: 1,
    updatedAt: "2026-05-09T00:00:00.000Z",
    pid: 123,
    socketPath: join(root, "signer.sock"),
    status: "listening",
    lastCommand: "health",
  }), "utf8");
  await mkdir(join(root, "logs"), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify({
    timestamp: "2026-05-09T00:00:01.000Z",
    lifecycle: { stage: "confirmed" },
  })}\n`, "utf8");

  try {
    const report = await diagnoseSignerHealth({
      cwd: root,
      env: {
        EXECUTOR_HEARTBEAT_PATH: heartbeatPath,
        EXECUTOR_SIGNER_SOCKET_PATH: join(root, "signer.sock"),
      },
      now: "2026-05-09T00:00:05.000Z",
      processChecker: async () => ({
        daemonRunning: true,
        watchdogRunning: true,
        matches: [],
      }),
      signerHealthReader: async () => ({
        status: "ok",
        pid: 123,
        nonceManagers: {
          ok: true,
          chains: [{ chain: "base", activeProviderIndex: 0, providerCount: 2, cachedNextNonce: null }],
        },
      }),
      evmRpcPinger: async () => ({
        chains: [{ chain: "base", ok: true, chainId: "0x2105", latencyMs: 1 }],
      }),
      btcRpcPinger: async () => ({
        ok: true,
        source: "https://mempool.test/api",
        latencyMs: 1,
      }),
    });

    assert.equal(report.cause, "clean");
    assert.equal(report.heartbeat.ageMs, 5_000);
    assert.equal(report.socket.ok, true);
    assert.equal(report.signerAudit.lastStage, "confirmed");
    assert.equal(report.signerAudit.lastTimestamp, "2026-05-09T00:00:01.000Z");
    assert.equal(JSON.stringify(report).includes("privateKey"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkSignerProcesses falls back to ps when pgrep cannot read the process list", async () => {
  const calls = [];
  const processes = await checkSignerProcesses({
    execFileImpl: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "pgrep") {
        const error = new Error("Cannot get process list");
        error.code = 3;
        throw error;
      }
      assert.equal(cmd, "ps");
      return {
        stdout: [
          "93538 /opt/homebrew/bin/node /Users/love/BOB Claw/src/executor/signer/daemon.mjs",
          "93536 /opt/homebrew/bin/node /Users/love/BOB Claw/src/cli/run-executor-watchdog.mjs",
        ].join("\n"),
      };
    },
  });

  assert.equal(processes.daemonRunning, true);
  assert.equal(processes.watchdogRunning, true);
  assert.equal(processes.method, "pgrep+ps");
  assert.equal(calls.some(([cmd]) => cmd === "ps"), true);
});

test("process check unavailability does not mask a healthy heartbeat and socket", async () => {
  const processes = await checkSignerProcesses({
    execFileImpl: async () => {
      const error = new Error("spawn EPERM");
      error.code = "EPERM";
      throw error;
    },
  });

  assert.equal(processes.unavailable, true);
  assert.equal(processes.daemonRunning, null);
  assert.equal(classifySignerHealth({
    process: processes,
    heartbeat: { stale: false },
    socket: { ok: true },
    rpc: { chains: [] },
    btcRpc: { ok: true },
    nonceManagers: { ok: true },
  }), "clean");
});
