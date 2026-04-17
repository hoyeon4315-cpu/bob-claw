function unresolvedPaybackConfig(fieldName) {
  throw new Error(`PAYBACK config requires operator decision for ${fieldName}`);
}

export const PAYBACK_CONFIG = Object.freeze({
  baseRatio: 0.20, // Half-Kelly approximation
  minPaybackSats: 50_000, // ~= 0.0005 BTC
  maxOfframpCostPctOfPayback: 0.10,
  // Provisional first-live cap: allow at most one minimum-sized payback while the engine is still being validated.
  perPeriodMaxSats: 50_000,
  annualMaxPaybackSats: 50_000,
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
