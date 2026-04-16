const DEFAULT_FAILED_GAS_COST_24H_USD = 3;

export const STRATEGY_CAPS = Object.freeze({
  "gateway-instant-swap-verification": Object.freeze({
    strategyId: "gateway-instant-swap-verification",
    label: "BOB Gateway / Instant Swap quote verification",
    autoExecute: false,
    intentTtlMs: 30_000,
    caps: Object.freeze({
      perTxUsd: 25,
      perDayUsd: 300,
      perChainUsd: Object.freeze({
        bob: 150,
        base: 100,
        ethereum: 100,
      }),
      maxDailyLossUsd: 25,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    gasFloat: Object.freeze({
      bob: Object.freeze({ minUsd: 8, targetUsd: 15 }),
      base: Object.freeze({ minUsd: 6, targetUsd: 12 }),
      ethereum: Object.freeze({ minUsd: 15, targetUsd: 30 }),
    }),
  }),
  "gateway-btc-funding-transfer": Object.freeze({
    strategyId: "gateway-btc-funding-transfer",
    label: "Gateway BTC funding transfer",
    autoExecute: true,
    intentTtlMs: 60_000,
    caps: Object.freeze({
      perTxUsd: 50,
      perDayUsd: 150,
      perChainUsd: Object.freeze({
        avalanche: 75,
        sonic: 75,
        soneium: 75,
        base: 75,
      }),
      maxDailyLossUsd: 15,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    gasFloat: Object.freeze({
      avalanche: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      sonic: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      soneium: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
    }),
  }),
  "gateway-btc-onramp": Object.freeze({
    strategyId: "gateway-btc-onramp",
    label: "Gateway BTC onramp",
    autoExecute: false,
    intentTtlMs: 60_000,
    caps: Object.freeze({
      perTxUsd: 75,
      perDayUsd: 300,
      perChainUsd: Object.freeze({
        bitcoin: 300,
        base: 300,
      }),
      maxDailyLossUsd: 20,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    gasFloat: Object.freeze({
      base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
    }),
  }),
  "wrapper-btc-arbitrage": Object.freeze({
    strategyId: "wrapper-btc-arbitrage",
    label: "Wrapper BTC arbitrage",
    autoExecute: false,
    intentTtlMs: 45_000,
    caps: Object.freeze({
      perTxUsd: 100,
      perDayUsd: 600,
      perChainUsd: Object.freeze({
        bob: 250,
        base: 250,
        unichain: 150,
      }),
      maxDailyLossUsd: 40,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    gasFloat: Object.freeze({
      bob: Object.freeze({ minUsd: 10, targetUsd: 18 }),
      base: Object.freeze({ minUsd: 8, targetUsd: 16 }),
      unichain: Object.freeze({ minUsd: 6, targetUsd: 12 }),
    }),
  }),
  "wrapped-btc-loop-base-moonwell": Object.freeze({
    strategyId: "wrapped-btc-loop-base-moonwell",
    label: "Wrapped BTC lending loop (Base / Moonwell)",
    autoExecute: true,
    intentTtlMs: 60_000,
    caps: Object.freeze({
      perTxUsd: 300,
      perDayUsd: 600,
      perChainUsd: Object.freeze({
        base: 300,
      }),
      maxDailyLossUsd: 50,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    leverage: Object.freeze({
      healthFactorMin: 1.35,
      liquidationBufferPct: 12,
      emergencyUnwindPath: Object.freeze([
        "repay borrow asset",
        "withdraw collateral",
        "bridge or swap back to settlement path",
      ]),
    }),
    gasFloat: Object.freeze({
      base: Object.freeze({ minUsd: 10, targetUsd: 20 }),
    }),
  }),
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function getStrategyCaps(strategyId) {
  return STRATEGY_CAPS[strategyId] || null;
}

export function listStrategyCaps() {
  return Object.values(STRATEGY_CAPS);
}

export function validateStrategyCapsConfig(config = {}) {
  const errors = [];
  if (!config.strategyId) errors.push("strategyId is required");
  if (!config.caps || typeof config.caps !== "object") {
    errors.push("caps are required");
  } else {
    for (const field of ["perTxUsd", "perDayUsd", "maxDailyLossUsd"]) {
      if (!isFiniteNumber(config.caps[field])) {
        errors.push(`caps.${field} must be a finite number`);
      }
    }
    if (!config.caps.perChainUsd || typeof config.caps.perChainUsd !== "object" || Object.keys(config.caps.perChainUsd).length === 0) {
      errors.push("caps.perChainUsd must declare at least one chain budget");
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
