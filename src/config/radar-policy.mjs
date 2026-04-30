export const RADAR_POLICY = Object.freeze({
  profileId: "onchain_opportunity_radar_phase0_v1",
  enabled: true,
  calibrationStatus: "unresolved_operator_policy",
  discoveryCanObserveOutOfScopeChains: true,
  executionRequiresExistingPolicyPath: true,
  btcFirstAccounting: true,
  thresholds: Object.freeze({
    clusterConfidenceMin: null,
    portableWalletSetMin: null,
    protocolAgeDaysMin: null,
    protocolTvlUsdMin: null,
    slippageBpsMax: null,
    mevExposureScoreMax: null,
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
