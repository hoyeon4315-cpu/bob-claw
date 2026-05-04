import { STRATEGY_CAPS } from "./strategy-caps/registry.mjs";
import { ACTIVE_SLEEVE_PROFILE, resolveProfileCapMatrix } from "./sleeve-profile.mjs";

export { STRATEGY_CAPS };

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function getStrategyCaps(strategyId) {
  return STRATEGY_CAPS[strategyId] || null;
}

export function listStrategyCaps() {
  return Object.values(STRATEGY_CAPS);
}

export function resolveStrategyCapMatrix(
  strategyOrId,
  { profileId = ACTIVE_SLEEVE_PROFILE.id, includeRadarCaps = false } = {},
) {
  const strategy = typeof strategyOrId === "string" ? getStrategyCaps(strategyOrId) : strategyOrId;
  if (!strategy) return null;
  return resolveProfileCapMatrix(strategy, { profileId, includeRadarCaps });
}

function effectiveActiveStrategyCapUsd(config = {}) {
  const perChainCaps = Object.values(config?.caps?.perChainUsd || {}).filter(isFiniteNumber);
  const candidates = [
    config?.caps?.perDayUsd,
    perChainCaps.length > 0 ? Math.max(...perChainCaps) : null,
  ].filter(isFiniteNumber);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function deriveConfiguredActiveBudgetUsd({
  strategies = listStrategyCaps(),
  includeAutoExecuteOnly = true,
  excludeStrategyIds = ["gateway-instant-swap-verification", "prelive_fork_execution"],
} = {}) {
  const excluded = new Set(excludeStrategyIds);
  const activeCaps = (strategies || [])
    .filter((config) => config?.strategyId && !excluded.has(config.strategyId))
    .filter((config) => (includeAutoExecuteOnly ? config?.autoExecute === true : true))
    .map((config) => effectiveActiveStrategyCapUsd(config))
    .filter(isFiniteNumber);
  return activeCaps.length > 0 ? Math.max(...activeCaps) : null;
}

export function validateStrategyCapsConfig(config = {}) {
  const errors = [];
  if (!config.strategyId) errors.push("strategyId is required");
  if (!config.caps || typeof config.caps !== "object") {
    errors.push("caps are required");
  } else {
    for (const field of ["perTxUsd", "perDayUsd", "maxDailyLossUsd", "maxFailedGasCost24hUsd"]) {
      if (!isFiniteNumber(config.caps[field])) {
        errors.push(`caps.${field} must be a finite number`);
      }
    }
    if (!config.caps.perChainUsd || typeof config.caps.perChainUsd !== "object" || Object.keys(config.caps.perChainUsd).length === 0) {
      errors.push("caps.perChainUsd must declare at least one chain budget");
    }
    if (config.caps.tinyLivePerTxUsd !== undefined && !isFiniteNumber(config.caps.tinyLivePerTxUsd)) {
      errors.push("caps.tinyLivePerTxUsd must be a finite number when provided");
    }
  }
  if (config.leverage) {
    if (!isFiniteNumber(config.leverage.healthFactorMin)) {
      errors.push("leverage.healthFactorMin must be a finite number");
    }
    if (!isFiniteNumber(config.leverage.liquidationBufferPct)) {
      errors.push("leverage.liquidationBufferPct must be a finite number");
    }
    if (!Array.isArray(config.leverage.emergencyUnwindPath) || config.leverage.emergencyUnwindPath.length === 0) {
      errors.push("leverage.emergencyUnwindPath must be a non-empty array");
    }
  }
  if (config.exposure) {
    if (!Array.isArray(config.exposure.protocols) || config.exposure.protocols.length === 0) {
      errors.push("exposure.protocols must be a non-empty array when provided");
    }
    if (config.exposure.assetFamily !== undefined && typeof config.exposure.assetFamily !== "string") {
      errors.push("exposure.assetFamily must be a string when provided");
    }
    if (config.exposure.btcDenominated !== undefined && typeof config.exposure.btcDenominated !== "boolean") {
      errors.push("exposure.btcDenominated must be a boolean when provided");
    }
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertStrategyCaps(strategyId) {
  const config = getStrategyCaps(strategyId);
  if (!config) {
    throw new Error(`Unknown strategy caps for ${strategyId}`);
  }
  const validation = validateStrategyCapsConfig(config);
  if (!validation.ok) {
    throw new Error(`Invalid strategy caps for ${strategyId}: ${validation.errors.join(", ")}`);
  }
  return config;
}

export function capsForChain(strategyId, chain) {
  const config = assertStrategyCaps(strategyId);
  return config.caps.perChainUsd?.[chain] ?? null;
}
