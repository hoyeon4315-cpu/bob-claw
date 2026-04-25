import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateWalkForwardCv,
  WALK_FORWARD_DEFAULTS,
} from "../src/strategy/walk-forward-cv.mjs";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T00:00:00Z");

function mkSample({ dayOffset, success = true, profit = 1000, cost = 100 }) {
  return {
    tsMs: T0 + dayOffset * DAY,
    success,
    profitSats: profit,
    costSats: cost,
  };
}

// Build a dense, stable sample: 3 samples/day across the requested span.
function denseStable(daysCount, { success = true, profit = 1000, cost = 100 } = {}) {
  const out = [];
  for (let d = 0; d < daysCount; d += 1) {
    for (let k = 0; k < 3; k += 1) {
      out.push({
        tsMs: T0 + d * DAY + k * 6 * 60 * 60 * 1000,
        success,
        profitSats: profit,
        costSats: cost,
      });
    }
  }
  return out;
}

describe("walk-forward purged CV", () => {
  test("rejects non-array input", () => {
    assert.throws(() => evaluateWalkForwardCv({ samples: "nope" }), /array/);
  });

  test("empty samples => passes:false with no_samples blocker", () => {
    const r = evaluateWalkForwardCv({ samples: [] });
    assert.equal(r.passes, false);
    assert.ok(r.blockers.includes("no_samples"));
    assert.equal(r.aggregate.totalFolds, 0);
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.folds));
  });

  test("result shape is frozen including nested fold metrics", () => {
    const samples = denseStable(100);
    const r = evaluateWalkForwardCv({ samples });
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.aggregate));
    for (const fold of r.folds) {
      assert.ok(Object.isFrozen(fold));
      assert.ok(Object.isFrozen(fold.trainMetrics));
      assert.ok(Object.isFrozen(fold.testMetrics));
      assert.ok(Object.isFrozen(fold.degradation));
      assert.ok(Object.isFrozen(fold.blockers));
    }
  });

  test("sample span shorter than a full fold window blocks with clear reason", () => {
    const samples = [
      mkSample({ dayOffset: 0 }),
      mkSample({ dayOffset: 1 }),
      mkSample({ dayOffset: 2 }),
    ];
    const r = evaluateWalkForwardCv({ samples });
    assert.equal(r.passes, false);
    assert.ok(r.blockers.includes("sample_span_shorter_than_one_fold_window"));
  });

  test("stable dense history passes every fold", () => {
    // 100 days × 3 samples/day = 300 samples, all success, constant PnL.
    const samples = denseStable(100);
    const r = evaluateWalkForwardCv({ samples });
    assert.equal(r.passes, true, `blockers=${JSON.stringify(r.blockers)}`);
    assert.ok(r.aggregate.totalFolds >= 3);
    assert.equal(r.aggregate.foldsFailed, 0);
    // Each fold's train and test metrics should be effectively identical
    // since the data generator is stationary.
    for (const fold of r.folds) {
      assert.equal(fold.passed, true);
      assert.equal(fold.trainMetrics.successRate, 1);
      assert.equal(fold.testMetrics.successRate, 1);
    }
  });

  test("detects success-rate degradation between train and test", () => {
    // Train windows (days 0-14, 4-18, ...) full of successes.
    // Test windows (days ~15+, ~19+, ...) full of failures.
    const trainPart = denseStable(15, { success: true });
    const testPart = denseStable(40, { success: false }).map((s) => ({
      ...s,
      tsMs: s.tsMs + 15 * DAY,
    }));
    const samples = [...trainPart, ...testPart];
    const r = evaluateWalkForwardCv({ samples });
    assert.equal(r.passes, false);
    const allFoldBlockers = r.folds.flatMap((f) => f.blockers);
    assert.ok(
      allFoldBlockers.some((b) =>
        b === "success_rate_degradation_exceeds_threshold" ||
        b === "net_profit_ratio_below_threshold",
      ),
      `expected degradation blocker; got ${JSON.stringify(allFoldBlockers)}`,
    );
  });

  test("detects net-profit ratio collapse", () => {
    // Train: profit 1000/cost 100 => net 900 per sample.
    // Test: profit 200/cost 150 => net 50 per sample → ratio ~0.055 < 0.5.
    const train = denseStable(15, { profit: 1000, cost: 100 });
    const testBad = denseStable(40, { profit: 200, cost: 150 }).map((s) => ({
      ...s,
      tsMs: s.tsMs + 15 * DAY,
    }));
    const samples = [...train, ...testBad];
    const r = evaluateWalkForwardCv({ samples });
    const someFoldFailed = r.folds.some(
      (f) => f.blockers.includes("net_profit_ratio_below_threshold"),
    );
    assert.equal(someFoldFailed, true);
    assert.equal(r.passes, false);
  });

  test("insufficient test samples flag surfaces, not silently skipped", () => {
    // Dense train period, sparse test period: only 1 test sample per fold.
    const samples = [];
    for (let d = 0; d < 40; d += 1) {
      if (d < 15) {
        for (let k = 0; k < 3; k += 1) {
          samples.push({
            tsMs: T0 + d * DAY + k * 60 * 1000,
            success: true,
            profitSats: 1000,
            costSats: 100,
          });
        }
      } else if (d === 16 || d === 20 || d === 24 || d === 28 || d === 32) {
        samples.push({
          tsMs: T0 + d * DAY,
          success: true,
          profitSats: 1000,
          costSats: 100,
        });
      }
    }
    const r = evaluateWalkForwardCv({ samples });
    const any = r.folds.some((f) => f.blockers.includes("insufficient_test_samples"));
    assert.equal(any, true);
  });

  test("embargo separates adjacent test windows", () => {
    // The step size (testMs + embargoMs) guarantees that each fold's test
    // window starts at least embargoMs after the previous fold's test ended.
    // That prevents the same minute of data from appearing as "test" in
    // two different folds.
    const samples = denseStable(100);
    const r = evaluateWalkForwardCv({ samples });
    for (let i = 1; i < r.folds.length; i += 1) {
      const prev = r.folds[i - 1];
      const cur = r.folds[i];
      const gap = cur.testStartMs - prev.testEndMs;
      assert.ok(
        gap >= WALK_FORWARD_DEFAULTS.embargoMs,
        `fold ${i} test starts ${gap}ms after prev test end (< embargo ${WALK_FORWARD_DEFAULTS.embargoMs})`,
      );
    }
  });

  test("minFoldsPassedFraction threshold is enforced on aggregate", () => {
    // Mixed: first half stable good, last half all failures.
    const good = denseStable(30, { success: true });
    const bad = denseStable(30, { success: false }).map((s) => ({
      ...s,
      tsMs: s.tsMs + 30 * DAY,
    }));
    const samples = [...good, ...bad];
    // With default 0.6 fraction, and mostly-failing back-half, should flunk.
    const r = evaluateWalkForwardCv({ samples });
    if (r.aggregate.totalFolds > 0 && r.aggregate.foldsPassed / r.aggregate.totalFolds < 0.6) {
      assert.equal(r.passes, false);
      assert.ok(r.blockers.includes("insufficient_folds_passed"));
    }
  });

  test("out-of-order samples get sorted before evaluation", () => {
    const stable = denseStable(100);
    // Shuffle deterministically.
    const shuffled = stable.slice();
    for (let i = 0; i < shuffled.length; i += 1) {
      const j = (i * 7) % shuffled.length;
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const rSorted = evaluateWalkForwardCv({ samples: stable });
    const rShuffled = evaluateWalkForwardCv({ samples: shuffled });
    assert.deepEqual(
      rSorted.aggregate,
      rShuffled.aggregate,
      "sort invariance broken",
    );
  });

  test("constants are frozen and non-trivial", () => {
    assert.ok(Object.isFrozen(WALK_FORWARD_DEFAULTS));
    assert.equal(WALK_FORWARD_DEFAULTS.folds, 5);
    assert.ok(WALK_FORWARD_DEFAULTS.trainMs > WALK_FORWARD_DEFAULTS.testMs);
    assert.ok(WALK_FORWARD_DEFAULTS.embargoMs > 0);
    assert.ok(WALK_FORWARD_DEFAULTS.purgeMs > 0);
  });
});
