function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstFinite(candidates = []) {
  for (const candidate of candidates) {
    const parsed = finiteNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function isLeverageStrategy(strategy = {}, intent = {}) {
  return (
    intent.isLeverage === true ||
    intent.strategyConfig?.isLeverage === true ||
    Boolean(intent.strategyConfig?.leverage) ||
    Boolean(strategy?.leverage)
  );
}

export function evaluateLeverageCollateralRule({
  strategy = {},
  intent = {},
  now = new Date().toISOString(),
} = {}) {
  const leverage = isLeverageStrategy(strategy, intent);
  const actualCollateralUnits = firstFinite([
    intent.collateral?.actualCollateralUnits,
    intent.positionState?.actualCollateralUnits,
    intent.metadata?.actualCollateralUnits,
    strategy.collateral?.actualCollateralUnits,
  ]);
  const requiredCollateralUnitsForCap = firstFinite([
    intent.collateral?.requiredCollateralUnitsForCap,
    intent.positionState?.requiredCollateralUnitsForCap,
    intent.metadata?.requiredCollateralUnitsForCap,
    strategy.collateral?.requiredCollateralUnitsForCap,
    strategy.leverage?.requiredCollateralUnitsForCap,
  ]);
  const blockers =
    leverage &&
    actualCollateralUnits !== null &&
    requiredCollateralUnitsForCap !== null &&
    actualCollateralUnits < requiredCollateralUnitsForCap
      ? ["collateral_below_cap_requirement"]
      : [];

  return {
    policy: "leverage_collateral",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    metrics: {
      leverage,
      actualCollateralUnits,
      requiredCollateralUnitsForCap,
    },
  };
}
