/**
 * Light Transition v1 — Aggressive Velocity Sleeve Manifest Builder
 *
 * Takes the deterministic output of:
 *   - Aggressive Velocity Scanner (high-net candidates)
 *   - Yield Strategist (selected allocations + sizing)
 *   - Risk & Exit (exit rules + feasibility)
 *   - Accounting library (exact expectedNetBtcProfit, pro-rata projections, costs)
 *   - Capital slice (committed 25-35% sleeve allocation + refill plan)
 *
 * Produces a canonical, hashable, forbidden-key-safe ProofManifest
 * that the Policy Engine can evaluate for ALLOW.
 *
 * This is the single artifact that represents "one broadcast away".
 * No actual signing or capital movement ever happens here.
 *
 * AGENTS.md: deterministic only, no LLM, BTC primary, evidence bundle required.
 */

import { buildProofManifest } from "../../proof/manifest.mjs";
import { SLEEVE_ID } from "../../ledger/aggressive-sleeve-accounting.mjs"; // canonical sleeve tag (avoids heavy scanner/strategist transitive deps for manifest builder)

/**
 * Build the pre-broadcast manifest for a sleeve allocation decision.
 * @param {object} decision - Strategist output: { selected: [{opportunity, allocationPct, expectedNetBtcProfit, ...}], totalSleeveBtc, ... }
 * @param {object} accountingProjections - from calculateExpectedNetBtcProfit / computeProRata... for the batch
 * @param {object} exitRules - AGGRESSIVE_EXIT_RULES + per-candidate feasibility
 * @param {object} capitalSlice - { sleeveCapBtc, refillPlanId, concentrationOk }
 * @param {object} context - { observedAt, sourcePointers (scanner run id, strategist run id, capital plan id) }
 */
export function buildAggressiveVelocityManifest({
  decision,
  accountingProjections = {},
  exitRules = {},
  capitalSlice = {},
  context = {}
} = {}) {
  if (!decision || !Array.isArray(decision.selected) || decision.selected.length === 0) {
    throw new Error("buildAggressiveVelocityManifest: decision.selected (non-empty) is required");
  }

  const observedAt = context.observedAt || new Date().toISOString();

  // Build artifacts: the exact numbers the policy will gate on (BTC-denominated)
  const artifacts = decision.selected.map((sel, idx) => ({
    positionKey: sel.positionKey || sel.chain + ":" + (sel.protocol || "unknown"),
    allocationPct: sel.allocationPct || sel.recommendedAllocationPct,
    expectedNetBtcProfit: sel.expectedNetBtcProfit || accountingProjections.expectedNetBtcProfit || 0,
    simulatedCaptureRate: sel.simulatedCaptureRate || 0,
    realizationFeasibilityScore: sel.realizationFeasibilityScore || 0,
    exitTrigger: exitRules.minRealizedProfitToExitBtc ? `minProfitBtc:${exitRules.minRealizedProfitToExitBtc}` : "default",
    proRataShareBps: sel.proRataShareBps || 0, // from computeProRataRewardShare when available
    costBreakdown: sel.totalRoundtripCostBtc || accountingProjections.breakdown || {}
  }));

  // Prefer explicit total from strategist/accountingSummary if provided (useful for E2E/blocker tests)
  const explicitTotal = decision.totalExpectedNetBtcProfit ?? decision.accountingSummary?.expectedNetBtcProfit;
  const totalExpectedNetBtc = explicitTotal != null
    ? Number(explicitTotal)
    : artifacts.reduce((sum, a) => sum + (a.expectedNetBtcProfit || 0), 0);

  const verdict = {
    sleeve: SLEEVE_ID,
    totalSelected: decision.selected.length,
    totalExpectedNetBtcProfit: parseFloat(totalExpectedNetBtc.toFixed(8)),
    sleeveCapBtc: capitalSlice.sleeveCapBtc || 0,
    capitalConcentrationOk: capitalSlice.concentrationOk !== false,
    exitAutomationEnforced: true,
    policyProfile: "aggressive_yield_v1",
    readyForPolicyReview: true
  };

  const sourcePointers = context.sourcePointers || [
    `scanner:${context.scannerRunId || "latest"}`,
    `strategist:${context.strategistRunId || "latest"}`,
    `accounting-lib:${context.accountingVersion || "v1"}`,
    `capital-plan:${capitalSlice.refillPlanId || "pending"}`
  ];

  return buildProofManifest({
    kind: "aggressive-velocity-manifest-v1",
    observedAt,
    sourcePointers,
    artifacts,
    verdict,
    // redactions: [] — none for sleeve (all evidence is non-sensitive for policy)
  });
}

/**
 * Convenience: given raw strategist result + lib outputs, produce the manifest in one call.
 * Used by the Light Transition coordinator / all-chain-autopilot sleeve lane (future).
 */
export function fromStrategistDecision(strategistResult, extraContext = {}) {
  return buildAggressiveVelocityManifest({
    decision: strategistResult,
    accountingProjections: strategistResult.accountingSummary || {},
    exitRules: strategistResult.exitRules || {},
    capitalSlice: strategistResult.capitalSlice || {},
    context: extraContext
  });
}
