// Deterministic emergency-unwind intent builder.
// Pure function. No I/O, no LLM. The caller (strategy tick or daemon client)
// provides the original intent and the emergencyUnwindPath from strategy caps.
// The returned intent is ready for normalizeExecutionIntent.

export function buildEmergencyUnwindIntent({
  strategyId,
  chain,
  family = "evm",
  amountUsd = 0,
  emergencyUnwindPath = [],
  triggers = [],
  positionState = {},
  marketState = {},
  now = new Date().toISOString(),
  metadata = {},
} = {}) {
  if (!strategyId) throw new Error("strategyId is required");
  if (!chain) throw new Error("chain is required");
  return {
    schemaVersion: 1,
    intentId: `${strategyId}:emergency-unwind:${now}`,
    strategyId,
    chain,
    family,
    mode: "emergency",
    intentType: "emergency_unwind",
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : 0,
    executionReason: "risk_unwind",
    observedAt: now,
    metadata: {
      ...metadata,
      emergencyUnwindPath: Array.isArray(emergencyUnwindPath) ? emergencyUnwindPath : [],
      triggers: Array.isArray(triggers) ? triggers : [],
      healthFactorPath: positionState?.currentHealthFactor ?? metadata?.healthFactorPath ?? null,
      liquidationBufferPath: positionState?.currentLiquidationBufferPct ?? metadata?.liquidationBufferPath ?? null,
    },
  };
}
