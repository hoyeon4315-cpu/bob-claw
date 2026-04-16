import { access } from "node:fs/promises";
import { getEnv, getNumberEnv } from "../config/env.mjs";
import { DEFAULT_SIGNER_SOCKET_PATH } from "../executor/signer/client.mjs";
import { evaluateWatchdogHeartbeat, readHeartbeat } from "../executor/watchdog/heartbeat.mjs";

async function pathExists(path) {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function summarizeExecutorRuntime({
  heartbeat = null,
  heartbeatPath = "./state/executor-heartbeat.json",
  signerSocketPath = DEFAULT_SIGNER_SOCKET_PATH,
  signerSocketPresent = false,
  ttlMs = 60_000,
  now = new Date().toISOString(),
} = {}) {
  const watchdog = evaluateWatchdogHeartbeat({ heartbeat, now, ttlMs });
  const runtimeStatus = watchdog.status === "healthy"
    ? signerSocketPresent
      ? "healthy"
      : "socket_missing"
    : watchdog.status;

  return {
    heartbeatPath,
    observedAt: heartbeat?.updatedAt || null,
    heartbeatPresent: Boolean(heartbeat),
    pid: heartbeat?.pid ?? null,
    signerSocketPath,
    signerSocketPresent,
    signerStatus: heartbeat?.status || (signerSocketPresent ? "socket_present" : "missing_socket"),
    lastCommand: heartbeat?.lastCommand || null,
    watchdog,
    runtimeStatus,
    available: runtimeStatus === "healthy",
  };
}

export async function loadExecutorRuntime({
  now = new Date().toISOString(),
  heartbeatPath = getEnv("EXECUTOR_HEARTBEAT_PATH", "./state/executor-heartbeat.json"),
  signerSocketPath = getEnv("EXECUTOR_SIGNER_SOCKET_PATH", DEFAULT_SIGNER_SOCKET_PATH),
  ttlMs = getNumberEnv("EXECUTOR_WATCHDOG_TTL_MS", 60_000),
} = {}) {
  const heartbeat = await readHeartbeat(heartbeatPath);
  const effectiveSocketPath = heartbeat?.socketPath || signerSocketPath;
  const signerSocketPresent = await pathExists(effectiveSocketPath);
  return summarizeExecutorRuntime({
    heartbeat,
    heartbeatPath,
    signerSocketPath: effectiveSocketPath,
    signerSocketPresent,
    ttlMs,
    now,
  });
}
