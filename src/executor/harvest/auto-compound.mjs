export function featureEnabled(profile = {}) {
  return profile.autoCompound !== false;
}

export function buildCompoundIntent(
  {
    strategyId,
    chain,
    protocol,
    harvestedAmountUsd,
    compoundRatio = 0.8,
    now = new Date().toISOString(),
  } = {},
  { profile = {} } = {},
) {
  if (!featureEnabled(profile)) return null;

  const harvested = Number(harvestedAmountUsd);
  if (!Number.isFinite(harvested) || harvested <= 0) return null;

  const ratio = Math.max(0, Math.min(1, Number(compoundRatio) || 0.8));
  const compoundAmountUsd = harvested * ratio;
  const paybackAmountUsd = harvested - compoundAmountUsd;

  return {
    intentType: "compound",
    strategyId,
    chain,
    protocol,
    harvestedAmountUsd: harvested,
    compoundAmountUsd,
    paybackAmountUsd,
    compoundRatio: ratio,
    observedAt: now,
    metadata: {
      harvestCompound: true,
      paybackAccumulatorAmountUsd: paybackAmountUsd,
    },
  };
}
