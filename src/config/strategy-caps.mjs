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
        bob: 1_000_000,
        base: 1_000_000,
        ethereum: 1_000_000,
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
    exposure: Object.freeze({
      protocols: Object.freeze(["gateway"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 50,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        bob: 1_000_000,
        avalanche: 1_000_000,
        bera: 1_000_000,
        bsc: 1_000_000,
        ethereum: 75,
        sonic: 1_000_000,
        soneium: 1_000_000,
        base: 75,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
      gasFloat: Object.freeze({
        bob: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        avalanche: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bera: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bsc: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        ethereum: Object.freeze({ minUsd: 10, targetUsd: 20 }),
        sonic: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        soneium: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        unichain: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      }),
  }),
  "gateway-btc-onramp": Object.freeze({
    strategyId: "gateway-btc-onramp",
    label: "Gateway BTC onramp",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["gateway"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 75,
      perDayUsd: 300,
      perChainUsd: Object.freeze({
        bitcoin: 1_000_000,
        base: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    gasFloat: Object.freeze({
      base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
    }),
  }),
  "gateway-btc-offramp": Object.freeze({
    strategyId: "gateway-btc-offramp",
    label: "Gateway BTC offramp",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["gateway"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 50,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        bob: 1_000_000,
        base: 75,
        avalanche: 1_000_000,
        bera: 1_000_000,
        bsc: 1_000_000,
        ethereum: 1_000_000,
        soneium: 1_000_000,
        sonic: 1_000_000,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
      gasFloat: Object.freeze({
        bob: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        avalanche: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bera: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bsc: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        ethereum: Object.freeze({ minUsd: 10, targetUsd: 20 }),
        soneium: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        sonic: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        unichain: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      }),
  }),
  "gas-zip-native-refuel": Object.freeze({
    strategyId: "gas-zip-native-refuel",
    label: "Gas.Zip native gas refuel fallback",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["gas_zip"]),
      assetFamily: "native_gas",
      btcDenominated: false,
    }),
    caps: Object.freeze({
      perTxUsd: 20,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        bob: 1_000_000,
        avalanche: 1_000_000,
        bera: 1_000_000,
        bsc: 1_000_000,
        ethereum: 1_000_000,
        optimism: 1_000_000,
        sei: 1_000_000,
        soneium: 1_000_000,
        sonic: 1_000_000,
        base: 25,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    gasFloat: Object.freeze({
      bob: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      avalanche: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      bera: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      bsc: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      ethereum: Object.freeze({ minUsd: 10, targetUsd: 20 }),
      optimism: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      sei: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      soneium: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      sonic: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      unichain: Object.freeze({ minUsd: 3, targetUsd: 6 }),
    }),
  }),
  "native-dex-experiment": Object.freeze({
    strategyId: "native-dex-experiment",
    label: "Native asset DEX experiment",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["odos"]),
      assetFamily: "native_gas",
      btcDenominated: false,
    }),
    caps: Object.freeze({
      perTxUsd: 50,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        base: 1_000_000,
        avalanche: 1_000_000,
        bera: 1_000_000,
        bsc: 1_000_000,
        ethereum: 1_000_000,
        soneium: 1_000_000,
        sonic: 1_000_000,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
      gasFloat: Object.freeze({
        base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        avalanche: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bera: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bsc: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        ethereum: Object.freeze({ minUsd: 10, targetUsd: 20 }),
        soneium: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        sonic: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        unichain: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      }),
  }),
  "token-dex-experiment": Object.freeze({
    strategyId: "token-dex-experiment",
    label: "ERC20 token DEX experiment",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["odos"]),
      assetFamily: "mixed_assets",
      btcDenominated: false,
    }),
    caps: Object.freeze({
      perTxUsd: 50,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        base: 1_000_000,
        avalanche: 1_000_000,
        bera: 1_000_000,
        bsc: 1_000_000,
        ethereum: 1_000_000,
        soneium: 1_000_000,
        sonic: 1_000_000,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
      gasFloat: Object.freeze({
        base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        avalanche: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bera: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bsc: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        ethereum: Object.freeze({ minUsd: 10, targetUsd: 20 }),
        soneium: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        sonic: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        unichain: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      }),
  }),
  "proxy-spread-experiment": Object.freeze({
    strategyId: "proxy-spread-experiment",
    label: "BTC proxy spread experiment",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["gateway", "odos"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 25,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        base: 25,
        avalanche: 1_000_000,
        bera: 1_000_000,
        bsc: 1_000_000,
        ethereum: 1_000_000,
        sonic: 1_000_000,
        soneium: 1_000_000,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
      gasFloat: Object.freeze({
        base: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        avalanche: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bera: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        bsc: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        ethereum: Object.freeze({ minUsd: 10, targetUsd: 20 }),
        sonic: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        soneium: Object.freeze({ minUsd: 3, targetUsd: 6 }),
        unichain: Object.freeze({ minUsd: 3, targetUsd: 6 }),
      }),
  }),
  "wrapper-btc-arbitrage": Object.freeze({
    strategyId: "wrapper-btc-arbitrage",
    label: "Wrapper BTC arbitrage",
    autoExecute: false,
    intentTtlMs: 45_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["gateway"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 100,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        bob: 1_000_0000,
        base: 1_000_000,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    gasFloat: Object.freeze({
      bob: Object.freeze({ minUsd: 10, targetUsd: 18 }),
      base: Object.freeze({ minUsd: 8, targetUsd: 16 }),
      unichain: Object.freeze({ minUsd: 6, targetUsd: 12 }),
    }),
  }),
  "prelive_fork_execution": Object.freeze({
    strategyId: "prelive_fork_execution",
    label: "Pre-live fork execution",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["gateway"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 25,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        bob: 1_000_000,
        base: 25,
        avalanche: 1_000_000,
        bera: 1_000_000,
        bsc: 1_000_000,
        ethereum: 1_000_000,
        sonic: 1_000_000,
        soneium: 1_000_000,
        unichain: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
  }),
  "recursive_wrapped_btc_lending_loop": Object.freeze({
    strategyId: "recursive_wrapped_btc_lending_loop",
    label: "Recursive wrapped-BTC lending loop",
    autoExecute: false,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["moonwell", "odos"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 1_000_000,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        base: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
      maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    }),
    leverage: Object.freeze({
      healthFactorMin: 1.35,
      liquidationBufferPct: 12,
      emergencyUnwindPath: Object.freeze([
        "repay USDC debt",
        "withdraw cbBTC collateral",
        "return collateral to BTC treasury sleeve",
      ]),
    }),
    gasFloat: Object.freeze({
      base: Object.freeze({ minUsd: 10, targetUsd: 20 }),
    }),
  }),
  "wrapped-btc-loop-base-moonwell": Object.freeze({
    strategyId: "wrapped-btc-loop-base-moonwell",
    label: "Wrapped BTC lending loop (Base / Moonwell)",
    autoExecute: true,
    intentTtlMs: 60_000,
    exposure: Object.freeze({
      protocols: Object.freeze(["moonwell", "odos"]),
      assetFamily: "btc_wrappers",
      btcDenominated: true,
    }),
    caps: Object.freeze({
      perTxUsd: 1_000_000,
      perDayUsd: 1_000_000,
      perChainUsd: Object.freeze({
        base: 1_000_000,
      }),
      maxDailyLossUsd: 1_000_000,
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

function effectiveActiveStrategyCapUsd(config = {}) {
  const perChainCaps = Object.values(config?.caps?.perChainUsd || {}).filter(isFiniteNumber);
  const candidates = [
    config?.caps?.perTxUsd,
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
