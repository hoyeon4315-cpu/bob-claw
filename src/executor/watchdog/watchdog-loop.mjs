import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileExists } from "../policy/kill-switch.mjs";
import { evaluateWatchdogHeartbeat, readHeartbeat } from "./heartbeat.mjs";

export async function enforceWatchdog({
  heartbeatPath = "./state/executor-heartbeat.json",
  killSwitchPath = process.env.KILL_SWITCH_PATH || null,
  ttlMs = 60_000,
  existsImpl = fileExists,
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
