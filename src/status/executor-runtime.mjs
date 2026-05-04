import { access } from "node:fs/promises";
import { getEnv, getNumberEnv } from "../config/env.mjs";
import {
  readKillSwitchStatus,
  resolveKillSwitchAuditPath,
  resolveKillSwitchPath,
} from "../executor/policy/kill-switch.mjs";
import { DEFAULT_SIGNER_SOCKET_PATH } from "../executor/signer/client.mjs";
import { readSignerHealth } from "../executor/signer/client.mjs";
import { evaluateWatchdogHeartbeat, readHeartbeat, writeHeartbeat } from "../executor/watchdog/heartbeat.mjs";

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
  killSwitch = null,
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
    killSwitch: killSwitch
      ? {
          killSwitchPath: killSwitch.killSwitchPath || null,
          halted: killSwitch.halted === true,
          fileMtime: killSwitch.fileMtime || null,
          activeReason: killSwitch.activeReason || null,
          activeActor: killSwitch.activeActor || null,
          activeSince: killSwitch.activeSince || null,
          triggers: Array.isArray(killSwitch.triggers) ? killSwitch.triggers : [],
          lastAudit: killSwitch.lastAudit || null,
        }
      : null,
    watchdog,
    runtimeStatus,
    available: runtimeStatus === "healthy",
  };
}

export async function loadExecutorRuntime({
  now = new Date().toISOString(),
  heartbeatPath = getEnv("EXECUTOR_HEARTBEAT_PATH", "./state/executor-heartbeat.json"),
  signerSocketPath = getEnv("EXECUTOR_SIGNER_SOCKET_PATH", DEFAULT_SIGNER_SOCKET_PATH),
  killSwitchPath = getEnv("KILL_SWITCH_PATH", resolveKillSwitchPath()),
  killSwitchAuditPath = getEnv("KILL_SWITCH_AUDIT_PATH", resolveKillSwitchAuditPath()),
  ttlMs = getNumberEnv("EXECUTOR_WATCHDOG_TTL_MS", 60_000),
  healthReader = readSignerHealth,
  heartbeatReader = readHeartbeat,
  heartbeatWriter = writeHeartbeat,
  killSwitchStatusReader = readKillSwitchStatus,
} = {}) {
  let heartbeat = await heartbeatReader(heartbeatPath);
  const effectiveSocketPath = heartbeat?.socketPath || signerSocketPath;
  const signerSocketPresent = await pathExists(effectiveSocketPath);
  const heartbeatState = evaluateWatchdogHeartbeat({ heartbeat, now, ttlMs });

  if (signerSocketPresent && heartbeatState.status !== "healthy") {
    try {
      const health = await healthReader({
        socketPath: effectiveSocketPath,
        timeoutMs: Math.min(ttlMs, 5_000),
      });
      heartbeat = await heartbeatWriter({
        path: heartbeatPath,
        now,
        metadata: {
          pid: health?.pid ?? heartbeat?.pid ?? null,
          socketPath: effectiveSocketPath,
          status: "listening",
          lastCommand: "health",
        },
      });
    } catch {
      // Keep the stale/missing heartbeat result when the socket cannot answer health checks.
    }
  }
  const killSwitch = await killSwitchStatusReader({
    killSwitchPath,
    auditPath: killSwitchAuditPath,
  });

  return summarizeExecutorRuntime({
    heartbeat,
    heartbeatPath,
    signerSocketPath: effectiveSocketPath,
    signerSocketPresent,
    ttlMs,
    now,
    killSwitch,
  });
}
