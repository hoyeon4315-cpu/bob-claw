import { OFFICIAL_GATEWAY_DESTINATION_CHAINS, canonicalGatewayChain } from "../gateway-destinations.mjs";
import { DEFAULT_FAILED_GAS_COST_24H_USD } from "../strategy-caps/constants.mjs";

function freezeRecord(record) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        value && typeof value === "object" && !Array.isArray(value) ? Object.freeze({ ...value }) : value,
      ]),
    ),
  );
}

function buildPerChainRecord(factory) {
  return Object.freeze(Object.fromEntries(OFFICIAL_GATEWAY_DESTINATION_CHAINS.map((chain) => [chain, factory(chain)])));
}

export const AGGRESSIVE_VELOCITY_SLEEVE_ID = "aggressive-velocity-v1";
export const AGGRESSIVE_VELOCITY_STRATEGY_ID = "aggressive-velocity-v1";
export const AGGRESSIVE_VELOCITY_BTC_PRICE_USD = 105_000;
export const AGGRESSIVE_VELOCITY_ALLOWED_CHAINS = Object.freeze([...OFFICIAL_GATEWAY_DESTINATION_CHAINS]);

export const AGGRESSIVE_VELOCITY_CHAIN_COSTS = freezeRecord({
  ethereum: { gas: 18, bridge: 0, baseSlippageBps: 35 },
  bob: { gas: 0.5, bridge: 0, baseSlippageBps: 25 },
  base: { gas: 0.8, bridge: 0, baseSlippageBps: 30 },
  bsc: { gas: 0.6, bridge: 1.2, baseSlippageBps: 40 },
  avalanche: { gas: 0.7, bridge: 1.5, baseSlippageBps: 35 },
  unichain: { gas: 0.9, bridge: 0, baseSlippageBps: 30 },
  bera: { gas: 1.1, bridge: 2.0, baseSlippageBps: 45 },
  optimism: { gas: 0.7, bridge: 0, baseSlippageBps: 30 },
  soneium: { gas: 0.8, bridge: 1.8, baseSlippageBps: 40 },
  sei: { gas: 0.9, bridge: 2.2, baseSlippageBps: 45 },
  sonic: { gas: 1.0, bridge: 1.5, baseSlippageBps: 35 },
});

export const AGGRESSIVE_VELOCITY_ACCOUNTING_CONFIG = Object.freeze({
  defaultPositionValueUsd: 120,
  entryGasBufferUsd: 2.5,
  protocolFeeUsd: 0.4,
  defaultSlippageBps: 40,
  defaultExitCostBtc: 0.00015,
  minExitCostFloorBtc: 0.00005,
  qualityThresholds: Object.freeze({
    highExpectedNetBtc: 0.000065,
    mediumExpectedNetBtc: 0.000032,
  }),
});

export const AGGRESSIVE_VELOCITY_SCANNER_CONFIG = Object.freeze({
  minRemainingHours: 6,
  maxILBpsForCL: 850,
  maxSinglePositionPctOfSleeve: 28,
  minVelocityScore: 52,
  requireCredibleExitPath: true,
  maxCostDragPct: 38,
  allowedChains: AGGRESSIVE_VELOCITY_ALLOWED_CHAINS,
  targetExecutableCountMin: 20,
  minExpectedNetBtcProfit: 0.00005,
  onlyHighQualityNetYield: true,
  execution: Object.freeze({
    minExitFeasibilityScore: 65,
    minVelocityScore: 58,
    highNetProfitOverrideExpectedNetBtc: 0.00008,
    highNetProfitOverrideMinFeasibilityScore: 50,
  }),
  finalSelection: Object.freeze({
    minRealizedNetBtc: 0.00003,
    minCaptureRate: 0.65,
    minFeasibilityScore: 60,
  }),
  feasibility: Object.freeze({
    baseScore: 45,
    minScore: 30,
    maxScore: 98,
    costDragDivisorUsd: 15,
    sweetSpotRemainingHours: Object.freeze({
      min: 8,
      max: 48,
      bonus: 12,
    }),
    missingLivePenalty: 25,
    protocolLiquidityBonuses: Object.freeze({
      aerodrome: 22,
      uniswap: 22,
      velodrome: 22,
      morpho: 15,
      aave: 15,
    }),
    credibleScore: 65,
    gasUsdByChain: Object.freeze({
      ethereum: 20,
      default: 9,
    }),
    slippageBps: 40,
  }),
  roundtripEstimate: Object.freeze({
    gasUsdByChain: Object.freeze({
      ethereum: 18,
      default: 6,
    }),
    executionBufferUsdByChain: Object.freeze({
      ethereum: 9,
      default: 3,
    }),
    additionalBridgeUsdByChain: Object.freeze({
      ethereum: 4,
      default: 0,
    }),
    slippageBps: 45,
  }),
});

export const AGGRESSIVE_YIELD_STRATEGIST_CONFIG = Object.freeze({
  minExpectedNetBtcProfit: AGGRESSIVE_VELOCITY_SCANNER_CONFIG.minExpectedNetBtcProfit,
  minNetYieldPctPerDay: 0.8,
  maxPositions: 4,
  preferHighQualityOnly: true,
  minSimulatedCaptureRate: AGGRESSIVE_VELOCITY_SCANNER_CONFIG.finalSelection.minCaptureRate,
});

export const AGGRESSIVE_EXIT_RULES = Object.freeze({
  minRealizedProfitToExitBtc: 0.00003,
  maxDrawdownFromPeakBtc: 0.00002,
  maxHoldHours: 48,
  minVelocityDecayPct: 35,
  requirePositiveNetAtExit: true,
  maxConcurrentPositions: 4,
  emergencyExitOnILBps: 1200,
});

export const AGGRESSIVE_REALIZATION_CONFIG = Object.freeze({
  highQualityMinProjectedProfitRatio: 0.6,
  marginalEntryFeasibilityScore: 70,
  marginalEntryDecayToleranceMultiplier: 0.7,
  protectedHighProfitMinCaptureRate: 0.6,
  highProfitThresholdBtc: AGGRESSIVE_VELOCITY_SCANNER_CONFIG.execution.highNetProfitOverrideExpectedNetBtc,
  mediumProfitThresholdBtc: AGGRESSIVE_VELOCITY_SCANNER_CONFIG.minExpectedNetBtcProfit,
  bufferRatioProfitShare: 0.7,
  timeFactorFloor: 0.4,
  timeFactorDivisorHours: 24,
  qualityBonusByLevel: Object.freeze({
    high: 1.15,
    medium: 1.0,
    low: 0.7,
  }),
  highProfitProtectionByThreshold: Object.freeze({
    high: 1.12,
    medium: 1.05,
    default: 1.0,
  }),
  simulation: Object.freeze({
    incentiveDecayFactor: 0.82,
    remainingHoursDecayFactor: 0.75,
  }),
});

export const AGGRESSIVE_VELOCITY_GAS_FLOAT = freezeRecord({
  ethereum: { minUsd: 10, targetUsd: 20 },
  bob: { minUsd: 3, targetUsd: 6 },
  base: { minUsd: 3, targetUsd: 6 },
  bsc: { minUsd: 3, targetUsd: 6 },
  avalanche: { minUsd: 3, targetUsd: 6 },
  unichain: { minUsd: 3, targetUsd: 6 },
  bera: { minUsd: 3, targetUsd: 6 },
  optimism: { minUsd: 3, targetUsd: 6 },
  soneium: { minUsd: 3, targetUsd: 6 },
  sei: { minUsd: 3, targetUsd: 6 },
  sonic: { minUsd: 3, targetUsd: 6 },
});

export const AGGRESSIVE_VELOCITY_STRATEGY_CAPS = Object.freeze({
  strategyId: AGGRESSIVE_VELOCITY_STRATEGY_ID,
  label: "Aggressive velocity sleeve v1",
  autoExecute: true,
  intentTtlMs: 60_000,
  exposure: Object.freeze({
    protocols: Object.freeze(["aggressive_velocity"]),
    assetFamily: "yield_sleeve",
    btcDenominated: false,
  }),
  caps: Object.freeze({
    perTxUsd: 60,
    perDayUsd: 250,
    perChainUsd: buildPerChainRecord((chain) => (chain === "ethereum" ? 60 : 75)),
    maxDailyLossUsd: 25,
    maxFailedGasCost24hUsd: DEFAULT_FAILED_GAS_COST_24H_USD,
    tinyLivePerTxUsd: 25,
  }),
  gasFloat: AGGRESSIVE_VELOCITY_GAS_FLOAT,
});

export function normalizeAggressiveVelocityChain(chain) {
  return canonicalGatewayChain(chain);
}

export function isAggressiveVelocitySupportedChain(chain) {
  const normalized = normalizeAggressiveVelocityChain(chain);
  return normalized ? AGGRESSIVE_VELOCITY_ALLOWED_CHAINS.includes(normalized) : false;
}

export function resolveAggressiveVelocityAccountingCost(chain) {
  const normalizedChain = normalizeAggressiveVelocityChain(chain) || "ethereum";
  return {
    chain: normalizedChain,
    ...(AGGRESSIVE_VELOCITY_CHAIN_COSTS[normalizedChain] || AGGRESSIVE_VELOCITY_CHAIN_COSTS.ethereum),
  };
}

export function getAggressiveVelocityMinNetBtc() {
  return AGGRESSIVE_VELOCITY_SCANNER_CONFIG.minExpectedNetBtcProfit;
}

export function resolveAggressiveVelocityFeasibilityConfig(chain) {
  const normalizedChain = normalizeAggressiveVelocityChain(chain) || "ethereum";
  return Object.freeze({
    chain: normalizedChain,
    gasUsd:
      AGGRESSIVE_VELOCITY_SCANNER_CONFIG.feasibility.gasUsdByChain[normalizedChain] ??
      AGGRESSIVE_VELOCITY_SCANNER_CONFIG.feasibility.gasUsdByChain.default,
    slippageBps: AGGRESSIVE_VELOCITY_SCANNER_CONFIG.feasibility.slippageBps,
  });
}

export function resolveAggressiveVelocityRoundtripEstimateConfig(chain) {
  const normalizedChain = normalizeAggressiveVelocityChain(chain) || "ethereum";
  const gasUsdByChain = AGGRESSIVE_VELOCITY_SCANNER_CONFIG.roundtripEstimate.gasUsdByChain;
  const executionBufferUsdByChain = AGGRESSIVE_VELOCITY_SCANNER_CONFIG.roundtripEstimate.executionBufferUsdByChain;
  const additionalBridgeUsdByChain = AGGRESSIVE_VELOCITY_SCANNER_CONFIG.roundtripEstimate.additionalBridgeUsdByChain;
  return Object.freeze({
    chain: normalizedChain,
    gasUsd: gasUsdByChain[normalizedChain] ?? gasUsdByChain.default,
    executionBufferUsd: executionBufferUsdByChain[normalizedChain] ?? executionBufferUsdByChain.default,
    additionalBridgeUsd: additionalBridgeUsdByChain[normalizedChain] ?? additionalBridgeUsdByChain.default,
    slippageBps: AGGRESSIVE_VELOCITY_SCANNER_CONFIG.roundtripEstimate.slippageBps,
  });
}
