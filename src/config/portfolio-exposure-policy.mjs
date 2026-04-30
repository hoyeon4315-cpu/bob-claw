// Portfolio exposure policy for live cap checks.
// Commit-only config. Runtime overrides remain forbidden by AGENTS.md.

export const PORTFOLIO_EXPOSURE_POLICY = Object.freeze({
  profileId: "aggressive_non_btc_payback_v1",
  maxProtocolSharePct: 0.25,
  maxDefaultChainSharePct: 0.20,
  chainSharePct: Object.freeze({
    ethereum: 0.50,
    bob: 0.10,
  }),
  minBtcDenominatedSharePct: 0.20,
  maxNonBtcDenominatedSharePct: 0.80,
});
