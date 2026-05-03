// Portfolio exposure policy for live cap checks.
// Commit-only config. Runtime overrides remain forbidden by AGENTS.md.

import {
  SMALL_CAPITAL_CAMPAIGN_MODE,
  evidencePrimaryChainShareOverrides,
} from "./small-capital-campaign-mode.mjs";

export const PORTFOLIO_EXPOSURE_POLICY = Object.freeze({
  profileId: "aggressive_non_btc_payback_v1",
  maxProtocolSharePct: 0.25,
  chainSelectionMode: SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection.mode,
  maxDefaultChainSharePct: 0.20,
  chainSharePct: Object.freeze({
    ...evidencePrimaryChainShareOverrides(),
    ethereum: 0.50,
    bob: 0.10,
  }),
  minBtcDenominatedSharePct: 0.20,
  maxNonBtcDenominatedSharePct: 0.80,
});
