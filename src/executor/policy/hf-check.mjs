function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function evaluateHealthFactorCheck({
  intent = {},
  strategyCaps = null,
  now = new Date().toISOString(),
} = {}) {
  const leverageConfig = strategyCaps?.leverage || intent.strategyConfig?.leverage || intent.strategyConfig || {};
  const isLeverage = intent.isLeverage === true || Boolean(strategyCaps?.leverage) || Boolean(intent.strategyConfig?.isLeverage);
  const blockers = [];
  const triggers = [];

  if (!isLeverage) {
    return {
      policy: "hf_check",
      observedAt: now,
      decision: "ALLOW",
      blockers,
      triggers,
      requiresUnwind: false,
    };
  }

  if (!isFiniteNumber(leverageConfig.healthFactorMin)) {
    blockers.push("health_factor_min_missing");
  }
  if (!isFiniteNumber(leverageConfig.liquidationBufferPct)) {
    blockers.push("liquidation_buffer_min_missing");
  }

  const currentHealthFactor = intent.healthFactor?.current ?? intent.positionState?.currentHealthFactor ?? null;
  const projectedHealthFactor = intent.healthFactor?.projectedPost ?? intent.positionState?.projectedHealthFactor ?? null;
  const currentLiquidationBufferPct =
    intent.liquidationBuffer?.currentPct ?? intent.positionState?.currentLiquidationBufferPct ?? null;
  const projectedLiquidationBufferPct =
    intent.liquidationBuffer?.projectedPostPct ?? intent.positionState?.projectedLiquidationBufferPct ?? null;

  const isEmergencyUnwind = intent.intentType === "emergency_unwind";

  if (isFiniteNumber(currentHealthFactor) && isFiniteNumber(leverageConfig.healthFactorMin) && currentHealthFactor < leverageConfig.healthFactorMin) {
    if (!isEmergencyUnwind) blockers.push("health_factor_below_min_pre_trade");
    triggers.push("health_factor_below_min");
  }
  if (isFiniteNumber(projectedHealthFactor) && isFiniteNumber(leverageConfig.healthFactorMin) && projectedHealthFactor < leverageConfig.healthFactorMin) {
    if (!isEmergencyUnwind) blockers.push("health_factor_below_min_post_trade");
    triggers.push("projected_health_factor_below_min");
  }
  if (
    isFiniteNumber(currentLiquidationBufferPct) &&
    isFiniteNumber(leverageConfig.liquidationBufferPct) &&
    currentLiquidationBufferPct < leverageConfig.liquidationBufferPct
  ) {
    if (!isEmergencyUnwind) blockers.push("liquidation_buffer_below_min_pre_trade");
    triggers.push("liquidation_buffer_below_min");
  }
  if (
    isFiniteNumber(projectedLiquidationBufferPct) &&
    isFiniteNumber(leverageConfig.liquidationBufferPct) &&
    projectedLiquidationBufferPct < leverageConfig.liquidationBufferPct
  ) {
    if (!isEmergencyUnwind) blockers.push("liquidation_buffer_below_min_post_trade");
    triggers.push("projected_liquidation_buffer_below_min");
  }

  return {
    policy: "hf_check",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers: unique(blockers),
    triggers: unique(triggers),
    requiresUnwind: isEmergencyUnwind ? true : triggers.length > 0,
    emergencyUnwindPath: strategyCaps?.leverage?.emergencyUnwindPath || null,
  };
}
