// W10-C — Deterministic demotion / rollback gate.
//
// Evaluates whether a strategy that nominally qualifies for a higher stage
// should be demoted due to adverse recent evidence.
//
// Rollback is NOT a runtime auto-flip of autoExecute.
// It is a policy blocker that prevents promotionVerdict from advancing
// (or forces it back down) until the operator commits a cap diff.
//
// Pure function. No I/O.

export const DEMOTION_THRESHOLDS = Object.freeze({
  // Lookback window for adverse-event detection (shorter than promotion).
  defaultLookbackDays: 1,
  // Maximum allowed consecutive failures in the most recent signer-backed receipts.
  maxConsecutiveFailures: 2,
  // Minimum round-trip efficiency for recent successes; below this triggers demotion.
  minRecentRoundTripEfficiency: 0.75,
  // Maximum hours since last signer-backed success before evidence is considered stale.
  maxHoursSinceLastSuccess: 24,
  // Minimum number of recent receipts to evaluate for failure-burst detection.
  minRecentReceiptsToEvaluate: 2,
});

function withinLookback(receipt, nowMs, lookbackDays) {
  if (!Number.isFinite(receipt.tsMs)) return false;
  const cutoff = nowMs - lookbackDays * 24 * 60 * 60 * 1000;
  return receipt.tsMs >= cutoff;
}

function isSignerBacked(r) {
  return r.source === "signer" && Boolean(r.txHash);
}

function isSuccess(r) {
  return r.outcome === "success";
}

function isEmergencyUnwind(r) {
  return r.intentType === "emergency_unwind" || r.strategyAction === "emergency_unwind";
}

export function evaluateDemotionPolicy({
  strategyId,
  receipts,
  nowMs,
  thresholds = DEMOTION_THRESHOLDS,
  lookbackDays = DEMOTION_THRESHOLDS.defaultLookbackDays,
} = {}) {
  if (typeof strategyId !== "string" || !strategyId) {
    throw new TypeError("strategyId required");
  }
  if (!Array.isArray(receipts)) throw new TypeError("receipts array required");
  if (!Number.isFinite(nowMs)) throw new TypeError("nowMs required");

  const filtered = receipts
    .filter((r) => r && r.strategyId === strategyId)
    .filter((r) => withinLookback(r, nowMs, lookbackDays))
    .sort((a, b) => a.tsMs - b.tsMs);

  const signerBacked = filtered.filter(isSignerBacked);
  const successes = signerBacked.filter(isSuccess);
  const failures = signerBacked.filter((r) => !isSuccess(r));

  const triggers = [];

  // 1. Recent failure burst: too many consecutive failures at the end.
  let consecutiveFailures = 0;
  for (let i = signerBacked.length - 1; i >= 0; i -= 1) {
    if (!isSuccess(signerBacked[i])) consecutiveFailures += 1;
    else break;
  }
  if (
    signerBacked.length >= thresholds.minRecentReceiptsToEvaluate
    && consecutiveFailures >= thresholds.maxConsecutiveFailures
  ) {
    triggers.push({
      kind: "recent_failure_burst",
      have: consecutiveFailures,
      max: thresholds.maxConsecutiveFailures,
    });
  }

  // 2. Emergency unwind failure.
  const emergencyUnwindFailures = signerBacked.filter((r) => isEmergencyUnwind(r) && !isSuccess(r));
  if (emergencyUnwindFailures.length > 0) {
    triggers.push({
      kind: "emergency_unwind_failure",
      count: emergencyUnwindFailures.length,
    });
  }

  // 3. Stale evidence: no success in lookback window.
  if (successes.length === 0 && signerBacked.length > 0) {
    const hoursSinceLastSuccess = (nowMs - signerBacked[0].tsMs) / (60 * 60 * 1000);
    triggers.push({
      kind: "stale_evidence_no_success_in_window",
      hoursSinceLastSuccess: Number(hoursSinceLastSuccess.toFixed(2)),
      maxHours: thresholds.maxHoursSinceLastSuccess,
    });
  }

  // 4. Round-trip efficiency drop in recent successes.
  if (successes.length > 0) {
    const costs = successes
      .map((r) => Number(r.roundTripCostSats || 0))
      .filter(Number.isFinite);
    const profits = successes
      .map((r) => Number(r.realizedProfitSats || 0))
      .filter(Number.isFinite);
    const totalCost = costs.reduce((a, b) => a + b, 0);
    const totalProfit = profits.reduce((a, b) => a + b, 0);
    const gross = totalProfit + totalCost;
    const efficiency = gross > 0 ? (gross - totalCost) / gross : null;
    if (efficiency !== null && efficiency < thresholds.minRecentRoundTripEfficiency) {
      triggers.push({
        kind: "round_trip_efficiency_below_threshold",
        have: Number(efficiency.toFixed(4)),
        min: thresholds.minRecentRoundTripEfficiency,
      });
    }
  }

  const demoted = triggers.length > 0;

  return Object.freeze({
    strategyId,
    demoted,
    triggers: Object.freeze(triggers),
    evidence: Object.freeze({
      lookbackDays,
      signerBackedReceiptCount: signerBacked.length,
      successCount: successes.length,
      failureCount: failures.length,
      consecutiveFailures,
      emergencyUnwindFailureCount: emergencyUnwindFailures.length,
    }),
  });
}

export function summarizeDemotionEvidence(reports) {
  if (!Array.isArray(reports)) throw new TypeError("reports array required");
  const demoted = reports.filter((r) => r.demoted);
  const clean = reports.filter((r) => !r.demoted);
  return Object.freeze({
    demotedCount: demoted.length,
    cleanCount: clean.length,
    demoted: Object.freeze(demoted.map((r) => r.strategyId)),
    clean: Object.freeze(clean.map((r) => r.strategyId)),
  });
}
