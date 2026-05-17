/**
 * Aggressive Yield Strategist
 * 
 * Core decision maker for the High-Yield Diversified Aggressive Velocity Chaser.
 * 
 * Responsibility:
 * - Receives high-yield candidates from the Aggressive Velocity Scanner.
 * - Ranks and selects only opportunities with **strong expected net BTC profit**.
 * - Outputs final allocation decisions for the sleeve.
 * 
 * Key Principle (from user):
 * - We do NOT chase volume of mediocre opportunities.
 * - We only act on candidates that can deliver **high net profits / high yield** in BTC after all costs.
 * 
 * This module works tightly with:
 * - `src/ledger/aggressive-sleeve-accounting.mjs` for accurate net profit and cost calculations.
 * - Risk & Exit Management for automated exit feasibility.
 */

import { getHighYieldExecutableCandidates } from './aggressive-velocity-scanner.mjs';
import {
  estimateAllInExitCost,
  calculateExpectedNetBtcProfit
} from '../../ledger/aggressive-sleeve-accounting.mjs'; // Canonical high net yield calculator (library is source of truth)
import {
  filterCandidatesWithSafeExitPath,
  rankByNetBtcProfitPerRisk,
  calculateRealizationFeasibilityScore,
  simulateHighYieldExitOutcomes
} from './risk-exit-manager.mjs'; // Realization feasibility + library-driven exit simulation for proven high net yield delivery

const SLEEVE_ID = 'aggressive-velocity-v1';

export const AGGRESSIVE_YIELD_STRATEGIST_CONFIG = {
  minExpectedNetBtcProfit: 0.00005,   // Minimum projected net BTC profit for the campaign to consider
  minNetYieldPctPerDay: 0.8,          // Minimum daily net yield % to be attractive
  maxPositions: 4,                    // Hard diversification limit for the sleeve
  preferHighQualityOnly: true,        // Only 'high' quality candidates unless no choice
  minSimulatedCaptureRate: 0.65,      // Only keep candidates where the automated exit simulation shows >=65% of expected net profit is actually realized
};

/**
 * Main entry point for the Strategist.
 * Takes scanner output and returns a ranked list of high net yield opportunities ready for execution.
 */
export async function selectHighYieldOpportunities(scannerResult = null) {
  let result = scannerResult;

  if (!result) {
    result = await getHighYieldExecutableCandidates();
  }

  const candidates = result.highYieldExecutableCandidates || result.candidates || [];

  // Delegate ALL net BTC profit refinement to the canonical library function (source of truth)
  for (const c of candidates) {
    try {
      const projection = calculateExpectedNetBtcProfit({
        incentiveUsdPerDay: c.incentiveUsdPerDay || 0,
        remainingHours: c.remainingHours || 12,
        positionKey: `${c.chain}:${c.protocol}`,
        currentBtcPriceUsd: 105000
      });

      c.refinedNetBtcProfit = projection.expectedNetBtcProfit;
      c.netDailyProfitBtc = projection.netDailyProfitBtc;
      c.totalRoundtripCostUsd = projection.totalRoundtripCostUsd;
      c.expectedNetProfitQuality = projection.quality;
      c.roundtripCostBreakdown = projection.breakdown;
    } catch (e) {
      c.refinedNetBtcProfit = c.expectedNetBtcProfit || 0;
      c.expectedNetProfitQuality = 'low';
    }
  }

  // Filter strictly for high net profit potential (using refined value)
  const qualified = candidates.filter(c => {
    const profit = c.refinedNetBtcProfit || c.expectedNetBtcProfit || 0;
    const hasGoodProfit = profit >= AGGRESSIVE_YIELD_STRATEGIST_CONFIG.minExpectedNetBtcProfit;
    const hasGoodYield = (c.netYieldPctPerDay || 0) >= AGGRESSIVE_YIELD_STRATEGIST_CONFIG.minNetYieldPctPerDay;
    const isHighQuality = c.expectedNetProfitQuality === 'high';

    if (AGGRESSIVE_YIELD_STRATEGIST_CONFIG.preferHighQualityOnly) {
      return isHighQuality && hasGoodProfit;
    }
    return hasGoodProfit && hasGoodYield;
  });

  // Final ranking by refined net BTC profit (more accurate high-yield selection)
  qualified.sort((a, b) => ((b.refinedNetBtcProfit || b.expectedNetBtcProfit) || 0) - ((a.refinedNetBtcProfit || a.expectedNetBtcProfit) || 0));

  // Apply diversification cap
  const selected = qualified.slice(0, AGGRESSIVE_YIELD_STRATEGIST_CONFIG.maxPositions);

  // === Critical: Filter through Risk & Exit manager to guarantee safe automated exit path ===
  // Only candidates where high net BTC profit can actually be realized safely are kept.
  const safeToRealize = filterCandidatesWithSafeExitPath(selected);

  // Prioritize by the explicit highNetYieldRankScore from Scanner (risk-adjusted realized net profit).
  // Falls back to the composite if not present. This keeps the "projected net BTC return / risk"
  // ranking consistent from Scanner through Strategist for high net yield candidates.
  const safeToRealizeRanked = [...safeToRealize].sort((a, b) => {
    const scoreA = a.highNetYieldRankScore ?? ((a.simulatedRealizedNetBtc || a.refinedNetBtcProfit || a.expectedNetBtcProfit || 0) * ((a.realizationFeasibilityScore || 0) / 100));
    const scoreB = b.highNetYieldRankScore ?? ((b.simulatedRealizedNetBtc || b.refinedNetBtcProfit || b.expectedNetBtcProfit || 0) * ((b.realizationFeasibilityScore || 0) / 100));
    return scoreB - scoreA;
  });

  // Rank the safe candidates by net BTC profit per unit risk (cost) using Risk & Exit helper (as secondary view)
  const riskRanked = rankByNetBtcProfitPerRisk(safeToRealizeRanked);

  // Further prioritize by Realization Feasibility (probability that the high net profit will actually be captured via automated exit)
  const rankedSafe = [...riskRanked].sort((a, b) => {
    const fa = a.realizationFeasibilityScore ?? calculateRealizationFeasibilityScore(a);
    const fb = b.realizationFeasibilityScore ?? calculateRealizationFeasibilityScore(b);
    // Primary: higher feasibility first (more likely to deliver the promised high net yield)
    if (fb !== fa) return fb - fa;
    // Tie-break: higher refined net BTC profit
    return (b.refinedNetBtcProfit || b.expectedNetBtcProfit || 0) - (a.refinedNetBtcProfit || a.expectedNetBtcProfit || 0);
  });

  // Calculate total projected net BTC profit from the *safe-to-realize* high-yield set
  const totalExpectedNetBtc = rankedSafe.reduce((sum, c) => sum + (c.refinedNetBtcProfit || c.expectedNetBtcProfit || 0), 0);

  // Library-driven simulation: what net BTC do we actually expect to realize when the automated exit rules fire?
  const realizationSimulation = simulateHighYieldExitOutcomes(rankedSafe);

  // Strict filter for high net yield that can actually be realized: drop any candidate where the exit simulation shows poor capture rate.
  // This ensures we only select opportunities where the automated exit rules convert most of the high net profit into real returns.
  const minCapture = AGGRESSIVE_YIELD_STRATEGIST_CONFIG.minSimulatedCaptureRate;
  const filteredSafe = rankedSafe.filter((c, idx) => {
    const sim = realizationSimulation.perCandidate[idx];
    return sim && (sim.captureRate >= minCapture);
  });

  // Re-compute totals after the realization-quality filter
  const finalTotalExpectedNetBtc = filteredSafe.reduce((sum, c) => sum + (c.refinedNetBtcProfit || c.expectedNetBtcProfit || 0), 0);

  // Leverage pre-computed realization data from Scanner (highNetYieldRankScore path) instead of re-running simulation
  // for the final selected set. This avoids redundant computation and keeps numbers consistent with Scanner.
  const finalSelectedForTotals = [...filteredSafe].sort((a, b) => {
    const sa = a.highNetYieldRankScore ?? 0;
    const sb = b.highNetYieldRankScore ?? 0;
    return sb - sa;
  });

  // Sum realized from attached fields (populated by Scanner's simulateHighYieldExitOutcomes)
  const finalSimulatedRealized = finalSelectedForTotals.reduce((sum, c) => sum + (c.simulatedRealizedNetBtc || 0), 0);
  const finalAggregateCapture = finalTotalExpectedNetBtc > 0 ? finalSimulatedRealized / finalTotalExpectedNetBtc : 0;

  // Attach a Strategist-level high-net-yield selection score: risk-adjusted realized profit (from Scanner)
  // further weighted by the actual capture rate observed in the exit simulation.
  // This builds explicit "projected net BTC return / risk" ranking logic inside the Strategist layer.
  filteredSafe.forEach(c => {
    const base = c.highNetYieldRankScore ?? ((c.simulatedRealizedNetBtc || c.refinedNetBtcProfit || c.expectedNetBtcProfit || 0) * ((c.realizationFeasibilityScore || 0) / 100));
    const capture = c.simulatedCaptureRate ?? 0.5;
    c.strategistHighYieldSelectionScore = base * capture;
  });

  // Final sort of the selected high-yield set by the Strategist-level high-net-yield selection score
  // (risk-adjusted realized net profit × realized capture rate). This is the final "high net yield that can actually be realized" ranking.
  const finalSelected = [...filteredSafe].sort((a, b) => {
    const sa = a.strategistHighYieldSelectionScore ?? a.highNetYieldRankScore ?? 0;
    const sb = b.strategistHighYieldSelectionScore ?? b.highNetYieldRankScore ?? 0;
    return sb - sa;
  });

  return {
    sleeve: SLEEVE_ID,
    strategy: 'high-yield-aggressive-velocity',
    selectedCount: finalSelected.length,
    totalQualified: qualified.length,
    totalExpectedNetBtcProfit: parseFloat(finalTotalExpectedNetBtc.toFixed(8)),
    totalSimulatedRealizedNetBtc: parseFloat(finalSimulatedRealized.toFixed(8)),
    aggregateCaptureRate: parseFloat(finalAggregateCapture.toFixed(2)),
    candidates: finalSelected,
    rejectedLowYieldCount: candidates.length - qualified.length,
    rejectedUnsafeExitCount: selected.length - safeToRealize.length,
    rejectedLowRealizationCount: rankedSafe.length - filteredSafe.length,
    realizationSimulation: { // Constructed from Scanner pre-computed fields for consistency
      totalSimulatedRealizedNetBtc: parseFloat(finalSimulatedRealized.toFixed(8)),
      aggregateCaptureRate: parseFloat(finalAggregateCapture.toFixed(2)),
      perCandidate: finalSelected.map(c => ({
        chain: c.chain,
        protocol: c.protocol,
        simulatedRealizedNetBtc: c.simulatedRealizedNetBtc,
        captureRate: c.simulatedCaptureRate
      }))
    },
    rankedBy: 'strategistHighYieldSelectionScore (highNetYieldRankScore × simulatedCaptureRate)',
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Helper for the Risk & Exit subagent or main loop:
 * Given a list of opportunities, return only those with truly high net profit potential.
 */
export function filterHighNetYieldOnly(opportunities = []) {
  return opportunities.filter(o =>
    o.expectedNetProfitQuality === 'high' &&
    (o.expectedNetBtcProfit || 0) >= AGGRESSIVE_YIELD_STRATEGIST_CONFIG.minExpectedNetBtcProfit
  );
}

/**
 * Reusable net BTC profit projection function.
 * Uses the accounting library to estimate realistic exit costs and computes expected net profit in BTC.
 * Can be called from Scanner, Risk&Exit, or anywhere that needs accurate high-yield projection.
 */
export async function projectNetBtcProfitForOpportunity(opportunity, currentBtcPriceUsd = 105000) {
  // Fully delegate to the canonical library function (single source of truth for high net yield)
  return calculateExpectedNetBtcProfit({
    incentiveUsdPerDay: opportunity.incentiveUsdPerDay || 0,
    remainingHours: opportunity.remainingHours || 12,
    positionKey: `${opportunity.chain}:${opportunity.protocol}`,
    currentBtcPriceUsd
  });
}

/**
 * Clean interface for external use (e.g. Risk & Exit, main loop, or 4th subagent).
 * Returns only truly high net yield opportunities, ranked by projected net BTC profit.
 */
export async function getTopHighYieldOpportunities(scannerResult = null, maxCount = 5) {
  const result = await selectHighYieldOpportunities(scannerResult);
  
  const top = result.candidates
    .filter(c => c.expectedNetProfitQuality === 'high' && (c.refinedNetBtcProfit || c.expectedNetBtcProfit || 0) > 0)
    .slice(0, maxCount);

  const totalNetBtc = top.reduce((sum, c) => sum + (c.refinedNetBtcProfit || c.expectedNetBtcProfit || 0), 0);

  return {
    sleeve: SLEEVE_ID,
    count: top.length,
    totalExpectedNetBtcProfit: parseFloat(totalNetBtc.toFixed(8)),
    opportunities: top,
    note: "High net yield candidates ranked by Realization Feasibility Score (probability of delivering expected net BTC profit via automated exit) + risk-adjusted profit."
  };
}

export default {
  selectHighYieldOpportunities,
  getTopHighYieldOpportunities,
  filterHighNetYieldOnly,
  AGGRESSIVE_YIELD_STRATEGIST_CONFIG,
};