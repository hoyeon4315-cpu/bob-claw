// Portfolio exposure policy for live cap checks.
// Commit-only config. Runtime overrides remain forbidden by AGENTS.md.

import {
  SMALL_CAPITAL_CAMPAIGN_MODE,
  evidencePrimaryChainShareOverrides,
} from "./small-capital-campaign-mode.mjs";
import { ACTIVE_SLEEVE_PROFILE } from "./sleeve-profile.mjs";

const PORTFOLIO_EXPOSURE_OVERRIDES = ACTIVE_SLEEVE_PROFILE.portfolioExposure || {};

export const PORTFOLIO_EXPOSURE_POLICY = Object.freeze({
  profileId: PORTFOLIO_EXPOSURE_OVERRIDES.profileId || "aggressive_non_btc_payback_v1",
  maxProtocolSharePct: PORTFOLIO_EXPOSURE_OVERRIDES.maxProtocolSharePct ?? 0.25,
  chainSelectionMode: SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection.mode,
  maxDefaultChainSharePct: PORTFOLIO_EXPOSURE_OVERRIDES.maxDefaultChainSharePct ?? 0.20,
  chainSharePct: Object.freeze({
    ...evidencePrimaryChainShareOverrides(),
    ...(PORTFOLIO_EXPOSURE_OVERRIDES.chainSharePct || {}),
  }),
  minBtcDenominatedSharePct: PORTFOLIO_EXPOSURE_OVERRIDES.minBtcDenominatedSharePct ?? 0.20,
  maxNonBtcDenominatedSharePct: PORTFOLIO_EXPOSURE_OVERRIDES.maxNonBtcDenominatedSharePct ?? 0.80,
});
