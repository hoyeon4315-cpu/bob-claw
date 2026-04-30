export const RADAR_POLICY = Object.freeze({
  profileId: "onchain_opportunity_radar_aggressive_v1",
  enabled: true,
  calibrationStatus: "calibrated_aggressive_v1",
  discoveryCanObserveOutOfScopeChains: true,
  executionRequiresExistingPolicyPath: true,
  btcFirstAccounting: true,
  admissionEvUnit: "realized_net_pnl_usd",
  thresholds: Object.freeze({
    clusterConfidenceMin: 0.6,
    portableWalletSetMin: 3,
    protocolAgeDaysMin: 30,
    protocolTvlUsdMin: 5_000_000,
    slippageBpsMax: 80,
    mevExposureScoreMax: 35,
  }),
  realizationStates: Object.freeze({
    strategyRealized: "entry_claim_exit_swap_closed_btc_pnl",
    paybackDelivered: "bitcoin_l1_destination_balance_delta",
  }),
  stageOrder: Object.freeze([
    "observed",
    "strategy_hypothesis",
    "portable",
    "executable",
    "self_realized",
  ]),
});
