import assert from "node:assert/strict";
import test from "node:test";

import { listStrategyCaps, validateStrategyCapsConfig } from "../src/config/strategy-caps.mjs";

test("all strategy caps declare the exact failed-gas guard key", () => {
  for (const config of listStrategyCaps()) {
    const validation = validateStrategyCapsConfig(config);

    assert.equal(
      Object.hasOwn(config.caps || {}, "maxFailedGasCost24HUsd"),
      false,
      `${config.strategyId} must not use maxFailedGasCost24HUsd`,
    );
    assert.equal(
      Number.isFinite(config.caps?.maxFailedGasCost24hUsd),
      true,
      `${config.strategyId} must declare caps.maxFailedGasCost24hUsd`,
    );
    assert.deepEqual(validation.errors.filter((error) => error.includes("maxFailedGasCost")), []);
  }
});

test("radar-bound yield strategies declare explicit tiny live caps", () => {
  const strategyCapsById = Object.fromEntries(
    listStrategyCaps().map((config) => [config.strategyId, config]),
  );
  const radarBoundStrategyIds = [
    "wrapped-btc-loop-base-moonwell",
    "stablecoin_spread_loop",
    "pendle-pt-lbtc-base",
    "aerodrome-cl-base",
  ];

  for (const strategyId of radarBoundStrategyIds) {
    assert.equal(
      Number.isFinite(strategyCapsById[strategyId]?.caps?.tinyLivePerTxUsd),
      true,
      `${strategyId} must declare caps.tinyLivePerTxUsd for radar canaries`,
    );
  }
});
