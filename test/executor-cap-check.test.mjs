import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyCapState, evaluateCapCheck } from "../src/executor/policy/cap-check.mjs";

function strategyCapsFixture(overrides = {}) {
  return {
    strategyId: "wrapper-btc-arbitrage",
    autoExecute: true,
    caps: {
      perTxUsd: 100,
      perDayUsd: 300,
      perChainUsd: {
        bob: 150,
        base: 200,
      },
      maxDailyLossUsd: 25,
      maxFailedGasCost24hUsd: 3,
    },
    ...overrides,
  };
}

function intentFixture(overrides = {}) {
  return {
    strategyId: "wrapper-btc-arbitrage",
    chain: "bob",
    mode: "live",
    amountUsd: 40,
    intentType: "swap",
    ...overrides,
  };
}

test("buildStrategyCapState summarizes daily volume and realized pnl", () => {
  const state = buildStrategyCapState({
    strategyId: "wrapper-btc-arbitrage",
    now: "2026-04-16T12:00:00.000Z",
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 25,
        policyVerdict: "approved",
        realized: { realizedNetPnlUsd: -3, actualKnownCostUsd: 0.4 },
      },
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "base",
        timestamp: "2026-04-16T02:00:00.000Z",
        amountUsd: 15,
        policyVerdict: "approved",
        realized: { realizedNetPnlUsd: 1, actualKnownCostUsd: 0.2 },
      },
    ],
  });

  assert.equal(state.dailyVolumeUsd, 40);
  assert.equal(state.perChainVolumeUsd.bob, 25);
  assert.equal(state.dailyRealizedPnlUsd, -2);
  assert.equal(Number(state.failedGasCost24hUsd.toFixed(6)), 0.6);
});

test("evaluateCapCheck blocks amount above per-tx cap", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({ amountUsd: 150 }),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [],
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("strategy_per_tx_cap_exceeded"), true);
});

test("evaluateCapCheck blocks breached day and chain budgets", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({ amountUsd: 80 }),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 90,
        policyVerdict: "approved",
      },
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "base",
        timestamp: "2026-04-16T02:00:00.000Z",
        amountUsd: 170,
        policyVerdict: "approved",
      },
    ],
    now: "2026-04-16T12:00:00.000Z",
  });

  assert.equal(result.blockers.includes("strategy_per_day_cap_exceeded"), true);
  assert.equal(result.blockers.includes("strategy_per_chain_cap_exceeded"), true);
});

test("evaluateCapCheck blocks when daily loss cap is already breached", () => {
  const result = evaluateCapCheck({
    intent: intentFixture(),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 25,
        policyVerdict: "approved",
        realized: { realizedNetPnlUsd: -30, actualKnownCostUsd: 1 },
      },
    ],
    now: "2026-04-16T12:00:00.000Z",
  });

  assert.equal(result.blockers.includes("strategy_max_daily_loss_breached"), true);
});

test("evaluateCapCheck allows emergency unwind to bypass sizing caps", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({
      amountUsd: 500,
      intentType: "emergency_unwind",
      executionReason: "risk_unwind",
    }),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [],
  });

  assert.equal(result.decision, "ALLOW");
});
