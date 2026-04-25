import { access } from "node:fs/promises";
import { constants } from "node:fs";

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readExecutionGuards({ emergencyStopPath, liveModePath, mode = "dry_run" }) {
  const [emergencyStopActive, liveModeEnabled] = await Promise.all([fileExists(emergencyStopPath), fileExists(liveModePath)]);

  const blocked =
    emergencyStopActive ||
    (mode === "live" && !liveModeEnabled);

  return {
    mode,
    emergencyStopPath,
    emergencyStopActive,
    liveModePath,
    liveModeEnabled,
    blocked,
    reasons: [
      ...(emergencyStopActive ? ["emergency_stop_active"] : []),
      ...(mode === "live" && !liveModeEnabled ? ["live_mode_not_enabled"] : []),
    ],
  };
}
