import { access } from "node:fs/promises";
import { constants } from "node:fs";

export function resolveKillSwitchPath(env = process.env) {
  return env.KILL_SWITCH_PATH || null;
}

export async function fileExists(path) {
  if (!path) return false;
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function checkKillSwitch({
  killSwitchPath = resolveKillSwitchPath(),
  existsImpl = fileExists,
  now = new Date().toISOString(),
} = {}) {
  const exists = killSwitchPath ? await existsImpl(killSwitchPath) : false;
  return {
    policy: "kill_switch",
    observedAt: now,
    decision: exists ? "BLOCK" : "ALLOW",
    blockers: exists ? ["kill_switch_present"] : [],
    killSwitchPath,
  };
}
