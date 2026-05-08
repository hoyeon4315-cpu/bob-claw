import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STRATEGY_CAPS,
  assertStrategyCaps,
  listStrategyCaps,
} from "../src/config/strategy-caps.mjs";
import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../src/config/small-capital-campaign-mode.mjs";

test("small-cap mode clamps transport strategy effective daily caps", () => {
  const caps = assertStrategyCaps("gateway-btc-funding-transfer", {
    activeCapitalUsd: 500,
  });

  assert.equal(STRATEGY_CAPS["gateway-btc-funding-transfer"].caps.perDayUsd, 1_000_000);
  assert.equal(STRATEGY_CAPS["gateway-btc-funding-transfer"].caps.maxDailyLossUsd, 1_000_000);
  assert.equal(caps.caps.perDayUsd, 200);
  assert.equal(caps.caps.maxDailyLossUsd, 100);
  assert.equal(caps.effectiveCapSource.kind, "small_capital_transport_infra_clamp");
});

test("small-cap mode off returns declared transport caps unchanged", () => {
  const caps = assertStrategyCaps("gateway-btc-funding-transfer", {
    smallCapitalMode: {
      ...SMALL_CAPITAL_CAMPAIGN_MODE,
      enabled: false,
    },
  });

  assert.equal(caps.caps.perDayUsd, 1_000_000);
  assert.equal(caps.caps.maxDailyLossUsd, 1_000_000);
  assert.equal(caps.effectiveCapSource, undefined);
});

test("small-cap mode does not clamp non-transport strategies", () => {
  const caps = assertStrategyCaps("gateway_native_asset_conversion_sleeve", {
    activeCapitalUsd: 500,
  });
  const listed = listStrategyCaps({ activeCapitalUsd: 500 })
    .find((item) => item.strategyId === "gateway_native_asset_conversion_sleeve");

  assert.equal(caps.caps.perDayUsd, STRATEGY_CAPS.gateway_native_asset_conversion_sleeve.caps.perDayUsd);
  assert.equal(caps.caps.maxDailyLossUsd, STRATEGY_CAPS.gateway_native_asset_conversion_sleeve.caps.maxDailyLossUsd);
  assert.equal(listed.caps.perDayUsd, STRATEGY_CAPS.gateway_native_asset_conversion_sleeve.caps.perDayUsd);
  assert.equal(caps.effectiveCapSource, undefined);
});
