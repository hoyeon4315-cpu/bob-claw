import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEmergencyUnwindExecutionPlan, evaluateLeverageWatcher } from "../src/defi/leverage-watchers.mjs";

test("leverage watcher escalates to auto-unwind on health-factor breach", () => {
  const decision = evaluateLeverageWatcher({
    strategyConfig: {
      id: "wrapped-btc-loop",
      healthFactorMin: 1.35,
      unwindTriggerHealthFactor: 1.3,
      liquidationBufferPct: 12,
    },
    positionState: {
      currentHealthFactor: 1.28,
      currentLiquidationBufferPct: 11,
    },
    marketState: {
      oracleDriftPct: 0,
      oracleDriftTriggerPct: 4,
      unwindGasUsd: 1,
      maxUnwindGasUsd: 10,
    },
  });

  assert.equal(decision.status, "auto_unwind");
  assert.equal(decision.shouldAutoUnwind, true);
  assert.equal(decision.triggers.includes("health_factor_at_unwind_trigger"), true);
  assert.equal(decision.triggers.includes("liquidation_buffer_below_min"), true);
});

test("emergency unwind plan becomes ready when watcher triggers auto-unwind", () => {
  const plan = buildEmergencyUnwindExecutionPlan({
    strategyConfig: { id: "wrapped-btc-loop" },
    protocolAdapter: { id: "moonwell_base_cbbtc_usdc" },
    unwindActions: [{ step: 1, kind: "halt_new_loop_entries" }],
    watcherDecision: {
      shouldAutoUnwind: true,
      triggers: ["health_factor_at_unwind_trigger"],
    },
    now: "2026-04-15T13:30:00.000Z",
  });

  assert.equal(plan.status, "ready_to_execute");
  assert.equal(plan.activationReason, "health_factor_at_unwind_trigger");
  assert.equal(plan.actions.length, 1);
});
