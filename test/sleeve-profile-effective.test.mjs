import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_SLEEVE_PROFILE,
  resolveProfileCapMatrix,
} from "../src/config/sleeve-profile.mjs";
import { buildSleeveProfileSlice } from "../src/status/sleeve-profile-slice.mjs";
import {
  effectiveMicroBudgetUsd,
  effectiveOpportunisticBudgetUsd,
  resolveEffectiveSmallCapitalBudgets,
  SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE,
  SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE,
  SMALL_CAPITAL_RADAR_CAPS_BASELINE,
} from "../src/config/small-capital-campaign-mode.mjs";

test("sleeve profile imports the small-capital baseline budgets", () => {
  assert.deepEqual(
    ACTIVE_SLEEVE_PROFILE.smallCapitalOverrides.defaultBudgetsUsd,
    SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE,
  );
  assert.deepEqual(
    ACTIVE_SLEEVE_PROFILE.smallCapitalOverrides.nonPrimaryEntry,
    SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE,
  );
  assert.deepEqual(ACTIVE_SLEEVE_PROFILE.radarCaps, SMALL_CAPITAL_RADAR_CAPS_BASELINE);
});

test("effective small-capital budgets scale down for current tiny capital", () => {
  const resolved = resolveEffectiveSmallCapitalBudgets({ operatingCapitalUsd: 358 });

  assert.equal(resolved.capitalScaleBandId, "tiny");
  assert.equal(resolved.capitalScaleMultiplier, 0.6);
  assert.equal(resolved.nominalBudgets.defaultBudgetsUsd.opportunisticMaxUsd, 125);
  assert.equal(resolved.effectiveBudgets.defaultBudgetsUsd.opportunisticMaxUsd, 75);
  assert.equal(resolved.nominalBudgets.nonPrimaryEntry.mode, "p90_cost_plus_sample_uncertainty_v1");
  assert.equal(resolved.effectiveBudgets.nonPrimaryEntry.minEdgeFloorUsd, 0.5);
  assert.equal(resolved.effectiveBudgets.nonPrimaryEntry.minEdgePctOfNotional, 0.005);
  assert.equal(resolved.nominalBudgets.radarCaps.perCanaryUsd, 30);
  assert.equal(resolved.effectiveBudgets.radarCaps.perCanaryUsd, 18);
  assert.equal(effectiveOpportunisticBudgetUsd(358), 75);
  assert.equal(effectiveMicroBudgetUsd(358), 30);
});

test("effective small-capital budgets preserve the $1000 baseline", () => {
  const resolved = resolveEffectiveSmallCapitalBudgets({ operatingCapitalUsd: 1000 });

  assert.equal(resolved.capitalScaleBandId, "small");
  assert.equal(resolved.capitalScaleMultiplier, 1);
  assert.deepEqual(
    resolved.effectiveBudgets.defaultBudgetsUsd,
    SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE,
  );
  assert.deepEqual(resolved.effectiveBudgets.nonPrimaryEntry, SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE);
  assert.deepEqual(resolved.effectiveBudgets.radarCaps, SMALL_CAPITAL_RADAR_CAPS_BASELINE);
});

test("radar hard caps still clamp strategy cap matrix independently from scale reports", () => {
  const strategy = {
    strategyId: "test_non_btc_sleeve",
    exposure: { btcDenominated: false },
    caps: {
      tinyLivePerTxUsd: 250,
      perTxUsd: 500,
      perDayUsd: 5000,
      perChainUsd: { base: 1000 },
    },
  };
  const matrix = resolveProfileCapMatrix(strategy, { includeRadarCaps: true });

  assert.equal(matrix.radarCaps.perCanaryUsd, SMALL_CAPITAL_RADAR_CAPS_BASELINE.perCanaryUsd);
  assert.equal(matrix.radarCaps.perDayUsd, SMALL_CAPITAL_RADAR_CAPS_BASELINE.perDayUsd);
  assert.equal(matrix.tinyLivePerTxUsd, 50);
});

test("sleeve profile slice exposes operating capital scale band and budgets", () => {
  const slice = buildSleeveProfileSlice({
    operatingCapitalUsd: 358,
    strategies: [],
    generatedAt: "2026-05-08T00:00:00.000Z",
  });

  assert.equal(slice.operatingCapitalUsd, 358);
  assert.equal(slice.capitalScaleBandId, "tiny");
  assert.equal(slice.capitalScaleMultiplier, 0.6);
  assert.equal(slice.nominalBudgets.defaultBudgetsUsd.opportunisticMaxUsd, 125);
  assert.equal(slice.effectiveBudgets.defaultBudgetsUsd.opportunisticMaxUsd, 75);
});
