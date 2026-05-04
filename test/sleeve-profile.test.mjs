import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_SLEEVE_PROFILE_ID,
  resolveSleeveProfile,
} from "../src/config/sleeve-profile.mjs";
import { resolveStrategyCapMatrix } from "../src/config/strategy-caps.mjs";

const NON_BTC_STRATEGY = {
  strategyId: "test_non_btc_sleeve",
  exposure: {
    btcDenominated: false,
  },
  caps: {
    tinyLivePerTxUsd: 250,
    perTxUsd: 500,
    perDayUsd: 5_000,
    perChainUsd: {
      base: 1_000,
      ethereum: 800,
    },
  },
};

test("sleeve profile defaults to committed smallCapital_v1 selector", () => {
  assert.equal(ACTIVE_SLEEVE_PROFILE_ID, "smallCapital_v1");
  assert.equal(resolveSleeveProfile().id, "smallCapital_v1");
});

test("profile switch updates the resolved non-BTC cap matrix", () => {
  const small = resolveStrategyCapMatrix(NON_BTC_STRATEGY, { profileId: "smallCapital_v1" });
  const aggressive = resolveStrategyCapMatrix(NON_BTC_STRATEGY, { profileId: "aggressive_v1" });

  assert.equal(small.profileCapApplied, true);
  assert.equal(small.perTxUsd, 150);
  assert.equal(small.perDayUsd, 300);
  assert.equal(small.tinyLivePerTxUsd, 50);
  assert.equal(small.perChainUsd.base, 200);
  assert.equal(small.perChainUsd.ethereum, 125);

  assert.equal(aggressive.profileCapApplied, true);
  assert.equal(aggressive.perTxUsd, 200);
  assert.equal(aggressive.perDayUsd, 600);
  assert.equal(aggressive.tinyLivePerTxUsd, 100);
  assert.equal(aggressive.perChainUsd.base, 400);
  assert.equal(aggressive.perChainUsd.ethereum, 250);
});

test("radar hard caps still bind under aggressive_v1", () => {
  const aggressiveRadar = resolveStrategyCapMatrix(NON_BTC_STRATEGY, {
    profileId: "aggressive_v1",
    includeRadarCaps: true,
  });

  assert.equal(aggressiveRadar.tinyLivePerTxUsd, 100);
  assert.equal(aggressiveRadar.perDayUsd, 600);
  assert.equal(aggressiveRadar.radarCaps.perCanaryUsd, 30);
  assert.equal(aggressiveRadar.radarCaps.perDayUsd, 90);
  assert.equal(aggressiveRadar.radarCaps.cumulativeOpenUsd, 200);
  assert.equal(aggressiveRadar.radarCaps.maxConcurrentOpen, 6);
});
