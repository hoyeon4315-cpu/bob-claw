import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import { evaluateLeverageCollateralRule } from "../src/executor/policy/leverage-collateral-rule.mjs";

const NOW = "2026-05-09T00:00:00.000Z";

test("leverage collateral rule allows non-leverage strategies", () => {
  const result = evaluateLeverageCollateralRule({
    strategy: { strategyId: "wrapper-btc-arbitrage" },
    intent: { strategyId: "wrapper-btc-arbitrage" },
    now: NOW,
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.blockers, []);
});

test("leverage collateral rule rejects collateral below cap requirement", () => {
  const result = evaluateLeverageCollateralRule({
    strategy: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      leverage: { healthFactorMin: 1.35 },
    },
    intent: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      positionState: {
        actualCollateralUnits: 0.9,
        requiredCollateralUnitsForCap: 1.5,
      },
    },
    now: NOW,
  });

  assert.equal(result.decision, "BLOCK");
  assert.deepEqual(result.blockers, ["collateral_below_cap_requirement"]);
  assert.equal(result.metrics.actualCollateralUnits, 0.9);
  assert.equal(result.metrics.requiredCollateralUnitsForCap, 1.5);
});

test("policy index keeps collateral rejection separate from capless rejection", async () => {
  const policy = await evaluateIntentPolicies({
    intent: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      family: "evm",
      intentType: "swap",
      mode: "live",
      amountUsd: 25,
      expectedNetUsd: 10,
      observedAt: NOW,
      positionState: {
        currentHealthFactor: 1.5,
        currentLiquidationBufferPct: 20,
        actualCollateralUnits: 0.9,
        requiredCollateralUnitsForCap: 1.5,
      },
    },
    auditRecords: [],
    killSwitchPath: null,
    now: NOW,
  });

  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes("collateral_below_cap_requirement"));
  assert.ok(!policy.blockers.includes("strategy_caps_missing"));
  assert.equal(policy.results.find((item) => item.policy === "leverage_collateral").decision, "BLOCK");
});
