import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeCscvPbo,
  computeDeflatedSharpeProxy,
  computeWalkForwardEfficiency,
  buildAdvancedOverfitStatistics,
} from "../src/audit/advanced-overfit-statistics.mjs";

test("deflated Sharpe proxy reports insufficient evidence for tiny samples", () => {
  const report = computeDeflatedSharpeProxy({ returns: [0.01, 0.02, -0.01], trials: 4 });

  assert.equal(report.status, "insufficient_evidence");
  assert.equal(report.blockers.includes("min_30_returns_required"), true);
  assert.equal(report.deflatedSharpeProxy, null);
});

test("deflated Sharpe proxy penalizes multiple trials from explicit returns", () => {
  const returns = Array.from({ length: 40 }, (_, index) => (index % 5 === 0 ? -0.002 : 0.006));
  const singleTrial = computeDeflatedSharpeProxy({ returns, trials: 1 });
  const manyTrials = computeDeflatedSharpeProxy({ returns, trials: 25 });

  assert.equal(singleTrial.status, "reported");
  assert.equal(manyTrials.status, "reported");
  assert.ok(singleTrial.sharpe > manyTrials.benchmarkSharpe);
  assert.ok(manyTrials.deflatedSharpeProxy < singleTrial.deflatedSharpeProxy);
  assert.equal(manyTrials.trials, 25);
});

test("CSCV PBO reports probability that the IS winner ranks below OOS median", () => {
  const report = computeCscvPbo({
    performanceMatrix: [
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 1.0],
      [0.0, 0.0, 1.0],
    ],
  });

  assert.equal(report.status, "reported");
  assert.equal(report.combinationCount, 6);
  assert.equal(report.pbo, 1);
  assert.equal(report.blockers.length, 0);
});

test("CSCV PBO blocks when the strategy matrix is too narrow", () => {
  const report = computeCscvPbo({ performanceMatrix: [[1], [2], [3], [4]] });

  assert.equal(report.status, "insufficient_evidence");
  assert.equal(report.blockers.includes("min_2_strategy_variants_required"), true);
});

test("walk-forward efficiency averages positive OOS over IS performance", () => {
  const report = computeWalkForwardEfficiency({
    folds: [
      { inSample: 10, outOfSample: 6 },
      { inSample: 8, outOfSample: 4 },
      { inSample: 12, outOfSample: -1 },
    ],
  });

  assert.equal(report.status, "reported");
  assert.equal(report.foldCount, 3);
  assert.equal(report.wfe, 0.338889);
  assert.equal(report.positiveFoldRate, 0.666667);
});

test("advanced overfit report aggregates DSR proxy, PBO, and WFE blockers", () => {
  const report = buildAdvancedOverfitStatistics({
    deflatedSharpe: { returns: [0.01, -0.01] },
    cscvPbo: { performanceMatrix: [] },
    walkForwardEfficiency: { folds: [] },
  });

  assert.equal(report.status, "insufficient_evidence");
  assert.deepEqual(report.metrics, {
    deflatedSharpeProxy: null,
    pbo: null,
    wfe: null,
  });
  assert.ok(report.blockers.includes("deflated_sharpe:min_30_returns_required"));
  assert.ok(report.blockers.includes("cscv_pbo:min_4_periods_required"));
  assert.ok(report.blockers.includes("walk_forward_efficiency:min_2_folds_required"));
});
