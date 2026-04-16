import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateHealthFactorCheck } from "../src/executor/policy/hf-check.mjs";

const leverageCaps = {
  leverage: {
    healthFactorMin: 1.35,
    liquidationBufferPct: 12,
    emergencyUnwindPath: ["repay", "withdraw"],
  },
};

test("hf-check allows non-leverage intents", () => {
  const result = evaluateHealthFactorCheck({
    intent: {
      strategyId: "gateway-instant-swap-verification",
      isLeverage: false,
    },
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.requiresUnwind, false);
});

test("hf-check blocks when current health factor is below minimum", () => {
  const result = evaluateHealthFactorCheck({
    strategyCaps: leverageCaps,
    intent: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      isLeverage: true,
      healthFactor: { current: 1.2, projectedPost: 1.4 },
      liquidationBuffer: { currentPct: 16, projectedPostPct: 15 },
    },
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("health_factor_below_min_pre_trade"), true);
  assert.equal(result.requiresUnwind, true);
});

test("hf-check blocks projected liquidation buffer breaches", () => {
  const result = evaluateHealthFactorCheck({
    strategyCaps: leverageCaps,
    intent: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      isLeverage: true,
      healthFactor: { current: 1.45, projectedPost: 1.4 },
      liquidationBuffer: { currentPct: 14, projectedPostPct: 10 },
    },
  });

  assert.equal(result.blockers.includes("liquidation_buffer_below_min_post_trade"), true);
});
