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
  const refreshSuccessRatio24h =
    finiteNumber(marksSlice?.reliability?.rolling24h?.refreshSuccessRatio) ??
    finiteNumber(marksSlice?.refreshSuccessRatio?.rolling24h);
  const refreshSuccessRatio7d =
    finiteNumber(marksSlice?.reliability?.rolling7d?.refreshSuccessRatio) ??
    finiteNumber(marksSlice?.refreshSuccessRatio?.rolling7d);
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
    capitalPlan?.payback?.reserveChain ||
    capitalPlan?.expansionGate?.reserveChain ||
    capitalPlan?.reserveChain ||
    null;
  const deliveredPeriodCountOnReserveChain =
    finiteNumber(capitalPlan?.payback?.deliveredPeriodCountOnReserveChain) ??
    finiteNumber(capitalPlan?.expansionGate?.deliveredPeriodCountOnReserveChain) ??
    0;
  const hysteresis = marksSlice?.reliability?.hysteresis || {};
  const refreshBelow90SustainedFor1h = hysteresis.refreshBelow90SustainedFor1h === true;
  const refreshBelow90Since = hysteresis.refreshBelow90Since || null;
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
      refreshSuccessRatio24h,
      refreshSuccessRatio7d,
      transientFrequency24h,
      transientFrequency7d,
      unresolvedRefillRoutes,
      reserveChain,
      deliveredPeriodCountOnReserveChain,
      evGateCalibrated: calibrated,
      evGateMatchedReceiptCount: finiteNumber(evGateStats?.matchedReceiptCount) ?? 0,
      evGateKeyedEntryCount: finiteNumber(evGateStats?.keyedEntryCount) ?? 0,
      evGateLookbackDays: finiteNumber(evGateStats?.lookbackDays) ?? null,
      refreshBelow90Since,
      refreshBelow90SustainedFor1h,
    },
  };
}
