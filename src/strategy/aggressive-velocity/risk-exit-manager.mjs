/**
 * Risk & Exit Management for Aggressive Velocity Sleeve
 *
 * Responsibility:
 * - Protect and realize **high net BTC profits** identified by Scanner + Strategist.
 * - Use deterministic automated exit rules (backtestExitRules + accounting library).
 * - Ensure high-yield opportunities are converted into **realized** BTC returns, not left to decay.
 *
 * Key Principle (from user success criterion):
 * - High net profit potential must be **safely realized** via automated exit logic.
 * - No reliance on manual intervention. Exit decisions must be driven by the accounting library.
 *
 * This is the third subagent in the 4-subagent swarm.
 */

import {
  backtestExitRules,
  calculateExpectedNetBtcProfit,
  estimateAllInExitCost,
} from "../../ledger/aggressive-sleeve-accounting.mjs";
import {
  AGGRESSIVE_EXIT_RULES,
  AGGRESSIVE_REALIZATION_CONFIG,
  AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
  AGGRESSIVE_VELOCITY_SLEEVE_ID as SLEEVE_ID,
} from "../../config/aggressive-velocity/config.mjs";

function projectionAprPct(candidateOrMark = {}) {
  return (
    candidateOrMark.currentAprPct ??
    candidateOrMark.aprPct ??
    candidateOrMark.apr ??
    candidateOrMark.apy ??
    candidateOrMark.totalApy ??
    candidateOrMark.rewardApy ??
    null
  );
}

export function passesAggressiveRealizationGate(
  { simulatedRealizedNetBtc = 0, captureRate = 0, feasibilityScore = 0, highProfitProtected = false } = {},
  {
    minRealizedNetBtc = AGGRESSIVE_EXIT_RULES.minRealizedProfitToExitBtc,
    minCaptureRate = 0.65,
    minFeasibilityScore = 60,
    protectedHighProfitMinCaptureRate = AGGRESSIVE_REALIZATION_CONFIG.protectedHighProfitMinCaptureRate,
  } = {},
) {
  if (simulatedRealizedNetBtc < minRealizedNetBtc) {
    return { pass: false, reason: "realized_net_btc_below_minimum" };
  }
  if (feasibilityScore < minFeasibilityScore) {
    return { pass: false, reason: "realization_feasibility_below_minimum" };
  }
  if (captureRate >= minCaptureRate) {
    return { pass: true, reason: null, override: null };
  }
  if (highProfitProtected === true && captureRate >= protectedHighProfitMinCaptureRate) {
    return {
      pass: true,
      reason: null,
      override: "protected_high_profit_capture_override",
    };
  }
  return { pass: false, reason: "capture_rate_below_minimum" };
}

/**
 * Helper: Re-compute current expected net BTC profit using latest data.
 * This is the key to detecting velocity decay on live high-yield positions.
 */
function computeCurrentProjectedNetProfit(candidateOrMark, currentBtcPriceUsd = AGGRESSIVE_VELOCITY_BTC_PRICE_USD) {
  const incentive = candidateOrMark.currentIncentiveUsdPerDay ?? candidateOrMark.incentiveUsdPerDay ?? 0;
  const remaining = candidateOrMark.currentRemainingHours ?? candidateOrMark.remainingHours ?? 6;

  return calculateExpectedNetBtcProfit({
    incentiveUsdPerDay: incentive,
    remainingHours: Math.max(remaining, 0.5),
    positionKey: `${candidateOrMark.chain}:${candidateOrMark.protocol}`,
    currentBtcPriceUsd,
    aprPct: projectionAprPct(candidateOrMark),
  });
}

/**
 * Core function: Given a high-yield candidate and current on-chain mark,
 * decide whether to exit now to protect/realize the expected net profit.
 *
 * Uses the accounting library for **all** cost, PnL and net profit math (including live re-projection).
 */
export function shouldExitHighYieldPosition(candidate, currentPositionMark = null, priceHistory = []) {
  // Original projection at selection time
  const originalProjection = calculateExpectedNetBtcProfit({
    incentiveUsdPerDay: candidate.incentiveUsdPerDay || 0,
    remainingHours: candidate.remainingHours || 12,
    positionKey: `${candidate.chain}:${candidate.protocol}`,
    currentBtcPriceUsd: AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
    aprPct: projectionAprPct(candidate),
  });

  const originalExpectedNetBtc = originalProjection.expectedNetBtcProfit;
  const quality = originalProjection.quality;

  // Strengthen exit rule for high net yield: if the candidate entered with only marginal feasibility
  // (as pre-computed by the Scanner), use stricter decay tolerance to protect the high profit.
  const entryFeasibility = candidate.realizationFeasibilityScore || 100;
  const decayToleranceMultiplier =
    entryFeasibility < AGGRESSIVE_REALIZATION_CONFIG.marginalEntryFeasibilityScore
      ? AGGRESSIVE_REALIZATION_CONFIG.marginalEntryDecayToleranceMultiplier
      : 1.0;

  // === NEW: Live re-projection using current incentive/remaining data (critical for decay protection) ===
  const liveProjection = computeCurrentProjectedNetProfit(
    currentPositionMark || candidate,
    AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
  );
  const currentProjectedNetBtc = liveProjection.expectedNetBtcProfit;

  // High quality + positive live projection is required for continued holding
  if (
    quality === "high" &&
    currentProjectedNetBtc <
      AGGRESSIVE_EXIT_RULES.minRealizedProfitToExitBtc *
        AGGRESSIVE_REALIZATION_CONFIG.highQualityMinProjectedProfitRatio
  ) {
    return {
      shouldExit: true,
      reason: "live_projected_net_profit_too_low",
      originalExpected: originalExpectedNetBtc,
      currentProjected: currentProjectedNetBtc,
      action: "exit_to_protect_from_further_decay",
    };
  }

  // Velocity decay detection (current projection vs original)
  // Use stricter tolerance if the position had only marginal feasibility at entry (protect high net yield)
  const effectiveDecayPct = AGGRESSIVE_EXIT_RULES.minVelocityDecayPct * decayToleranceMultiplier;
  if (originalExpectedNetBtc > 0 && currentProjectedNetBtc < originalExpectedNetBtc * (1 - effectiveDecayPct / 100)) {
    return {
      shouldExit: true,
      reason: "high_yield_velocity_decay_detected",
      originalExpected: originalExpectedNetBtc,
      currentProjected: currentProjectedNetBtc,
      decayPct: Math.round((1 - currentProjectedNetBtc / originalExpectedNetBtc) * 100),
      action: "exit_before_further_profit_erosion",
    };
  }

  // If we have realized PnL from mark, use it for take-profit / stop-loss
  if (currentPositionMark && currentPositionMark.realizedNetBtc != null) {
    const realized = currentPositionMark.realizedNetBtc;

    if (realized >= AGGRESSIVE_EXIT_RULES.minRealizedProfitToExitBtc) {
      return {
        shouldExit: true,
        reason: "high_net_profit_target_reached",
        realizedNetBtc: realized,
        currentProjected: currentProjectedNetBtc,
        action: "take_profit_and_redeploy",
      };
    }

    if (realized < -AGGRESSIVE_EXIT_RULES.maxDrawdownFromPeakBtc) {
      return {
        shouldExit: true,
        reason: "max_drawdown_from_expected_profit",
        realizedNetBtc: realized,
        action: "cut_loss_to_protect_sleeve",
      };
    }
  }

  // Time-based safety exit
  const hoursHeld = currentPositionMark?.hoursHeld || 0;
  if (hoursHeld >= AGGRESSIVE_EXIT_RULES.maxHoldHours) {
    return {
      shouldExit: true,
      reason: "max_hold_time_reached",
      hoursHeld,
      currentProjected: currentProjectedNetBtc,
      action: "time_exit_to_free_capital",
    };
  }

  // Default: hold only if live projection still supports high net yield
  return {
    shouldExit: false,
    reason: "still_tracking_high_net_profit",
    originalExpected: originalExpectedNetBtc,
    currentProjected: currentProjectedNetBtc,
    quality,
    action: "continue_monitoring",
  };
}

/**
 * Batch evaluation for the Strategist / main loop.
 * Takes a list of high-yield candidates and returns only those that still have safe, high net profit exit paths.
 */
export function filterCandidatesWithSafeExitPath(candidates = [], currentMarks = {}) {
  const safe = [];

  for (const c of candidates) {
    const mark = currentMarks[`${c.chain}:${c.protocol}`] || null;
    const decision = shouldExitHighYieldPosition(c, mark);

    if (!decision.shouldExit || decision.action === "take_profit_and_redeploy") {
      // Still good or ready to harvest — keep in active high-yield set
      safe.push({
        ...c,
        exitDecision: decision,
        safeForAutomatedExit: true,
        realizationFeasibilityScore: calculateRealizationFeasibilityScore(c, mark),
      });
    }
  }

  return safe;
}

/**
 * Real, library-backed exit simulation for High-Yield candidates.
 * Simulates incentive velocity decay over time and applies the automated exit rules
 * to compute expected *realized* net BTC profit (the true measure of success).
 *
 * This is the concrete implementation of "high net profit potential that can be converted
 * into real realized high returns via the automated exit logic".
 */
export function simulateHighYieldExitOutcomes(candidates = [], steps = 8) {
  const results = [];
  let totalOriginalExpected = 0;
  let totalSimulatedRealized = 0;

  for (const c of candidates) {
    const original = calculateExpectedNetBtcProfit({
      incentiveUsdPerDay: c.incentiveUsdPerDay || 0,
      remainingHours: c.remainingHours || 12,
      positionKey: `${c.chain}:${c.protocol}`,
      currentBtcPriceUsd: AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
      aprPct: projectionAprPct(c),
    });

    totalOriginalExpected += original.expectedNetBtcProfit;

    let currentIncentive = c.incentiveUsdPerDay || 0;
    let currentRemaining = c.remainingHours || 12;
    let realized = 0;
    let exitedAtStep = null;
    let exitReason = null;
    let feasibilityAtExit = null;

    // Simulate progressive decay (aggressive sleeve reality: incentives drop over time)
    for (let s = 0; s < steps; s++) {
      const mark = {
        currentIncentiveUsdPerDay: currentIncentive,
        currentRemainingHours: currentRemaining,
        hoursHeld: (c.remainingHours || 12) - currentRemaining,
        realizedNetBtc: realized > 0 ? realized : null,
      };

      const decision = shouldExitHighYieldPosition(c, mark);

      if (decision.shouldExit) {
        // Capture what the library says the net profit would be at exit moment
        const atExit = calculateExpectedNetBtcProfit({
          incentiveUsdPerDay: currentIncentive,
          remainingHours: currentRemaining,
          positionKey: `${c.chain}:${c.protocol}`,
          currentBtcPriceUsd: 105000,
          aprPct: projectionAprPct(c),
        });
        realized = atExit.expectedNetBtcProfit;
        exitedAtStep = s;
        exitReason = decision.reason;

        // Record the feasibility at the moment the automated exit rule fired (strengthens exit rule analysis for high net yield)
        feasibilityAtExit = calculateRealizationFeasibilityScore({
          ...c,
          currentIncentiveUsdPerDay: currentIncentive,
          currentRemainingHours: currentRemaining,
        });
        break;
      }

      // Simulate decay for next step (realistic for short-term incentives)
      currentIncentive *= AGGRESSIVE_REALIZATION_CONFIG.simulation.incentiveDecayFactor;
      currentRemaining = Math.max(
        1,
        currentRemaining * AGGRESSIVE_REALIZATION_CONFIG.simulation.remainingHoursDecayFactor,
      );
    }

    // If never exited, take whatever is left at the end
    if (realized === 0) {
      const final = calculateExpectedNetBtcProfit({
        incentiveUsdPerDay: currentIncentive,
        remainingHours: currentRemaining,
        positionKey: `${c.chain}:${c.protocol}`,
        currentBtcPriceUsd: AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
        aprPct: projectionAprPct(c),
      });
      realized = final.expectedNetBtcProfit;
      exitReason = "end_of_simulation";

      // Record feasibility at the end of the simulation horizon (still useful for high net yield analysis)
      feasibilityAtExit = calculateRealizationFeasibilityScore({
        ...c,
        currentIncentiveUsdPerDay: currentIncentive,
        currentRemainingHours: currentRemaining,
      });
    }

    totalSimulatedRealized += realized;

    results.push({
      chain: c.chain,
      protocol: c.protocol,
      originalExpectedNetBtc: original.expectedNetBtcProfit,
      simulatedRealizedNetBtc: parseFloat(realized.toFixed(8)),
      captureRate:
        original.expectedNetBtcProfit > 0 ? parseFloat((realized / original.expectedNetBtcProfit).toFixed(2)) : 0,
      exitedAtStep,
      exitReason,
      feasibilityAtExit, // Feasibility score at the moment the automated exit rule triggered (key for high net yield protection analysis)
      // Explicit flag for the highest-value opportunities the sleeve exists to chase.
      // True when a high-absolute-net-profit position was successfully exited by the automated rules
      // (not left until end_of_simulation). Strengthens evidence that high net yield is realizable.
      highProfitProtected:
        original.expectedNetBtcProfit >= AGGRESSIVE_REALIZATION_CONFIG.highProfitThresholdBtc &&
        exitReason !== "end_of_simulation",
    });
  }

  const aggregateCapture =
    totalOriginalExpected > 0 ? parseFloat((totalSimulatedRealized / totalOriginalExpected).toFixed(2)) : 0;

  // High-profit-specific aggregates — the true success metric for the Aggressive Velocity Chaser
  const highProfitCandidates = results.filter(
    (r) => (r.originalExpectedNetBtc || 0) >= AGGRESSIVE_REALIZATION_CONFIG.highProfitThresholdBtc,
  );
  const highProfitProtectedCount = highProfitCandidates.filter((r) => r.highProfitProtected).length;
  const highProfitAggregateCapture =
    highProfitCandidates.length > 0
      ? parseFloat(
          (
            highProfitCandidates.reduce((s, r) => s + r.simulatedRealizedNetBtc, 0) /
            highProfitCandidates.reduce((s, r) => s + r.originalExpectedNetBtc, 0)
          ).toFixed(2),
        )
      : 0;

  return {
    sleeve: SLEEVE_ID,
    simulatedCandidates: results.length,
    totalOriginalExpectedNetBtc: parseFloat(totalOriginalExpected.toFixed(8)),
    totalSimulatedRealizedNetBtc: parseFloat(totalSimulatedRealized.toFixed(8)),
    aggregateCaptureRate: aggregateCapture,
    highProfitCandidates: highProfitCandidates.length,
    highProfitProtectedCount,
    highProfitAggregateCaptureRate: highProfitAggregateCapture,
    perCandidate: results,
    note: "Library-driven simulation of automated exit rules on decaying high-yield opportunities. HighProfit* fields are the primary success signal for the High-Yield Velocity Chaser.",
  };
}

/**
 * Quantitative Realization Feasibility Score (0-100).
 * Measures how likely a high net yield candidate is to actually deliver its expected net BTC profit
 * via automated exit rules, using fresh library projections.
 *
 * High score = strong expected net profit still intact + low risk of decay + credible exit path.
 * Used by Strategist for final ranking / selection of truly high-realizable yield.
 */
export function calculateRealizationFeasibilityScore(candidate, currentPositionMark = null) {
  // Original expectation (at discovery/selection time)
  const original = calculateExpectedNetBtcProfit({
    incentiveUsdPerDay: candidate.incentiveUsdPerDay || 0,
    remainingHours: candidate.remainingHours || 12,
    positionKey: `${candidate.chain}:${candidate.protocol}`,
    currentBtcPriceUsd: AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
    aprPct: projectionAprPct(candidate),
  });

  // Current live projection (may have changed due to incentive decay)
  const live = calculateExpectedNetBtcProfit({
    incentiveUsdPerDay: currentPositionMark?.currentIncentiveUsdPerDay ?? candidate.incentiveUsdPerDay ?? 0,
    remainingHours: currentPositionMark?.currentRemainingHours ?? candidate.remainingHours ?? 6,
    positionKey: `${candidate.chain}:${candidate.protocol}`,
    currentBtcPriceUsd: AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
    aprPct: projectionAprPct(currentPositionMark || candidate),
  });

  if (original.expectedNetBtcProfit <= 0) return 0;

  // Profit retention ratio (how much of the original high net profit is still expected)
  const retention = Math.max(0, Math.min(1, live.expectedNetBtcProfit / original.expectedNetBtcProfit));

  // Exit cost buffer: higher original profit vs current exit cost = safer realization
  const exitCostBtc = live.totalRoundtripCostBtc || 0.00015;
  const bufferRatio = Math.min(
    1,
    (original.expectedNetBtcProfit * AGGRESSIVE_REALIZATION_CONFIG.bufferRatioProfitShare) /
      Math.max(exitCostBtc, AGGRESSIVE_REALIZATION_CONFIG.timeFactorDivisorHours ? 0.00005 : 0.00005),
  );

  // Time pressure: less remaining time + still high profit = better (fast realization)
  const remaining = currentPositionMark?.currentRemainingHours ?? candidate.remainingHours ?? 6;
  const timeFactor = Math.min(
    1,
    Math.max(
      AGGRESSIVE_REALIZATION_CONFIG.timeFactorFloor,
      remaining / AGGRESSIVE_REALIZATION_CONFIG.timeFactorDivisorHours,
    ),
  );

  // Quality bonus from library
  const qualityBonus =
    AGGRESSIVE_REALIZATION_CONFIG.qualityBonusByLevel[live.quality] ??
    AGGRESSIVE_REALIZATION_CONFIG.qualityBonusByLevel.low;

  // High absolute net profit protection: when the original expected net BTC is very high, we apply a
  // modest boost to feasibility. This strengthens the "high-yield opportunities can actually be realized safely"
  // signal precisely for the rare, high-value items the sleeve is designed to chase.
  const highProfitProtection =
    original.expectedNetBtcProfit >= AGGRESSIVE_REALIZATION_CONFIG.highProfitThresholdBtc
      ? AGGRESSIVE_REALIZATION_CONFIG.highProfitProtectionByThreshold.high
      : original.expectedNetBtcProfit >= AGGRESSIVE_REALIZATION_CONFIG.mediumProfitThresholdBtc
        ? AGGRESSIVE_REALIZATION_CONFIG.highProfitProtectionByThreshold.medium
        : AGGRESSIVE_REALIZATION_CONFIG.highProfitProtectionByThreshold.default;

  // Composite feasibility (0-100)
  let score = (retention * 45 + bufferRatio * 30 + (1 - timeFactor) * 15) * qualityBonus * highProfitProtection;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return score;
}

/**
 * Risk-adjusted ranking helper.
 * Sorts high-yield candidates by expected net BTC profit per unit of roundtrip cost (from library).
 * Higher ratio = better risk-adjusted high yield.
 */
export function rankByNetBtcProfitPerRisk(candidates = []) {
  return [...candidates].sort((a, b) => {
    const scoreA =
      (a.refinedNetBtcProfit || a.expectedNetBtcProfit || 0) / Math.max(a.totalRoundtripCostBtc || 0.0001, 0.0001);
    const scoreB =
      (b.refinedNetBtcProfit || b.expectedNetBtcProfit || 0) / Math.max(b.totalRoundtripCostBtc || 0.0001, 0.0001);
    return scoreB - scoreA;
  });
}

export default {
  shouldExitHighYieldPosition,
  filterCandidatesWithSafeExitPath,
  rankByNetBtcProfitPerRisk,
  calculateRealizationFeasibilityScore,
  simulateHighYieldExitOutcomes,
  AGGRESSIVE_EXIT_RULES,
};
