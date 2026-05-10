import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWalkForwardCv } from "../src/research/pendle-wf-cv-harness.mjs";

describe("pendle-wf-cv-harness", () => {
  function makeMarketHistory(opts = {}) {
    const days = opts.days || 120;
    const samples = [];
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const DAY = 24 * 60 * 60 * 1000;
    for (let d = 0; d < days; d++) {
      samples.push({
        ts: t0 + d * DAY,
        impliedAprPct: 10 + Math.sin(d / 10) * 5,
        ytPriceUsd: 0.12 + Math.cos(d / 15) * 0.02,
        underlyingPriceUsd: 1.0,
        volumeUsd: 50000 + d * 100,
      });
    }
    return samples;
  }

  it("returns evidence object with required fields", () => {
    const history = makeMarketHistory();
    const evidence = runWalkForwardCv({ marketHistory: history });
    assert.equal(typeof evidence, "object");
    assert.equal(typeof evidence.strategyId, "string");
    assert.equal(typeof evidence.walkForward, "object");
    assert.equal(typeof evidence.shadow, "object");
    assert.equal(typeof evidence.execution, "object");
    assert.equal(typeof evidence.oosHoldout, "object");
    assert.equal(typeof evidence.regimeBreakdown, "object");
  });

  it("walkForward has numeric fields", () => {
    const history = makeMarketHistory();
    const evidence = runWalkForwardCv({ marketHistory: history });
    assert.equal(typeof evidence.walkForward.sharpe, "number");
    assert.equal(typeof evidence.walkForward.maxDrawdownPct, "number");
    assert.equal(typeof evidence.walkForward.regimeChanges, "number");
    assert.equal(typeof evidence.walkForward.samplePeriods, "number");
  });

  it("regimeBreakdown contains bear/neutral/bull_peak", () => {
    const history = makeMarketHistory();
    const evidence = runWalkForwardCv({ marketHistory: history });
    assert.ok(evidence.regimeBreakdown.bear);
    assert.ok(evidence.regimeBreakdown.neutral);
    assert.ok(evidence.regimeBreakdown.bull_peak);
    assert.equal(typeof evidence.regimeBreakdown.bear.sampleCount, "number");
    assert.equal(typeof evidence.regimeBreakdown.bear.netPnlUsd, "number");
  });

  it("shadow has required booleans/numbers", () => {
    const history = makeMarketHistory();
    const evidence = runWalkForwardCv({ marketHistory: history });
    assert.equal(typeof evidence.shadow.consecutivePositivePeriods, "number");
    assert.equal(typeof evidence.shadow.netOfMeasuredCost, "boolean");
    assert.equal(typeof evidence.shadow.quoteSuccessRate, "number");
  });

  it("execution has required numeric fields", () => {
    const history = makeMarketHistory();
    const evidence = runWalkForwardCv({ marketHistory: history });
    assert.equal(typeof evidence.execution.oracleDivergencePct, "number");
    assert.equal(typeof evidence.execution.slippagePct, "number");
    assert.equal(typeof evidence.execution.edgeAboveCostVariance, "boolean");
  });

  it("oosHoldout has required fields", () => {
    const history = makeMarketHistory();
    const evidence = runWalkForwardCv({ marketHistory: history });
    assert.equal(typeof evidence.oosHoldout.holdoutDays, "number");
    assert.equal(typeof evidence.oosHoldout.netPositive, "boolean");
  });

  it("accepts custom strategyId", () => {
    const history = makeMarketHistory();
    const evidence = runWalkForwardCv({
      marketHistory: history,
      config: { strategyId: "custom-id" },
    });
    assert.equal(evidence.strategyId, "custom-id");
  });

  it("short history still returns shape without throwing", () => {
    const history = makeMarketHistory({ days: 5 });
    const evidence = runWalkForwardCv({ marketHistory: history });
    assert.equal(typeof evidence, "object");
    assert.equal(typeof evidence.walkForward, "object");
  });
});
