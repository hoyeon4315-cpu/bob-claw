import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoPromotionConfig,
  AUTO_PROMOTION_DEFAULTS,
} from "../src/config/auto-promotion.mjs";
import { evaluateAutoPromotion } from "../src/executor/auto-promotion-gate.mjs";

function makePassingEvidence(overrides = {}) {
  return {
    strategyId: "test-strategy",
    walkForward: {
      sharpe: 1.5,
      maxDrawdownPct: 10,
      regimeChanges: 2,
      samplePeriods: 24,
    },
    shadow: {
      consecutivePositivePeriods: 10,
      netOfMeasuredCost: true,
      quoteSuccessRate: 0.95,
    },
    execution: {
      oracleDivergencePct: 0.5,
      slippagePct: 0.2,
      edgeAboveCostVariance: true,
    },
    ...overrides,
  };
}

test("evaluateAutoPromotion passes on clean evidence with default thresholds", () => {
  const result = evaluateAutoPromotion(makePassingEvidence());
  assert.equal(result.passed, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.blockers, []);
  assert.equal(result.evaluated.strategyId, "test-strategy");
  assert.equal(result.initialCanaryCaps.perTxUsd, AUTO_PROMOTION_DEFAULTS.initialCanaryCaps.perTxUsd);
});

test("evaluateAutoPromotion fails when sharpe is below threshold", () => {
  const evidence = makePassingEvidence({
    walkForward: { sharpe: 0.5, maxDrawdownPct: 10, regimeChanges: 2, samplePeriods: 24 },
  });
  const result = evaluateAutoPromotion(evidence);
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((b) => b.startsWith("walk_forward_sharpe_below_min")));
});

test("evaluateAutoPromotion fails when shadow not net positive", () => {
  const evidence = makePassingEvidence({
    shadow: {
      consecutivePositivePeriods: 10,
      netOfMeasuredCost: false,
      quoteSuccessRate: 0.95,
    },
  });
  const result = evaluateAutoPromotion(evidence);
  assert.equal(result.passed, false);
  assert.ok(result.blockers.includes("shadow_not_positive_net_of_measured_cost"));
});

test("evaluateAutoPromotion fails when slippage exceeds threshold", () => {
  const evidence = makePassingEvidence({
    execution: {
      oracleDivergencePct: 0.5,
      slippagePct: 1.5,
      edgeAboveCostVariance: true,
    },
  });
  const result = evaluateAutoPromotion(evidence);
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((b) => b.startsWith("execution_slippage_exceeded")));
});

test("evaluateAutoPromotion fails on missing evidence", () => {
  const result = evaluateAutoPromotion(null);
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["evidence_missing"]);
});

test("evaluateAutoPromotion fails on missing strategyId", () => {
  const evidence = makePassingEvidence();
  delete evidence.strategyId;
  const result = evaluateAutoPromotion(evidence);
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["evidence_missing_strategy_id"]);
});

test("buildAutoPromotionConfig accepts overrides", () => {
  const cfg = buildAutoPromotionConfig({
    walkForward: { sharpeMin: 2.0 },
    initialCanaryCaps: { perTxUsd: 50 },
  });
  assert.equal(cfg.walkForward.sharpeMin, 2.0);
  assert.equal(cfg.walkForward.maxDrawdownPct, AUTO_PROMOTION_DEFAULTS.walkForward.maxDrawdownPct);
  assert.equal(cfg.initialCanaryCaps.perTxUsd, 50);
});

test("evaluateAutoPromotion with stricter override fails previously-passing evidence", () => {
  const cfg = buildAutoPromotionConfig({ walkForward: { sharpeMin: 2.0 } });
  const result = evaluateAutoPromotion(makePassingEvidence(), cfg);
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((b) => b.startsWith("walk_forward_sharpe_below_min")));
});
