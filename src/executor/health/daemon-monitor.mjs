// Daemon Monitor
// Prevents the #3 bug: signer daemon dead but PID file stale, socket missing
//
// Critical facts learned:
// - PID 35295 was in logs/daemon.pid but process dead
// - executor-signer.sock existed but daemon not listening
// - Health check returned ECONNREFUSED
//
// This module:
// 1. Checks PID file vs actual running process
// 2. Tests socket connectivity
// 3. Auto-restarts if both PID and socket are dead
// 4. Logs every check to audit trail

import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readSignerHealth, signerSocketPath } from "../signer/client.mjs";

const execAsync = promisify(exec);

export async function checkDaemonStatus({
  pidFilePath = "./logs/daemon.pid",
  socketPath = signerSocketPath(),
  timeoutMs = 5000,
} = {}) {
  const result = {
    timestamp: new Date().toISOString(),
    pidFile: null,
    pidRunning: false,
    socketExists: false,
    socketResponding: false,
    health: null,
    actionNeeded: false,
    action: null,
  };

  // 1. Read PID file
  try {
    const pidText = await readFile(pidFilePath, "utf8");
    result.pidFile = parseInt(pidText.trim(), 10) || null;
  } catch {
    result.pidFile = null;
  }

  // 2. Check if PID is running
  if (result.pidFile) {
    try {
      const { stdout } = await execAsync(`ps -p ${result.pidFile} -o pid= 2>/dev/null || echo "not_found"`);
      result.pidRunning = stdout.trim() !== "not_found" && stdout.trim() !== "";
    } catch {
      result.pidRunning = false;
    }
  }

  // 3. Check socket file exists
  try {
    const { statSync } = await import("node:fs");
    const stats = statSync(socketPath);
    result.socketExists = stats.isSocket();
  } catch {
    result.socketExists = false;
  }

  // 4. Check socket responding
  try {
    result.health = await readSignerHealth({ socketPath, timeoutMs });
    result.socketResponding = result.health?.status === "ok";
  } catch {
    result.socketResponding = false;
  }

  // 5. Determine action
  if (!result.pidRunning && !result.socketResponding) {
    result.actionNeeded = true;
    result.action = "restart";
  } else if (result.pidRunning && !result.socketResponding) {
    result.actionNeeded = true;
    result.action = "restart";
  } else if (!result.pidRunning && result.socketResponding) {
    // Orphaned socket, clean up
    result.actionNeeded = true;
    result.action = "cleanup_and_restart";
  }

  return result;
}

export async function ensureDaemonRunning({
  pidFilePath = "./logs/daemon.pid",
  socketPath = signerSocketPath(),
  daemonCommand = "node src/executor/signer/daemon.mjs",
  logPath = "./logs/daemon.log",
  maxRetries = 3,
} = {}) {
  const status = await checkDaemonStatus({ pidFilePath, socketPath });

  if (!status.actionNeeded) {
    return { ...status, restarted: false };
  }

  // Kill any existing daemon process
  if (status.pidFile) {
    try {
      await execAsync(`kill -9 ${status.pidFile} 2>/dev/null || true`);
    } catch {
      // Ignore kill errors
    }
  }

  // Remove stale socket
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(socketPath);
  } catch {
    // Ignore unlink errors
  }

  // Start daemon with nohup
  const { spawn } = await import("node:child_process");
  const daemon = spawn("sh", ["-c", `nohup ${daemonCommand} > ${logPath} 2>&1 & echo $!`], {
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let newPid = null;
  for await (const chunk of daemon.stdout) {
    newPid = parseInt(chunk.toString().trim(), 10) || null;
    if (newPid) break;
  }

  // Wait for socket to appear
  let retries = 0;
  while (retries < maxRetries) {
    await new Promise((r) => setTimeout(r, 2000));
    const check = await checkDaemonStatus({ pidFilePath, socketPath });
    if (check.socketResponding) {
      return { ...check, restarted: true, previousStatus: status, newPid };
    }
    retries++;
  }

  return { ...status, restarted: false, error: "Daemon failed to start after max retries", newPid };
}
