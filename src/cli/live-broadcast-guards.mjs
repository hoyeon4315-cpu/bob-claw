import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolveKillSwitchPath } from "../executor/policy/kill-switch.mjs";
import { resolveDevLockPath } from "../runtime/dev-lock.mjs";

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

export function hasLiveBroadcastReadyStrategy(strategyTickStatus = null) {
  return (strategyTickStatus?.strategies || []).some((row) =>
    row?.layerStatus?.runtimeExecutable === true || row?.policyReadiness?.policyOk === true,
  );
}

export async function readLiveBroadcastGlobalGuards({
  execute = false,
  strategyTickStatus = null,
  killSwitchPath = resolveKillSwitchPath(),
  devLockPath = resolveDevLockPath(),
} = {}) {
  const blockers = [];
  const killSwitchActive = await fileExists(killSwitchPath);
  const devLockActive = execute && await fileExists(devLockPath);
  if (killSwitchActive) blockers.push("kill_switch_active");
  if (devLockActive) blockers.push("dev_lock_active");
  const readyForLiveBroadcast = hasLiveBroadcastReadyStrategy(strategyTickStatus);
  if (execute && readyForLiveBroadcast === false) blockers.push("readiness_guard_blocked");
  return { ok: blockers.length === 0, blockers, readyForLiveBroadcast, killSwitchActive, devLockActive };
}
