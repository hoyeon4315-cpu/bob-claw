/**
 * Phase 5 — Aggressive Velocity Sleeve Capital Target
 *
 * Provides the dedicated capital slice (25-35% per committed config)
 * for the Aggressive Velocity Sleeve.
 *
 * This is intentionally a thin wrapper so the sleeve has its own
 * first-class capital target, separate from the scored water-fill
 * used by the conservative core lanes (loose coupling).
 *
 * Consumers:
 * - Capital refill planner / autopilot
 * - Sleeve's own internal allocator (future, driven by manifests)
 * - Reports (capital-audit, aggressive-sleeve-status)
 *
 * All numbers come from the single source of truth:
 *   src/config/aggressive-velocity/config.mjs
 */

import {
  computeSleeveTargetBtc,
  computeSleeveTargetUsd,
  AGGRESSIVE_VELOCITY_SLEEVE_ID,
  AGGRESSIVE_VELOCITY_CONFIG,
} from "../../config/aggressive-velocity/config.mjs";

/**
 * Returns the committed target capital for the Aggressive Velocity Sleeve.
 * @param {object} params
 * @param {number} params.operatingCapitalBtc - current available operating capital in BTC
 * @param {number} [params.operatingCapitalUsd] - optional USD equivalent
 */
export function getAggressiveVelocitySleeveTarget({
  operatingCapitalBtc,
  operatingCapitalUsd = null,
} = {}) {
  const targetBtc = computeSleeveTargetBtc(operatingCapitalBtc);
  const targetUsd = operatingCapitalUsd != null
    ? computeSleeveTargetUsd(operatingCapitalUsd)
    : null;

  return {
    sleeveId: AGGRESSIVE_VELOCITY_SLEEVE_ID,
    targetBtc: parseFloat(targetBtc.toFixed(8)),
    targetUsd: targetUsd != null ? parseFloat(targetUsd.toFixed(2)) : null,
    allocationPct: AGGRESSIVE_VELOCITY_CONFIG.targetAllocation.currentTargetPct,
    source: "src/config/aggressive-velocity/config.mjs (Phase 5 committed)",
  };
}

export { AGGRESSIVE_VELOCITY_SLEEVE_ID };
