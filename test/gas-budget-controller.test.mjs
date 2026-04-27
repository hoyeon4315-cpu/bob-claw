import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateGasBudgetController } from "../src/risk/gas-budget-controller.mjs";

function makeIntent(overrides = {}) {
  return {
    strategyId: "test-strat",
    chain: "base",
    intentType: "entry",
    quote: { observedAt: new Date().toISOString() },
    ...overrides,
  };
}

function makeRecord(overrides = {}) {
  return {
    strategyId: "test-strat",
    chain: "base",
    intentType: "entry",
    timestamp: new Date().toISOString(),
    lifecycle: { stage: "confirmed" },
    ...overrides,
  };
}

test("evaluateGasBudgetController allows clean intent", () => {
  const result = evaluateGasBudgetController({
    intent: makeIntent(),
    auditRecords: [],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

test("evaluateGasBudgetController blocks stale quote >30s", () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  const result = evaluateGasBudgetController({
    intent: makeIntent({ quote: { observedAt: old } }),
    auditRecords: [],
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("stale_quote_exceeded_30s"));
});

test("evaluateGasBudgetController blocks route failed gas budget", () => {
  const records = Array.from({ length: 5 }).map(() =>
    makeRecord({
      lifecycle: { stage: "reverted" },
      realized: { actualKnownCostUsd: 1 },
    })
  );
  const result = evaluateGasBudgetController({
    intent: makeIntent(),
    auditRecords: records,
    maxFailedGasCost24hUsd: 3,
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("route_failed_gas_budget_24h_exceeded"));
});

test("evaluateGasBudgetController blocks consecutive reverts", () => {
  const records = [
    makeRecord({ lifecycle: { stage: "reverted" } }),
    makeRecord({ lifecycle: { stage: "reverted" } }),
    makeRecord({ lifecycle: { stage: "reverted" } }),
  ];
  const result = evaluateGasBudgetController({
    intent: makeIntent(),
    auditRecords: records,
    maxConsecutiveRevertsPerRoute: 3,
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("route_consecutive_reverts_auto_pause"));
});

test("evaluateGasBudgetController allows when reverts below threshold", () => {
  const records = [
    makeRecord({ lifecycle: { stage: "reverted" } }),
    makeRecord({ lifecycle: { stage: "reverted" } }),
  ];
  const result = evaluateGasBudgetController({
    intent: makeIntent(),
    auditRecords: records,
    maxConsecutiveRevertsPerRoute: 3,
  });
  assert.equal(result.allowed, true);
});

test("evaluateGasBudgetController resets consecutive count on success", () => {
  const records = [
    makeRecord({ lifecycle: { stage: "reverted" } }),
    makeRecord({ lifecycle: { stage: "confirmed" } }),
    makeRecord({ lifecycle: { stage: "reverted" } }),
  ];
  const result = evaluateGasBudgetController({
    intent: makeIntent(),
    auditRecords: records,
    maxConsecutiveRevertsPerRoute: 3,
  });
  assert.equal(result.allowed, true);
});

test("evaluateGasBudgetController triggers gas_burn_exit_ratio_exceeded", () => {
  const result = evaluateGasBudgetController({
    intent: makeIntent(),
    auditRecords: [],
    positionState: {
      cumulativeGasUsd: 30,
      realizedRewardUsd: 100,
    },
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("gas_burn_exit_ratio_exceeded"));
});

test("evaluateGasBudgetController triggers idle_position_exit", () => {
  const result = evaluateGasBudgetController({
    intent: makeIntent(),
    auditRecords: [],
    positionState: {
      positionUsd: 2,
      daysIdle: 10,
    },
    minProfitableTopUpUsd: 5,
    idlePositionExitDays: 7,
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("idle_position_below_min_profitable_exit"));
});

test("evaluateGasBudgetController blocks gas above p90_30d", () => {
  const result = evaluateGasBudgetController({
    intent: makeIntent({ gasPriceGwei: 50 }),
    auditRecords: [],
    gasBaselines: { base: { p90_30d: 20 } },
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("gas_price_above_p90_30d"));
});

test("evaluateGasBudgetController allows emergency_unwind above gas p90", () => {
  const result = evaluateGasBudgetController({
    intent: makeIntent({
      intentType: "emergency_unwind",
      gasPriceGwei: 50,
    }),
    auditRecords: [],
    gasBaselines: { base: { p90_30d: 20 } },
  });
  assert.equal(result.allowed, true);
});

test("evaluateGasBudgetController allows gas below p90", () => {
  const result = evaluateGasBudgetController({
    intent: makeIntent({ gasPriceGwei: 10 }),
    auditRecords: [],
    gasBaselines: { base: { p90_30d: 20 } },
  });
  assert.equal(result.allowed, true);
});
