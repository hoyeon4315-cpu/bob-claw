import { access } from "node:fs/promises";
import { getEnv, getNumberEnv } from "../config/env.mjs";
import {
  readKillSwitchStatus,
  resolveKillSwitchAuditPath,
  resolveKillSwitchPath,
} from "../executor/policy/kill-switch.mjs";
import {
  DEFAULT_HEARTBEAT_RELATIVE_PATH,
  resolveDefaultHeartbeatPath,
  resolveDefaultSignerSocketPath,
} from "../executor/runtime-paths.mjs";
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
  heartbeatPath = DEFAULT_HEARTBEAT_RELATIVE_PATH,
  signerSocketPath = DEFAULT_SIGNER_SOCKET_PATH,
  signerSocketPresent = false,
  signerSocketResponding = undefined,
  signerHealthError = null,
  killSwitch = null,
  ttlMs = 60_000,
  now = new Date().toISOString(),
} = {}) {
  const watchdog = evaluateWatchdogHeartbeat({ heartbeat, now, ttlMs });
  const runtimeStatus =
    watchdog.status === "healthy"
      ? signerSocketPresent
        ? signerSocketResponding === false
          ? "socket_unreachable"
          : "healthy"
        : "socket_missing"
      : watchdog.status;

  return {
    heartbeatPath,
    observedAt: heartbeat?.updatedAt || null,
    heartbeatPresent: Boolean(heartbeat),
    pid: heartbeat?.pid ?? null,
    signerSocketPath,
    signerSocketPresent,
    signerSocketResponding,
    signerHealthError,
    signerStatus:
      signerSocketResponding === false
        ? "unreachable"
        : heartbeat?.status || (signerSocketPresent ? "socket_present" : "missing_socket"),
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
  heartbeatPath = getEnv("EXECUTOR_HEARTBEAT_PATH", resolveDefaultHeartbeatPath()),
  signerSocketPath = getEnv("EXECUTOR_SIGNER_SOCKET_PATH", resolveDefaultSignerSocketPath()),
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
  let signerSocketResponding = undefined;
  let signerHealthError = null;

  if (signerSocketPresent) {
    try {
      const health = await healthReader({
        socketPath: effectiveSocketPath,
        timeoutMs: Math.min(ttlMs, 5_000),
      });
      signerSocketResponding = health?.status === "ok";
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
    } catch (error) {
      signerSocketResponding = false;
      signerHealthError = error.message;
      // Keep the existing heartbeat, but do not report the runtime as healthy.
    }
  } else if (heartbeatState.status === "healthy") {
    signerSocketResponding = false;
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
    signerSocketResponding,
    signerHealthError,
    ttlMs,
    now,
    killSwitch,
  });
}
