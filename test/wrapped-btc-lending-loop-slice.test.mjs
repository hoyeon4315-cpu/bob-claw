import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaultWrappedBtcLendingLoopConfig,
  buildWrappedBtcLendingLoopScaffold,
  validateWrappedBtcLendingLoopConfig,
} from "../src/strategy/wrapped-btc-lending-loop-slice.mjs";

test("wrapped BTC lending loop scaffold validates config and builds deterministic watcher/unwind plans", () => {
  const report = buildWrappedBtcLendingLoopScaffold({
    strategyConfig: {
      ...buildDefaultWrappedBtcLendingLoopConfig(),
      perTradeCapUsd: 500,
      maxLoopIterations: 3,
    },
    marketAssumptions: {
      liquidationThresholdPct: 75,
      supplyAprBps: 300,
      borrowAprBps: 150,
      loopSwapFeeBps: 10,
      unwindSlippageBps: 25,
      unwindFixedCostUsd: 3,
      minIncrementUsd: 25,
      oracleDriftTriggerPct: 5,
      maxUnwindGasUsd: 12,
    },
    oracleInputs: {
      protocolPriceUsd: 65_050,
      referenceSamples: [
        { provider: "chainlink", priceUsd: 65_000, observedAt: "2026-04-15T02:59:30.000Z" },
        { provider: "pyth", priceUsd: 65_040, observedAt: "2026-04-15T02:59:40.000Z" },
      ],
    },
    now: "2026-04-15T03:00:00.000Z",
  });

  assert.equal(report.validation.ok, true);
  assert.equal(report.strategy.collateralAsset, "cbBTC");
  assert.equal(report.protocolAdapter.id, "moonwell_base_cbbtc_usdc");
  assert.equal(report.entryPlan.iterations.length, 3);
  assert.equal(report.executionPlan.actionCount > report.entryPlan.iterations.length, true);
  assert.equal(report.entryPlan.loopedExposureMultiple > 1, true);
  assert.equal(report.watcherPlan.breachAction, "auto_unwind");
  assert.equal(report.watcherRuntime.status, "healthy");
  assert.equal(report.oracleSanity.status, "healthy");
  assert.equal(report.protocolAdapter.referenceOracles.includes("chainlink"), true);
  assert.equal(report.unwindPlan.dryRunRequired, true);
  assert.equal(report.unwindPlan.actions.length > 0, true);
  assert.equal(report.emergencyUnwindExecution.status, "standby");
  assert.equal(report.bindingSupport.status, "repo_auto_build_supported");
  assert.equal(report.bindingSupport.marketResolution.allAuthoritativeMarketsResolved, true);
  assert.equal(report.bindingSupport.marketResolution.repoSwapSourceResolved, true);
  assert.equal(report.bindingSupport.blockers.includes("authoritative_collateral_market_missing"), false);
  assert.equal(report.bindingSupport.blockers.includes("swap_router_binding_missing"), false);
  assert.equal(report.readiness.readyForLive, false);
  assert.equal(report.blockers.includes("protocol_adapter_not_built"), false);
  assert.equal(report.blockers.includes("authoritative_collateral_market_missing"), false);
  assert.equal(report.blockers.includes("swap_router_binding_missing"), false);
  assert.equal(report.blockers.includes("dry_run_unwind_not_recorded"), true);
});

test("wrapped BTC lending loop scaffold pauses new entries when oracle drift breaches the trigger", () => {
  const report = buildWrappedBtcLendingLoopScaffold({
    strategyConfig: buildDefaultWrappedBtcLendingLoopConfig(),
    oracleInputs: {
      protocolPriceUsd: 70_000,
      referenceSamples: [
        { provider: "chainlink", priceUsd: 65_000, observedAt: "2026-04-15T03:00:00.000Z" },
        { provider: "pyth", priceUsd: 65_050, observedAt: "2026-04-15T03:00:10.000Z" },
      ],
    },
    now: "2026-04-15T03:01:00.000Z",
  });

  assert.equal(report.oracleSanity.status, "drift_above_trigger");
  assert.equal(report.watcherRuntime.status, "pause_new_entries");
  assert.equal(report.watcherRuntime.triggers.includes("oracle_drift_above_trigger"), true);
});

test("wrapped BTC lending loop config rejects invalid threshold ordering", () => {
  const validation = validateWrappedBtcLendingLoopConfig({
    ...buildDefaultWrappedBtcLendingLoopConfig(),
    healthFactorMin: 1.7,
    targetHealthFactor: 1.6,
    unwindTriggerHealthFactor: 1.8,
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes("healthFactorMin must be less than or equal to targetHealthFactor"), true);
  assert.equal(validation.errors.includes("unwindTriggerHealthFactor must be less than or equal to healthFactorMin"), true);
});
