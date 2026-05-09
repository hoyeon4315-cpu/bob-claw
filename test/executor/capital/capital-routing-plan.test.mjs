import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCapitalRoutingPlan } from "../../../src/executor/capital/capital-routing-plan.mjs";

const CAPS = Object.freeze({
  s1: { strategyId: "s1", caps: { perTxUsd: 100, perDayUsd: 200, perChainUsd: { base: 100 }, maxDailyLossUsd: 20 } },
  s2: { strategyId: "s2", caps: { perTxUsd: 100, perDayUsd: 200, perChainUsd: { base: 100 }, maxDailyLossUsd: 20 } },
});

test("capital routing plan sorts by ROI, water-fills free capital, and emits capital-manager intents", () => {
  const plan = buildCapitalRoutingPlan({
    classifications: [
      { strategyId: "s2", classification: "ready_with_capital_addition", capitalDeltaNeededUsd: 80, expectedDailyUsdOnResolve: 1, capitalSourceCandidates: [{ chain: "base", asset: "USDC", freeUsd: 100 }] },
      { strategyId: "s1", classification: "ready_with_capital_addition", capitalDeltaNeededUsd: 70, expectedDailyUsdOnResolve: 3, capitalSourceCandidates: [{ chain: "base", asset: "USDC", freeUsd: 100 }] },
    ],
    strategyCapsById: CAPS,
    treasurySnapshot: { freeCapitalUsd: 100, lockedCapitalUsd: 20, perChainUsd: { base: 100 } },
    guards: { readyForLiveBroadcast: true, killSwitchActive: false, devLockActive: false },
    readinessByStrategy: { s1: { operatorHold: false }, s2: { operatorHold: false } },
    now: "2026-05-09T00:00:00.000Z",
  });
  assert.equal(plan.routingPlan.length, 2);
  assert.equal(plan.routingPlan[0].strategyId, "s1");
  assert.equal(plan.routingPlan[0].amountUsd, 70);
  assert.equal(plan.routingPlan[1].amountUsd, 30);
  assert.equal(plan.routingPlan[0].enqueueIntent.intentType, "capital_rebalance");
  assert.equal(plan.routingPlan[0].preDispatchChecks.passed, true);
  assert.equal(plan.totalExpectedDailyUsdOnResolve, 4);
});

test("capital routing plan surfaces pre-dispatch hard stops and locked treasury", () => {
  const held = buildCapitalRoutingPlan({
    classifications: [
      { strategyId: "s1", classification: "ready_with_capital_addition", capitalDeltaNeededUsd: 50, expectedDailyUsdOnResolve: 2, capitalSourceCandidates: [{ chain: "base", asset: "USDC", freeUsd: 50 }] },
    ],
    strategyCapsById: CAPS,
    treasurySnapshot: { freeCapitalUsd: 50, lockedCapitalUsd: 100, perChainUsd: { base: 50 } },
    guards: { readyForLiveBroadcast: true },
    readinessByStrategy: { s1: { operatorHold: true } },
    now: "2026-05-09T00:00:00.000Z",
  });
  assert.equal(held.routingPlan[0].preDispatchChecks.passed, false);
  assert.ok(held.routingPlan[0].preDispatchChecks.failures.includes("operator_hold"));

  const locked = buildCapitalRoutingPlan({
    classifications: [
      { strategyId: "s1", classification: "ready_with_capital_addition", capitalDeltaNeededUsd: 50, expectedDailyUsdOnResolve: 2, capitalSourceCandidates: [] },
    ],
    strategyCapsById: CAPS,
    treasurySnapshot: { freeCapitalUsd: 0, lockedCapitalUsd: 100, perChainUsd: { base: 0 } },
    guards: { readyForLiveBroadcast: true },
  });
  assert.equal(locked.routingPlan.length, 0);
  assert.equal(locked.unresolvable[0].classification, "needs_capital_acquisition");
});
