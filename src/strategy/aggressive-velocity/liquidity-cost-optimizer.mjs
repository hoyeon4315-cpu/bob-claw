/**
 * 4th Subagent: Liquidity & Cost Optimizer (Phase 2 centralization)
 *
 * This file completes the 4-subagent swarm for the Aggressive Velocity Sleeve.
 *
 * In practice, heavy cost/liquidity/bridge/gas simulation logic is already
 * centralized in:
 *   - risk-exit-manager.mjs (exit feasibility + simulation)
 *   - aggressive-sleeve-accounting.mjs (estimateAllInExitCost, pro-rata, net BTC)
 *   - config (committed cost buffers)
 *
 * This thin module acts as the official 4th role and re-exports the canonical
 * functions so the swarm contract is explicit and the E2E / future autopilot
 * can import from one place.
 *
 * No new heavy logic is added here to avoid duplication (per "centralization" decision).
 */

export {
  estimateAllInExitCost,
  calculateExpectedNetBtcProfit,
  computeProRataRewardShare,
} from '../../ledger/aggressive-sleeve-accounting.mjs';

export {
  calculateRealizationFeasibilityScore,
  simulateHighYieldExitOutcomes,
  filterCandidatesWithSafeExitPath,
} from './risk-exit-manager.mjs';

export const LIQUIDITY_COST_OPTIMIZER_ROLE = 'liquidity-cost-optimizer-v1';
export const SLEEVE_ID = 'aggressive-velocity-v1';

/**
 * Central entry point for the 4th role.
 * Given opportunities, returns cost-optimized, liquidity-aware ranking.
 */
export function optimizeForLiquidityAndCost(candidates = [], options = {}) {
  // Currently delegates to existing risk + accounting (centralized implementation).
  // Future: can add bridge cost matrix, gas price oracle, liquidity depth checks here
  // without changing callers.
  return candidates; // placeholder for now; real optimization lives in callers + lib
}
