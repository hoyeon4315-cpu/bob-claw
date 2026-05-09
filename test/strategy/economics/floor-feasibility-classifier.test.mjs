import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyFloorFeasibility } from "../../../src/strategy/economics/floor-feasibility-classifier.mjs";

function snapshot(overrides = {}) {
  return {
    strategyId: "s1",
    measuredEdgeBpsPerDay: 20,
    measuredRoundTripCostUsd: 1,
    slippageVarianceUsd: 0.2,
    varianceFloorUsd: 0.5,
    observedNotionalUsd: 100,
    freshness: { lastReceiptAt: "2026-05-08T00:00:00.000Z", sampleCount: 3, isThin: false },
    ...overrides,
  };
}

test("floor feasibility separates already viable, capital-addition, and capital-acquisition cases", () => {
  const rows = classifyFloorFeasibility({
    snapshots: [
      snapshot({ strategyId: "ready", observedNotionalUsd: 751 }),
      snapshot({ strategyId: "add", observedNotionalUsd: 700 }),
      snapshot({ strategyId: "acquire", observedNotionalUsd: 100 }),
    ],
    minViableByStrategy: {
      ready: { minNotionalUsd: 750.001, infeasible: false, reason: null },
      add: { minNotionalUsd: 750.001, infeasible: false, reason: null },
      acquire: { minNotionalUsd: 750.001, infeasible: false, reason: null },
    },
    treasury: {
      freeCapitalUsd: 75,
      sources: [{ chain: "base", asset: "USDC", freeUsd: 75 }],
    },
  });
  const byId = new Map(rows.map((row) => [row.strategyId, row]));
  assert.equal(byId.get("ready").classification, "ready_no_capital_change");
  assert.equal(byId.get("ready").capitalDeltaNeededUsd, 0);
  assert.equal(byId.get("add").classification, "ready_with_capital_addition");
  assert.equal(byId.get("add").capitalSourceCandidates.length, 1);
  assert.equal(byId.get("acquire").classification, "needs_capital_acquisition");
  assert.ok(byId.get("add").expectedDailyUsdOnResolve > 0);
});

test("floor feasibility preserves infeasible, negative edge, thin evidence, and missing input classes", () => {
  const rows = classifyFloorFeasibility({
    snapshots: [
      snapshot({ strategyId: "cap" }),
      snapshot({ strategyId: "negative" }),
      snapshot({ strategyId: "thin", freshness: { lastReceiptAt: null, sampleCount: 1, isThin: true } }),
      snapshot({ strategyId: "missing", measuredEdgeBpsPerDay: null }),
    ],
    minViableByStrategy: {
      cap: { minNotionalUsd: 1000, infeasible: true, reason: "floor_infeasible_at_committed_caps" },
      negative: { minNotionalUsd: null, infeasible: true, reason: "negative_or_zero_edge" },
      thin: { minNotionalUsd: 750, infeasible: false, reason: null },
      missing: { minNotionalUsd: null, infeasible: true, reason: "missing_input" },
    },
    treasury: { freeCapitalUsd: 10, sources: [] },
  });
  const byId = new Map(rows.map((row) => [row.strategyId, row]));
  assert.equal(byId.get("cap").classification, "floor_infeasible_at_committed_caps");
  assert.equal(byId.get("negative").classification, "negative_or_zero_edge");
  assert.equal(byId.get("thin").classification, "thin_evidence");
  assert.equal(byId.get("missing").classification, "missing_input");
});
