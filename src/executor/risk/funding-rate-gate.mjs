// Funding-rate gate. Controls S6 (GMX/Synthetix perp basis) entry/exit via
// 30d EWMA of funding rate.

import { SEVERITY, makeVerdict, ewma, isFiniteNumber } from "./types.mjs";

export const FUNDING_RATE_THRESHOLDS = Object.freeze({
  entryMinEwmaAnnualized: 0.02, // 2% APR
  exitMaxEwmaAnnualized: 0.0,
  negativeRunLengthMaxDays: 3,
  ewmaHalfLifeSamples: 30,
});

export function evaluateFundingRateGate(snapshot, thresholds = FUNDING_RATE_THRESHOLDS) {
  const marketId = snapshot?.marketId || "unknown";
  const fundingSamples = Array.isArray(snapshot?.fundingRateAnnualizedSamples)
    ? snapshot.fundingRateAnnualizedSamples
    : [];
  const ewmaRate = ewma(fundingSamples, thresholds.ewmaHalfLifeSamples);
  const recentNegativeDays = Number(snapshot?.recentNegativeDays ?? 0);

  const violations = [];
  const details = { ewmaRate, recentNegativeDays, sampleCount: fundingSamples.length };

  let action = "hold";
  if (isFiniteNumber(ewmaRate)) {
    if (ewmaRate >= thresholds.entryMinEwmaAnnualized && recentNegativeDays === 0) {
      action = "allow_entry";
    } else if (ewmaRate <= thresholds.exitMaxEwmaAnnualized ||
               recentNegativeDays >= thresholds.negativeRunLengthMaxDays) {
      action = "force_exit";
      violations.push({
        kind: "funding_rate_adverse",
        ewma: ewmaRate,
        recentNegativeDays,
      });
    }
  } else {
    action = "defer_insufficient_data";
  }

  const ok = violations.length === 0;
  return makeVerdict({
    moduleId: `funding-rate-gate:${marketId}`,
    ok,
    severity: ok ? SEVERITY.INFO : SEVERITY.HALT_STRATEGY,
    action,
    violations,
    details,
  });
}
