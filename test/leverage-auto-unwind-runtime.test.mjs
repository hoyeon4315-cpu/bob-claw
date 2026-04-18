import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLeverageAutoUnwindRuntime } from "../src/defi/leverage-auto-unwind-runtime.mjs";

function scaffoldFixture() {
  return {
    generatedAt: "2026-04-18T10:00:00.000Z",
    strategy: {
      id: "wrapped-btc-loop-base-moonwell",
      label: "Wrapped BTC lending loop (Base / Moonwell)",
      chain: "base",
      protocol: "moonwell",
      isLeverage: true,
      healthFactorMin: 1.35,
      unwindTriggerHealthFactor: 1.3,
      liquidationBufferPct: 12,
    },
    marketAssumptions: {
      oracleDriftTriggerPct: 4,
      maxUnwindGasUsd: 10,
    },
    entryPlan: {
      projectedHealthFactor: 1.71,
      projectedLiquidationBufferPct: 13.8,
    },
    oracleSanity: {
      protocolDriftPct: 1.2,
    },
    unwindPlan: {
      actions: [
        { step: "repay_debt", venue: "moonwell" },
        { step: "withdraw_collateral", venue: "moonwell" },
      ],
    },
    dryRunSummary: {
      dryRunReceiptRecorded: true,
      signerBackedRunCount: 0,
    },
    protocolAdapter: {
      id: "moonwell_wrapped_btc_loop",
    },
  };
}

test("auto unwind runtime stays healthy when observed state remains inside thresholds", () => {
  const report = buildLeverageAutoUnwindRuntime({
    scaffold: scaffoldFixture(),
    now: "2026-04-18T10:05:00.000Z",
  });

  assert.equal(report.runtime.status, "healthy");
  assert.equal(report.runtime.severity, "info");
  assert.equal(report.watcherDecision.triggers.length, 0);
  assert.equal(report.emergencyUnwindExecution.status, "standby");
  assert.equal(report.nextAction.code, "continue_monitoring");
});

test("auto unwind runtime escalates to ready_to_execute on health-factor breach", () => {
  const report = buildLeverageAutoUnwindRuntime({
    scaffold: scaffoldFixture(),
    observedPosition: {
      currentHealthFactor: 1.24,
      currentLiquidationBufferPct: 8.1,
    },
    observedMarket: {
      oracleDriftPct: 2.2,
      unwindGasUsd: 4.8,
    },
    now: "2026-04-18T10:06:00.000Z",
  });

  assert.equal(report.runtime.status, "auto_unwind");
  assert.equal(report.runtime.severity, "critical");
  assert.equal(report.watcherDecision.shouldAutoUnwind, true);
  assert.equal(report.emergencyUnwindExecution.status, "ready_to_execute");
  assert.equal(report.emergencyUnwindExecution.actions.length, 2);
  assert.equal(report.riskEvent.eventType, "leverage_auto_unwind_runtime");
  assert.equal(report.riskEvent.severity, "critical");
  assert.equal(report.nextAction.code, "submit_emergency_unwind_intent");
});
