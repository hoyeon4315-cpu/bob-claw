import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaultRecursiveLendingLoopConfig,
  buildRecursiveLendingLoopScaffold,
  validateRecursiveLendingLoopConfig,
} from "../src/strategy/recursive-lending-loop-slice.mjs";

test("recursive wrapped-BTC lending loop scaffold builds deterministic execution and unwind plans", () => {
  const report = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_wrapped_btc_lending_loop",
    strategyConfig: {
      ...buildDefaultRecursiveLendingLoopConfig("recursive_wrapped_btc_lending_loop"),
      perTradeCapUsd: 400,
      maxLoopIterations: 3,
    },
    oracleInputs: {
      protocolPriceUsd: 65_050,
      referenceSamples: [
        { provider: "chainlink", priceUsd: 65_000, observedAt: "2026-04-16T19:00:00.000Z" },
        { provider: "pyth", priceUsd: 65_025, observedAt: "2026-04-16T19:00:10.000Z" },
      ],
    },
    now: "2026-04-16T19:01:00.000Z",
  });

  assert.equal(report.validation.ok, true);
  assert.equal(report.strategy.arrivalFamily, "wrapped_btc");
  assert.equal(report.protocolAdapter.id, "moonwell_base_cbbtc_usdc");
  assert.equal(report.executionSupport.status, "repo_auto_build_supported");
  assert.equal(report.entryPlan.iterations.length >= 2, true);
  assert.equal(report.executionPlan.actionCount > report.entryPlan.iterations.length, true);
  assert.equal(report.watcherRuntime.status, "healthy");
  assert.equal(report.unwindPlan.actions.length > 0, true);
  assert.equal(report.readiness.readyForDryRun, true);
  assert.equal(report.blockers.includes("protocol_adapter_not_built"), false);
});

test("recursive stablecoin lending loop scaffold pauses new entries when peg drift breaches the trigger", () => {
  const report = buildRecursiveLendingLoopScaffold({
    strategyId: "recursive_stablecoin_lending_loop",
    strategyConfig: buildDefaultRecursiveLendingLoopConfig("recursive_stablecoin_lending_loop"),
    oracleInputs: {
      protocolPriceUsd: 0.98,
      referenceSamples: [
        { provider: "chainlink", priceUsd: 1.0, observedAt: "2026-04-16T19:02:00.000Z" },
        { provider: "pyth", priceUsd: 1.0002, observedAt: "2026-04-16T19:02:10.000Z" },
      ],
    },
    now: "2026-04-16T19:03:00.000Z",
  });

  assert.equal(report.validation.ok, true);
  assert.equal(report.strategy.arrivalFamily, "stablecoin");
  assert.equal(report.protocolAdapter.id, "morpho_base_usdc_usdt");
  assert.equal(report.oracleSanity.status, "drift_above_trigger");
  assert.equal(report.watcherRuntime.status, "pause_new_entries");
  assert.equal(report.executionPlan.actionCount > 0, true);
  assert.equal(report.unwindPlan.actions.length > 0, true);
  assert.equal(report.blockers.includes("protocol_adapter_not_built"), false);
});

test("recursive lending loop config rejects invalid threshold ordering", () => {
  const validation = validateRecursiveLendingLoopConfig({
    ...buildDefaultRecursiveLendingLoopConfig("recursive_stablecoin_lending_loop"),
    healthFactorMin: 1.2,
    targetHealthFactor: 1.1,
    unwindTriggerHealthFactor: 1.3,
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes("healthFactorMin must be less than or equal to targetHealthFactor"), true);
  assert.equal(validation.errors.includes("unwindTriggerHealthFactor must be less than or equal to healthFactorMin"), true);
});
