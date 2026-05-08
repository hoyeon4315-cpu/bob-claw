function unresolvedPaybackConfig(fieldName) {
  throw new Error(`PAYBACK config requires operator decision for ${fieldName}`);
}

export const MIN_PAYBACK_PCT_OF_CAPITAL = 0.005;
export const ABSOLUTE_FLOOR_SATS = 5_000;
export const ABSOLUTE_CEILING_SATS = 50_000;

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function effectiveMinPaybackSats({ operatingCapitalSats = null } = {}) {
  const capitalSats = finiteNonNegative(operatingCapitalSats);
  if (capitalSats === null) return ABSOLUTE_CEILING_SATS;
  const pctFloor = Math.floor(capitalSats * MIN_PAYBACK_PCT_OF_CAPITAL);
  return clamp(pctFloor, ABSOLUTE_FLOOR_SATS, ABSOLUTE_CEILING_SATS);
}

export const PAYBACK_CONFIG = Object.freeze({
  baseRatio: 0.20, // Half-Kelly approximation
  minPaybackSats: ABSOLUTE_CEILING_SATS, // static legacy ceiling; effective floor is capital-aware
  minPaybackPctOfCapital: MIN_PAYBACK_PCT_OF_CAPITAL,
  absoluteFloorSats: ABSOLUTE_FLOOR_SATS,
  absoluteCeilingSats: ABSOLUTE_CEILING_SATS,
  effectiveMinPaybackSats,
  maxOfframpCostPctOfPayback: 0.10,
  // Operational caps aligned with weekly payback of yield-accrued lending-loop profits.
  perPeriodMaxSats: 500_000, // 0.005 BTC per weekly period
  annualMaxPaybackSats: 26_000_000, // 0.26 BTC rolling 12-month cap
  regimeMultipliers: Object.freeze({
    bear: 1.2,
    neutral: 1.0,
    bullPeak: 0.7,
  }),
  volMultiplier: Object.freeze({
    cap: 1.0,
    thresholdAnnualized: 0.5,
  }),
  emergencyPause: Object.freeze({
    offrampSlippageBpsMax: 200, // 2%
    operatingDrawdownPctMax: 30,
    protocolExploitList: Object.freeze([]),
  }),
  cronExpression: "0 0 * * 1", // Weekly Monday 00:00 UTC
  destinationPath: Object.freeze({
    profitReserveChain: "base",
    swapVenueOrdered: Object.freeze(["cowswap", "uniswap_v3"]),
    composerRoute: "layerzero",
    gatewayOfframpStage: "BOB_L2",
    bitcoinDestAddressEnv: "PAYBACK_BTC_DEST_ADDR",
  }),
});
