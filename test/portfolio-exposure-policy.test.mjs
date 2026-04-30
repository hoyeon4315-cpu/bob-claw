import assert from "node:assert/strict";
import test from "node:test";

import { PORTFOLIO_EXPOSURE_POLICY } from "../src/config/portfolio-exposure-policy.mjs";

test("portfolio exposure policy defaults to aggressive non-BTC allocation", () => {
  assert.equal(PORTFOLIO_EXPOSURE_POLICY.profileId, "aggressive_non_btc_payback_v1");
  assert.equal(PORTFOLIO_EXPOSURE_POLICY.minBtcDenominatedSharePct, 0.20);
  assert.equal(PORTFOLIO_EXPOSURE_POLICY.maxNonBtcDenominatedSharePct, 0.80);
});
