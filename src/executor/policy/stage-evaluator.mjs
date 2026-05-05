function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function evGateCalibrated(evGateStats = null) {
  if (evGateStats?.calibrated === true) return true;
  return (
    finiteNumber(evGateStats?.matchedReceiptCount) > 0 &&
    finiteNumber(evGateStats?.keyedEntryCount) > 0
  );
}

export function evaluateStage({
  marksSlice = null,
  capitalPlan = null,
  evGateStats = null,
} = {}) {
  const payback = capitalPlan?.payback || capitalPlan?.expansionGate || null;
  const expansionGate = payback?.expansionGate || payback;
  const refreshSuccessRatio24h =
    finiteNumber(marksSlice?.reliability?.rolling24h?.refreshSuccessRatio) ??
    finiteNumber(marksSlice?.refreshSuccessRatio?.rolling24h);
  const refreshSuccessRatio1h =
    finiteNumber(marksSlice?.reliability?.rolling1h?.refreshSuccessRatio) ??
    finiteNumber(marksSlice?.refreshSuccessRatio?.rolling1h);
  const refreshSuccessRatio3h =
    finiteNumber(marksSlice?.reliability?.rolling3h?.refreshSuccessRatio) ??
    finiteNumber(marksSlice?.refreshSuccessRatio?.rolling3h);
  const refreshSuccessRatio7d =
    finiteNumber(marksSlice?.reliability?.rolling7d?.refreshSuccessRatio) ??
    finiteNumber(marksSlice?.refreshSuccessRatio?.rolling7d);
  const transientFrequency1h =
    finiteNumber(marksSlice?.reliability?.rolling1h?.transientFrequency) ??
    finiteNumber(marksSlice?.transientFrequency?.rolling1h);
  const transientFrequency3h =
    finiteNumber(marksSlice?.reliability?.rolling3h?.transientFrequency) ??
    finiteNumber(marksSlice?.transientFrequency?.rolling3h);
  const transientFrequency24h =
    finiteNumber(marksSlice?.reliability?.rolling24h?.transientFrequency) ??
    finiteNumber(marksSlice?.transientFrequency?.rolling24h);
  const transientFrequency7d =
    finiteNumber(marksSlice?.reliability?.rolling7d?.transientFrequency) ??
    finiteNumber(marksSlice?.transientFrequency?.rolling7d);
  const unresolvedRefillRoutes =
    finiteNumber(capitalPlan?.unresolvedRefillRoutes) ??
    finiteNumber(capitalPlan?.refill?.unresolvedCount) ??
    0;
  const reserveChain =
    expansionGate?.reserveChain ||
    capitalPlan?.reserveChain ||
    null;
  const deliveredPeriodCountOnReserveChain =
    finiteNumber(expansionGate?.deliveredPeriodCountOnReserveChain) ??
    0;
  const paybackStatus = payback?.scheduler?.status || payback?.status || null;
  const paybackReason = payback?.scheduler?.reason || payback?.reason || null;
  const paybackMinimumProgress = payback?.scheduler?.minimumPaybackProgress || payback?.scheduler?.previewAfterDestination || null;
  const paybackPendingSats =
    finiteNumber(payback?.carry?.pendingSats) ??
    finiteNumber(payback?.accumulatorPendingSats) ??
    null;
  const paybackProgressToMinimumRatio =
    finiteNumber(payback?.carry?.progressToMinimumRatio) ??
    finiteNumber(payback?.scheduler?.minimumPaybackProgress?.progressToMinimumRatio) ??
    null;
  const hysteresis = marksSlice?.reliability?.hysteresis || {};
  const recovery24h = marksSlice?.reliability?.recovery24h || {};
  const recovery24hStageB = recovery24h.stageB || {};
  const recovery24hHysteresis = recovery24h.hysteresis || {};
  const latestAttempt = marksSlice?.reliability?.latestAttempt || {};
  const refreshBelow90SustainedFor1h = hysteresis.refreshBelow90SustainedFor1h === true;
  const refreshBelow90Since = hysteresis.refreshBelow90Since || null;
  const latestMarkSuccessObservedAt = latestAttempt.successObservedAt || null;
  const latestMarkFailureObservedAt = latestAttempt.failureObservedAt || null;
  const latestMarkFailureKind = latestAttempt.failureKind || null;
  const latestMarkFailurePositionId = latestAttempt.failurePositionId || null;
  const calibrated = evGateCalibrated(evGateStats);

  const stageBReady =
    calibrated &&
    Number.isFinite(refreshSuccessRatio24h) &&
    refreshSuccessRatio24h >= 0.95 &&
    Number.isFinite(transientFrequency24h) &&
    transientFrequency24h < 0.05;
  const stageCReady =
    stageBReady &&
    unresolvedRefillRoutes === 0 &&
    deliveredPeriodCountOnReserveChain >= 1;

  let currentStage = "A";
  if (stageCReady && !refreshBelow90SustainedFor1h) {
    currentStage = "C";
  } else if (stageBReady || refreshBelow90SustainedFor1h) {
    currentStage = "B";
  }

  return {
    currentStage,
    blockers: compact([
      calibrated ? null : "ev_gate_not_calibrated",
      Number.isFinite(refreshSuccessRatio24h) && refreshSuccessRatio24h >= 0.95
        ? null
        : "refresh_success_ratio_below_stage_b_threshold",
      Number.isFinite(transientFrequency24h) && transientFrequency24h < 0.05
        ? null
        : "transient_frequency_above_stage_b_threshold",
      unresolvedRefillRoutes === 0 ? null : "refill_routes_unresolved",
      deliveredPeriodCountOnReserveChain >= 1 ? null : "receipt_proven_payback_period_missing",
      refreshBelow90SustainedFor1h ? "stage_c_hysteresis_demoted" : null,
    ]),
    evidence: {
      refreshSuccessRatio1h,
      refreshSuccessRatio3h,
      refreshSuccessRatio24h,
      refreshSuccessRatio7d,
      transientFrequency1h,
      transientFrequency3h,
      transientFrequency24h,
      transientFrequency7d,
      unresolvedRefillRoutes,
      reserveChain,
      deliveredPeriodCountOnReserveChain,
      paybackStatus,
      paybackReason,
      paybackPendingSats,
      paybackProgressToMinimumRatio,
      paybackReceiptProof: {
        reserveChain,
        requiredDeliveredPeriodCountOnReserveChain: 1,
        deliveredPeriodCountOnReserveChain,
        ready: deliveredPeriodCountOnReserveChain >= 1,
        blocker: deliveredPeriodCountOnReserveChain >= 1 ? null : "receipt_proven_payback_period_missing",
        status: paybackStatus,
        reason: paybackReason,
        pendingSats: paybackPendingSats,
        minPaybackSats: finiteNumber(paybackMinimumProgress?.minPaybackSats),
        grossTargetBeforeCostsSats: finiteNumber(paybackMinimumProgress?.grossTargetBeforeCostsSats),
        satsToMinimumPayback: finiteNumber(paybackMinimumProgress?.satsToMinimumPayback),
        proposedMinPaybackPatch: payback?.proposedMinPaybackPatch || payback?.minimumReview?.proposedPatchPath || null,
      },
      evGateCalibrated: calibrated,
      evGateMatchedReceiptCount: finiteNumber(evGateStats?.matchedReceiptCount) ?? 0,
      evGateKeyedEntryCount: finiteNumber(evGateStats?.keyedEntryCount) ?? 0,
      evGateLookbackDays: finiteNumber(evGateStats?.lookbackDays) ?? null,
      latestMarkSuccessObservedAt,
      latestMarkFailureObservedAt,
      latestMarkFailureKind,
      latestMarkFailurePositionId,
      refreshBelow90Since,
      refreshBelow90SustainedFor1h,
      refresh24hStageBSuccessesNeeded: finiteNumber(recovery24hStageB.successesNeeded),
      refresh24hStageBEarliestRecoveryAt: recovery24hStageB.earliestRecoveryAt || null,
      refresh24hHysteresisSuccessesNeeded: finiteNumber(recovery24hHysteresis.successesNeeded),
      refresh24hHysteresisEarliestRecoveryAt: recovery24hHysteresis.earliestRecoveryAt || null,
    },
  };
}
