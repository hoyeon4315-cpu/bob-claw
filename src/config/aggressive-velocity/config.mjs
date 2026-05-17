/**
 * Aggressive Velocity Sleeve — Committed Central Configuration (Phase 4)
 *
 * Single source of truth for the `aggressive-velocity-v1` sleeve.
 * All policy gates, scanners, and capital logic must read from here (or derived functions).
 *
 * AGENTS.md rules:
 * - Caps, floors, and thresholds are committed here, not env/dashboard/chat.
 * - BTC/sats first.
 * - Exactly the 11 official Gateway destinations (imported from gateway-destinations).
 * - No runtime raising of limits.
 */

import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../gateway-destinations.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const AGGRESSIVE_VELOCITY_SLEEVE_ID = "aggressive-velocity-v1";

export const AGGRESSIVE_VELOCITY_CONFIG = deepFreeze({
  sleeveId: AGGRESSIVE_VELOCITY_SLEEVE_ID,
  label: "Diversified Aggressive Velocity Chaser v1",
  version: "2026-05-17-phase4",

  // Capital allocation (of operating capital dedicated to this sleeve)
  targetAllocation: {
    minPct: 0.25,
    maxPct: 0.35,
    currentTargetPct: 0.30, // operator can tune within min/max via committed PR only
  },

  // Policy gate floors (used by aggressive-velocity-policy)
  policy: {
    minExpectedNetBtcProfit: 0.00005, // 5e-5 BTC net after full round-trip (≈ $5.25 at $105k)
    minSimulatedCaptureRate: 0.65,
    maxSinglePositionPctOfSleeve: 28,
    requireExitAutomation: true,
    requireConcentrationOk: true,
  },

  // Exit rules (kept in sync with risk-exit-manager and accounting lib)
  exit: {
    minRealizedProfitToExitBtc: 0.00003,
    maxDrawdownFromPeakBtc: 0.00002,
    maxHoldHours: 48,
    minVelocityDecayPct: 35,
    emergencyExitOnILBps: 1200,
  },

  // Cost & EV modeling buffers (used by accounting library projections)
  costs: {
    entryGasBufferUsd: 2.5,
    defaultSlippageBps: 40,
    btcPriceAnchorUsd: 105000, // conservative anchor for small-capital projections
  },

  // Official surface (never duplicate the list)
  allowedChains: OFFICIAL_GATEWAY_DESTINATION_CHAINS, // exactly 11

  // Small-capital reality notes (informational, not gates)
  smallCapitalMode: {
    activeBelowUsd: 1000,
    note: "All thresholds are intentionally conservative for sub-$1k operating capital.",
  },

  // Future: per-chain overrides, reward token allowlist, etc.
  // Must be added via PR with tests + re-run of capital-audit + readiness.
});

// Convenience re-exports for hot-path consumers (policy, scanner, strategist)
export const MIN_EXPECTED_NET_BTC_PROFIT = AGGRESSIVE_VELOCITY_CONFIG.policy.minExpectedNetBtcProfit;
export const MAX_SINGLE_POSITION_PCT = AGGRESSIVE_VELOCITY_CONFIG.policy.maxSinglePositionPctOfSleeve;
export const EXIT_RULES = AGGRESSIVE_VELOCITY_CONFIG.exit;

/**
 * Returns the committed min net BTC floor for the sleeve policy gate.
 * This is the value the Phase 4 policy uses (instead of local constant).
 */
export function getAggressiveVelocityMinNetBtc() {
  return MIN_EXPECTED_NET_BTC_PROFIT;
}

/**
 * Phase 5: Compute the dedicated capital target for the Aggressive Velocity Sleeve.
 *
 * Uses the committed targetAllocation (25-35%) of the provided operating capital.
 * This is the amount the sleeve is allowed/expected to manage internally via its
 * own scanner + manifest + policy path.
 *
 * The conservative core lanes should be allocated the remainder (after core buffers).
 */
export function computeSleeveTargetBtc(operatingCapitalBtc) {
  if (!Number.isFinite(operatingCapitalBtc) || operatingCapitalBtc <= 0) {
    return 0;
  }
  const { minPct, maxPct, currentTargetPct } = AGGRESSIVE_VELOCITY_CONFIG.targetAllocation;
  const targetPct = currentTargetPct ?? ((minPct + maxPct) / 2);
  const clamped = Math.max(minPct, Math.min(maxPct, targetPct));
  return operatingCapitalBtc * clamped;
}

export function computeSleeveTargetUsd(operatingCapitalUsd) {
  // Same logic, USD version (for capital planning reports)
  if (!Number.isFinite(operatingCapitalUsd) || operatingCapitalUsd <= 0) return 0;
  const { minPct, maxPct, currentTargetPct } = AGGRESSIVE_VELOCITY_CONFIG.targetAllocation;
  const targetPct = currentTargetPct ?? ((minPct + maxPct) / 2);
  const clamped = Math.max(minPct, Math.min(maxPct, targetPct));
  return operatingCapitalUsd * clamped;
}

export default AGGRESSIVE_VELOCITY_CONFIG;
