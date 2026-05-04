export const SIZING_POLICY = Object.freeze({
  tierLeverageMultiplier: Object.freeze({
    TIER_A: 1.5,
    TIER_B: 1.0,
    TIER_C: 0.5,
  }),
  minPositionUsd: 25,
  maxSinglePositionPct: 0.25,
});

export const TINY_CANARY_COST_POLICY = Object.freeze({
  defaultSameChainRoundTripCostUsd: 0.12,
  sameChainRoundTripCostUsdByChain: Object.freeze({
    base: 0.012,
    bob: 0.003,
    optimism: 0.003,
    unichain: 0.003,
    sei: 0.003,
    soneium: 0.003,
    sonic: 0.003,
    avalanche: 0.003,
    bera: 0.003,
    bsc: 0.03,
    ethereum: 0.36,
  }),
  safetyFactor: 0.5,
  fallbackHoldDays: 7,
});

export const EXECUTION_EV_COST_POLICY = Object.freeze({
  lookbackDays: 90,
  minSamples: 10,
  costPercentile: 0.9,
  costMultiplier: 1,
  minProfitFloorUsd: 0,
  defaultP99CostUsd: 0.12,
  p99CostUsdByChain: Object.freeze({
    avalanche: 0.081,
    base: 5.25,
    bera: 0.10,
    bob: 4.25,
    bsc: 0.067,
    ethereum: 8.52,
    optimism: 0.002,
    sei: 9.21,
    soneium: 0.057,
    sonic: 0.001,
    unichain: 0.002,
  }),
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

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveTinyCanaryExpectedHoldDays({
  expectedHoldDays = null,
  campaignRemainingHours = null,
  campaignEndsAt = null,
  now = new Date().toISOString(),
  fallbackDays = TINY_CANARY_COST_POLICY.fallbackHoldDays,
} = {}) {
  const explicit = finitePositive(expectedHoldDays);
  if (explicit !== null) return explicit;
  const remainingHours = finitePositive(campaignRemainingHours);
  if (remainingHours !== null) return remainingHours / 24;
  if (campaignEndsAt) {
    const remainingMs = new Date(campaignEndsAt).getTime() - new Date(now).getTime();
    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      return remainingMs / 86_400_000;
    }
  }
  return fallbackDays;
}

export function tinyCanarySameChainRoundTripCostUsd({
  chain = null,
  estimatedGasCostUsd = null,
  policy = TINY_CANARY_COST_POLICY,
} = {}) {
  const explicitCost = finitePositive(estimatedGasCostUsd);
  if (explicitCost !== null) return explicitCost;
  const chainKey = String(chain || "").trim().toLowerCase();
  const chainCost = policy.sameChainRoundTripCostUsdByChain?.[chainKey];
  return finitePositive(chainCost) ?? policy.defaultSameChainRoundTripCostUsd;
}

export function executionEvFallbackCostUsd({
  chain = null,
  policy = EXECUTION_EV_COST_POLICY,
} = {}) {
  const chainKey = String(chain || "").trim().toLowerCase();
  const chainCost = policy.p99CostUsdByChain?.[chainKey];
  return finitePositive(chainCost) ?? policy.defaultP99CostUsd;
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

export function computeTinyCanaryMinProfitablePositionUsd({
  chain = null,
  aprPct = null,
  aprDecimal = null,
  expectedHoldDays = null,
  estimatedGasCostUsd = null,
  policy = TINY_CANARY_COST_POLICY,
} = {}) {
  const aprPctValue = finitePositive(aprPct);
  const postedAprDecimal =
    finitePositive(aprDecimal) ?? (aprPctValue !== null ? aprPctValue / 100 : null);
  const holdDays = finitePositive(expectedHoldDays);
  return computeMinProfitablePositionUsd({
    roundTripCostUsd: tinyCanarySameChainRoundTripCostUsd({
      chain,
      estimatedGasCostUsd,
      policy,
    }),
    postedAprDecimal,
    expectedHoldYearFraction: holdDays === null ? null : holdDays / 365,
    safetyFactor: policy.safetyFactor,
  });
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
