export const SIZING_POLICY = Object.freeze({
  tierLeverageMultiplier: Object.freeze({
    TIER_A: 1.5,
    TIER_B: 1.0,
    TIER_C: 0.5,
  }),
  minPositionUsd: 25,
  maxSinglePositionPct: 0.25,
});

export function sizingPolicy(overrides = {}) {
  return Object.freeze({
    ...SIZING_POLICY,
    ...(overrides.tierLeverageMultiplier
      ? {
          tierLeverageMultiplier: Object.freeze({
            ...SIZING_POLICY.tierLeverageMultiplier,
            ...overrides.tierLeverageMultiplier,
          }),
        }
      : {}),
    minPositionUsd:
      overrides.minPositionUsd ?? SIZING_POLICY.minPositionUsd,
    maxSinglePositionPct:
      overrides.maxSinglePositionPct ?? SIZING_POLICY.maxSinglePositionPct,
  });
}

export function computeMinProfitablePositionUsd({
  roundTripCostUsd,
  postedAprDecimal,
  expectedHoldYearFraction,
  safetyFactor = 0.5,
} = {}) {
  if (
    !Number.isFinite(roundTripCostUsd) ||
    roundTripCostUsd <= 0 ||
    !Number.isFinite(postedAprDecimal) ||
    postedAprDecimal <= 0 ||
    !Number.isFinite(expectedHoldYearFraction) ||
    expectedHoldYearFraction <= 0 ||
    !Number.isFinite(safetyFactor) ||
    safetyFactor <= 0
  ) {
    return null;
  }
  const denominator =
    postedAprDecimal * expectedHoldYearFraction * safetyFactor;
  if (denominator <= 0) return null;
  return roundTripCostUsd / denominator;
}

export function computePositionUsd({
  totalDeployableCapital,
  opportunityScore,
  sumOfTopNScores,
  tier,
  chainConcentrationPenalty = 0,
  protocolConcentrationPenalty = 0,
  sizing = SIZING_POLICY,
} = {}) {
  if (
    !Number.isFinite(totalDeployableCapital) ||
    totalDeployableCapital <= 0 ||
    !Number.isFinite(opportunityScore) ||
    opportunityScore < 0 ||
    !Number.isFinite(sumOfTopNScores) ||
    sumOfTopNScores <= 0
  ) {
    return 0;
  }
  const tierMult =
    sizing.tierLeverageMultiplier[tier] ??
    sizing.tierLeverageMultiplier.TIER_C ??
    0.5;
  const scoreWeight = opportunityScore / sumOfTopNScores;
  const concentrationMult =
    (1 - Math.max(0, Math.min(1, chainConcentrationPenalty))) *
    (1 - Math.max(0, Math.min(1, protocolConcentrationPenalty)));
  const raw =
    totalDeployableCapital * scoreWeight * tierMult * concentrationMult;
  const maxPosition = totalDeployableCapital * sizing.maxSinglePositionPct;
  const clamped = Math.min(
    Math.max(raw, sizing.minPositionUsd),
    maxPosition
  );
  return clamped;
}
