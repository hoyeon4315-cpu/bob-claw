function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

export function evaluateLeverageWatcher({
  strategyConfig = {},
  positionState = {},
  marketState = {},
} = {}) {
  const triggers = unique([
    Number.isFinite(positionState.currentHealthFactor) &&
    Number.isFinite(strategyConfig.unwindTriggerHealthFactor) &&
    positionState.currentHealthFactor <= strategyConfig.unwindTriggerHealthFactor
      ? "health_factor_at_unwind_trigger"
      : null,
    Number.isFinite(positionState.currentHealthFactor) &&
    Number.isFinite(strategyConfig.healthFactorMin) &&
    positionState.currentHealthFactor < strategyConfig.healthFactorMin
      ? "health_factor_below_min"
      : null,
    Number.isFinite(positionState.currentLiquidationBufferPct) &&
    Number.isFinite(strategyConfig.liquidationBufferPct) &&
    positionState.currentLiquidationBufferPct < strategyConfig.liquidationBufferPct
      ? "liquidation_buffer_below_min"
      : null,
    Number.isFinite(marketState.oracleDriftPct) &&
    Number.isFinite(marketState.oracleDriftTriggerPct) &&
    marketState.oracleDriftPct >= marketState.oracleDriftTriggerPct
      ? "oracle_drift_above_trigger"
      : null,
    Number.isFinite(marketState.unwindGasUsd) &&
    Number.isFinite(marketState.maxUnwindGasUsd) &&
    marketState.unwindGasUsd >= marketState.maxUnwindGasUsd
      ? "unwind_gas_above_budget"
      : null,
  ]);

  const shouldAutoUnwind = triggers.some((trigger) =>
    ["health_factor_at_unwind_trigger", "health_factor_below_min", "liquidation_buffer_below_min"].includes(trigger),
  );
  const shouldPauseNewEntries =
    shouldAutoUnwind || triggers.some((trigger) => ["oracle_drift_above_trigger", "unwind_gas_above_budget"].includes(trigger));

  return {
    status: shouldAutoUnwind ? "auto_unwind" : shouldPauseNewEntries ? "pause_new_entries" : "healthy",
    triggers,
    shouldAutoUnwind,
    shouldPauseNewEntries,
  };
}

export function buildEmergencyUnwindExecutionPlan({
  strategyConfig = {},
  protocolAdapter = null,
  unwindActions = [],
  watcherDecision = null,
  positionState = {},
  now = null,
} = {}) {
  const activeDecision = watcherDecision || evaluateLeverageWatcher({ strategyConfig, positionState });
  const activationReason = activeDecision.triggers[0] || null;
  return {
    planId: `${strategyConfig.id || "leverage"}:unwind`,
    generatedAt: now || new Date().toISOString(),
    status: activeDecision.shouldAutoUnwind ? "ready_to_execute" : "standby",
    activationReason,
    protocolAdapterId: protocolAdapter?.id || null,
    requiresDryRunReceipt: true,
    actions: unwindActions,
    notes: [
      "This executor plan is deterministic and signer-facing only; it does not call contracts from the dashboard or LLM path.",
      activeDecision.shouldAutoUnwind
        ? "A live threshold breach should execute this plan immediately."
        : "Plan remains on standby until a configured breach trigger fires.",
    ],
  };
}
