import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { resolveKillSwitchPath } from "../executor/policy/kill-switch.mjs";

async function fileExists(path) {
  if (!path) return false;
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function samePath(left, right) {
  if (!left || !right) return false;
  return resolve(left) === resolve(right);
}

export async function readExecutionGuards({
  emergencyStopPath,
  liveModePath,
  killSwitchPath = resolveKillSwitchPath(),
  mode = "dry_run",
}) {
  const [emergencyStopActive, liveModeEnabled, killSwitchActive] = await Promise.all([
    fileExists(emergencyStopPath),
    fileExists(liveModePath),
    fileExists(killSwitchPath),
  ]);
  const sharedStopPath = samePath(emergencyStopPath, killSwitchPath);

  const blocked =
    emergencyStopActive ||
    killSwitchActive ||
    (mode === "live" && !liveModeEnabled);

  return {
    mode,
    emergencyStopPath,
    emergencyStopActive,
    killSwitchPath,
    killSwitchActive,
    liveModePath,
    liveModeEnabled,
    blocked,
    reasons: [
      ...(killSwitchActive ? ["kill_switch_active"] : []),
      ...(emergencyStopActive && !sharedStopPath ? ["emergency_stop_active"] : []),
      ...(mode === "live" && !liveModeEnabled ? ["live_mode_not_enabled"] : []),
    ],
  };
}
