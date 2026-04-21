import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRegime,
  annotateRegimeSeries,
  extractRegimeChanges,
  hasRegimeChangeInWindow,
  summarizeRegimeWindow,
  REGIME_THRESHOLDS,
} from "../src/strategy/regime-detector.mjs";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2025-01-01T00:00:00Z");

describe("classifyRegime", () => {
  test("MM below 1.0 => bear", () => {
    assert.equal(classifyRegime(0.5), "bear");
    assert.equal(classifyRegime(0.99), "bear");
  });
  test("MM in [1.0, 2.4) => neutral", () => {
    assert.equal(classifyRegime(1.0), "neutral");
    assert.equal(classifyRegime(1.8), "neutral");
    assert.equal(classifyRegime(2.39), "neutral");
  });
  test("MM >= 2.4 => bull_peak", () => {
    assert.equal(classifyRegime(2.4), "bull_peak");
    assert.equal(classifyRegime(3.5), "bull_peak");
  });
  test("non-positive / non-finite => unknown", () => {
    assert.equal(classifyRegime(0), "unknown");
    assert.equal(classifyRegime(-1), "unknown");
    assert.equal(classifyRegime(NaN), "unknown");
    assert.equal(classifyRegime(Infinity), "unknown");
    assert.equal(classifyRegime(undefined), "unknown");
    assert.equal(classifyRegime(null), "unknown");
  });
});

describe("annotateRegimeSeries", () => {
  test("rejects non-array", () => {
    assert.throws(() => annotateRegimeSeries("nope"), /array/);
  });

  test("first 200 days before full window => unknown", () => {
    // 100 daily points; 200d window not filled yet.
    const series = [];
    for (let d = 0; d < 100; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    }
    const a = annotateRegimeSeries(series);
    assert.equal(a.length, 100);
    for (const p of a) {
      assert.equal(p.regime, "unknown");
      assert.equal(p.mayerMultiple, null);
    }
  });

  test("post-window stable price classifies as neutral (MM=1)", () => {
    const series = [];
    for (let d = 0; d < 300; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    }
    const a = annotateRegimeSeries(series);
    // Last point: MM should be ~1.0 (stable → neutral).
    const last = a[a.length - 1];
    assert.equal(last.regime, "neutral");
    assert.ok(Math.abs(last.mayerMultiple - 1.0) < 0.01);
  });

  test("strong sustained rally => bull_peak", () => {
    // 200d flat @ 50k, then 100d climbing from 50k to 500k (10x).
    // By end of rally, spot far exceeds 200d MA even with dilution.
    const series = [];
    for (let d = 0; d < 200; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    }
    for (let d = 200; d < 300; d += 1) {
      const progress = (d - 200) / 100;
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 + progress * 450000 });
    }
    const a = annotateRegimeSeries(series);
    const last = a[a.length - 1];
    assert.equal(last.regime, "bull_peak",
      `expected bull_peak at last point; got ${last.regime} MM=${last.mayerMultiple}`);
    assert.ok(last.mayerMultiple >= REGIME_THRESHOLDS.bullPeakFloor);
  });

  test("price collapse => bear", () => {
    const series = [];
    for (let d = 0; d < 200; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 100000 });
    }
    for (let d = 200; d < 260; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 40000 });
    }
    const a = annotateRegimeSeries(series);
    const last = a[a.length - 1];
    assert.equal(last.regime, "bear");
    assert.ok(last.mayerMultiple < REGIME_THRESHOLDS.bearCeiling);
  });

  test("unsorted input gets sorted", () => {
    const series = [];
    for (let d = 0; d < 250; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    }
    const shuffled = series.slice().reverse();
    const aSorted = annotateRegimeSeries(series);
    const aShuffled = annotateRegimeSeries(shuffled);
    assert.equal(aShuffled.length, aSorted.length);
    for (let i = 0; i < aSorted.length; i += 1) {
      assert.equal(aShuffled[i].regime, aSorted[i].regime);
    }
  });

  test("output is frozen", () => {
    const series = [{ tsMs: T0, priceUsd: 50000 }];
    const a = annotateRegimeSeries(series);
    assert.ok(Object.isFrozen(a));
    assert.ok(Object.isFrozen(a[0]));
  });
});

describe("extractRegimeChanges + hasRegimeChangeInWindow", () => {
  function buildCycleSeries() {
    // 200d flat @ $50k => neutral baseline
    // 60d climb to $150k => eventual bull_peak
    // 60d down to $40k => eventual bear
    // 60d back to $80k => neutral
    const series = [];
    let d = 0;
    for (; d < 200; d += 1) series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    for (let i = 0; i < 60; i += 1, d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 + i * 2000 });
    }
    for (let i = 0; i < 60; i += 1, d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 170000 - i * 2500 });
    }
    for (let i = 0; i < 60; i += 1, d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 40000 + i * 700 });
    }
    return series;
  }

  test("detects at least one regime change across a full cycle", () => {
    const series = buildCycleSeries();
    const annotated = annotateRegimeSeries(series);
    const changes = extractRegimeChanges(annotated);
    assert.ok(changes.length >= 1, `expected regime changes, got ${JSON.stringify(changes)}`);
    // At least one transition should be neutral->bull_peak or bull_peak->something.
    const involvesBull = changes.some(
      (c) => c.fromRegime === "bull_peak" || c.toRegime === "bull_peak",
    );
    assert.equal(involvesBull, true);
  });

  test("window with no transition returns false", () => {
    const series = [];
    for (let d = 0; d < 300; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    }
    const annotated = annotateRegimeSeries(series);
    const r = hasRegimeChangeInWindow({
      annotated,
      startMs: T0 + 210 * DAY,
      endMs: T0 + 290 * DAY,
    });
    assert.equal(r, false);
  });

  test("window containing a transition returns true", () => {
    const series = buildCycleSeries();
    const annotated = annotateRegimeSeries(series);
    const r = hasRegimeChangeInWindow({
      annotated,
      startMs: T0,
      endMs: T0 + 400 * DAY,
    });
    assert.equal(r, true);
  });

  test("hasRegimeChangeInWindow validates bounds", () => {
    assert.throws(() => hasRegimeChangeInWindow({ annotated: [], startMs: 10, endMs: 5 }), /startMs/);
    assert.throws(() => hasRegimeChangeInWindow({ annotated: [], startMs: NaN, endMs: 5 }), /startMs/);
  });

  test("transitions from/into unknown are NOT counted as changes", () => {
    // First 100 days not-enough-data (unknown), then flat neutral.
    const series = [];
    for (let d = 0; d < 300; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    }
    const annotated = annotateRegimeSeries(series);
    const changes = extractRegimeChanges(annotated);
    assert.equal(changes.length, 0);
  });
});

describe("summarizeRegimeWindow", () => {
  test("returns frozen summary with counts and changes", () => {
    const series = [];
    for (let d = 0; d < 300; d += 1) {
      series.push({ tsMs: T0 + d * DAY, priceUsd: 50000 });
    }
    const summary = summarizeRegimeWindow({
      priceSeries: series,
      startMs: T0 + 210 * DAY,
      endMs: T0 + 290 * DAY,
    });
    assert.ok(Object.isFrozen(summary));
    assert.ok(Object.isFrozen(summary.regimes));
    assert.equal(summary.hasChange, false);
    assert.ok(summary.pointsInWindow > 0);
    assert.ok(summary.regimes.neutral > 0);
  });
});
