import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotateOpportunityCost,
  annotateOpportunitiesCost,
  filterCostPositiveOpportunities,
} from "../src/strategy/round-trip-cost-annotator.mjs";

test("annotateOpportunityCost adds roundTripCostUsd for known chain", () => {
  const result = annotateOpportunityCost({
    chain: "base",
    aprPct: 12,
    tvlUsd: 1_000_000,
    executionSurface: "lending",
  });
  assert.equal(typeof result.roundTripCostUsd, "number");
  assert.ok(result.roundTripCostUsd > 0);
  assert.equal(result.costAnnotationError, undefined);
});

test("annotateOpportunityCost uses fallback for unknown chain", () => {
  const result = annotateOpportunityCost({
    chain: "fantasy",
    aprPct: 10,
    tvlUsd: 500_000,
  });
  assert.equal(typeof result.roundTripCostUsd, "number");
  assert.ok(result.roundTripCostUsd > 0);
});

test("annotateOpportunityCost returns error for missing chain", () => {
  const result = annotateOpportunityCost({ aprPct: 10 });
  assert.equal(result.roundTripCostUsd, null);
  assert.equal(result.costAnnotationError, "missing_chain");
});

test("annotateOpportunityCost applies clLp adjustment", () => {
  const lending = annotateOpportunityCost({
    chain: "base",
    aprPct: 12,
    tvlUsd: 1_000_000,
    executionSurface: "lending",
  });
  const clLp = annotateOpportunityCost({
    chain: "base",
    aprPct: 12,
    tvlUsd: 1_000_000,
    executionSurface: "clLp",
  });
  assert.ok(clLp.roundTripCostUsd > lending.roundTripCostUsd);
});

test("annotateOpportunityCost uses custom routeCostEstimator", () => {
  const custom = annotateOpportunityCost(
    { chain: "base", aprPct: 10, tvlUsd: 100_000 },
    {
      routeCostEstimator: () => ({
        bridgeIn: 1,
        bridgeOut: 1,
        entryGas: 1,
        exitGas: 1,
      }),
    }
  );
  assert.equal(custom.roundTripCostUsd, 4);
});

test("annotateOpportunityCost computes effectiveApr below postedApr", () => {
  const result = annotateOpportunityCost({
    chain: "base",
    aprPct: 12,
    tvlUsd: 1_000_000,
  });
  assert.ok(result.effectiveApr < 0.12);
  assert.ok(result.effectiveApr >= 0);
});

test("annotateOpportunityCost computes net30dYieldUsd", () => {
  const result = annotateOpportunityCost({
    chain: "base",
    aprPct: 12,
    tvlUsd: 1_000_000,
    positionUsd: 10_000,
  });
  assert.equal(typeof result.net30dYieldUsd, "number");
});

test("annotateOpportunitiesCost maps over array", () => {
  const results = annotateOpportunitiesCost([
    { chain: "base", aprPct: 10, tvlUsd: 100_000 },
    { chain: "ethereum", aprPct: 8, tvlUsd: 200_000 },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].chain, "base");
  assert.equal(results[1].chain, "ethereum");
});

test("filterCostPositiveOpportunities keeps only positive net30d", () => {
  const opps = [
    { net30dYieldUsd: 10, roundTripCostUsd: 5 },
    { net30dYieldUsd: -2, roundTripCostUsd: 5 },
    { net30dYieldUsd: 0, roundTripCostUsd: 5 },
    { net30dYieldUsd: 3, roundTripCostUsd: null },
  ];
  const filtered = filterCostPositiveOpportunities(opps);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].net30dYieldUsd, 10);
});

test("annotateOpportunityCost includes amortizedDailyCostUsd", () => {
  const result = annotateOpportunityCost({
    chain: "base",
    aprPct: 12,
    tvlUsd: 1_000_000,
    minHoldDays: 10,
  });
  assert.equal(result.amortizedDailyCostUsd, result.roundTripCostUsd / 10);
});
