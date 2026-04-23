// BOB Gateway availability policy.
//
// Purpose: deterministic kill-switch for BOB Gateway transport lane. The
// Gateway team can pause routes at any time; the planner and policy engine
// must refuse to emit Gateway-method intents while the pause is in effect
// so that the executor does not loop on a dead provider.
//
// Two disable mechanisms combine (OR):
//   1. Committed config flag `GATEWAY_POLICY.enabled`. A committed diff
//      flips this to disable Gateway platform-wide (e.g. the operator
//      knows the team has paused all routes).
//   2. Runtime signal file at `state/gateway.disabled`. Created by the
//      health probe (`npm run probe:gateway-health`) when Gateway quotes
//      fail, and cleared automatically on first successful probe. This
//      allows live recovery without a commit while still being a deterministic
//      file-based check (same pattern as KILL_SWITCH_PATH).
//
// When disabled, `funding-source-planner` marks cross_chain Gateway-backed
// methods as unsupported with reason `gateway_operator_paused`, forcing
// the chooser to fall through to alternate bridge providers or manual
// funding. This prevents the gas-float-keeper from defaulting to Gas.Zip
// just because every other candidate depends on Gateway.

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

export const GATEWAY_DISABLED_STATE_FILE = "state/gateway.disabled";

export const GATEWAY_POLICY = Object.freeze({
  enabled: true,
  apiBase: "https://gateway-api.gobob.xyz",
  pausedReason: null,
  pausedSince: null,
  stateFile: GATEWAY_DISABLED_STATE_FILE,
  healthProbeIntervalSeconds: 300,
  consecutiveFailuresToDisable: 2,
});

async function stateFileExists(path) {
  if (!path) return false;
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function resolveGatewayAvailability({
  policy = GATEWAY_POLICY,
  existsImpl = stateFileExists,
  cwd = process.cwd(),
  now = new Date().toISOString(),
} = {}) {
  if (!policy?.enabled) {
    return {
      available: false,
      reason: "gateway_committed_policy_disabled",
      pausedReason: policy?.pausedReason || null,
      pausedSince: policy?.pausedSince || null,
      observedAt: now,
    };
  }
  const stateFilePath = policy?.stateFile ? resolve(cwd, policy.stateFile) : null;
  const runtimeDisabled = stateFilePath ? await existsImpl(stateFilePath) : false;
  if (runtimeDisabled) {
    return {
      available: false,
      reason: "gateway_runtime_disabled_state_file_present",
      stateFile: stateFilePath,
      observedAt: now,
    };
  }
  return { available: true, reason: null, observedAt: now };
}

export function isGatewayMethod(method) {
  const normalized = String(method || "").toLowerCase();
  return (
    normalized === "cross_chain_bridge_or_swap" ||
    normalized === "cross_chain_swap_via_btc_intermediate" ||
    normalized.startsWith("gateway_")
  );
}
