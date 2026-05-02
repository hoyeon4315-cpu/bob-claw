import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendKillSwitchAuditRecord,
  buildKillSwitchAuditRecord,
  fileExists,
  resolveKillSwitchAuditPath,
} from "../policy/kill-switch.mjs";
import { evaluateWatchdogHeartbeat, readHeartbeat } from "./heartbeat.mjs";

export async function enforceWatchdog({
  heartbeatPath = "./state/executor-heartbeat.json",
  killSwitchPath = process.env.KILL_SWITCH_PATH || null,
  ttlMs = 60_000,
  existsImpl = fileExists,
  auditPath = resolveKillSwitchAuditPath(),
  auditAppendImpl = appendKillSwitchAuditRecord,
  alertImpl = async () => {},
  now = new Date().toISOString(),
} = {}) {
  const heartbeat = await readHeartbeat(heartbeatPath);
  const evaluation = evaluateWatchdogHeartbeat({ heartbeat, now, ttlMs });
  const killSwitchPresent = killSwitchPath ? await existsImpl(killSwitchPath) : false;
  let killSwitchWritten = false;

  if (evaluation.stale && killSwitchPath && !killSwitchPresent) {
    await mkdir(dirname(killSwitchPath), { recursive: true });
    await writeFile(killSwitchPath, `${now}\n`, "utf8");
    killSwitchWritten = true;
    await auditAppendImpl(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: "watchdog_heartbeat_stale",
        actor: "executor:watchdog",
        killSwitchPath,
        previousState: "running",
        now,
        metadata: {
          source: "watchdog",
          heartbeatPath,
          status: evaluation.status,
          ageMs: evaluation.ageMs,
          ttlMs: evaluation.ttlMs,
        },
      }),
      { auditPath },
    );
    await alertImpl({
      kind: "watchdog_halt",
      heartbeatPath,
      killSwitchPath,
      evaluation,
    });
  }

  return {
    heartbeat,
    evaluation,
    halted: evaluation.stale && Boolean(killSwitchPath),
    killSwitchPresent: killSwitchPresent || killSwitchWritten,
    killSwitchWritten,
  };
}
