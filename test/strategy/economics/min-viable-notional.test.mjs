import assert from "node:assert/strict";
import { test } from "node:test";
import { solveMinViableNotional } from "../../../src/strategy/economics/min-viable-notional.mjs";

test("minimum viable notional solves strict edge above cost and variance floor", () => {
  const result = solveMinViableNotional({
    edgeBpsPerDay: 20,
    roundTripCostUsd: 1,
    slippageVarianceUsd: 0.2,
    varianceFloorUsd: 0.5,
    holdingPeriodDays: 1,
  });
  assert.equal(result.infeasible, false);
  assert.equal(result.reason, null);
  assert.ok(result.minNotionalUsd > 750);
  assert.ok(result.minNotionalUsd <= 750.01);
});

test("minimum viable notional handles fractional bps and longer hold windows", () => {
  const result = solveMinViableNotional({
    edgeBpsPerDay: 12.5,
    roundTripCostUsd: 0.25,
    slippageVarianceUsd: 0.05,
    varianceFloorUsd: 0.1,
    holdingPeriodDays: 2,
  });
  assert.equal(result.infeasible, false);
  assert.ok(result.minNotionalUsd > 140);
  assert.ok(result.minNotionalUsd <= 140.01);
});

test("minimum viable notional rejects non-positive edge and invalid cost inputs", () => {
  assert.deepEqual(
    solveMinViableNotional({
      edgeBpsPerDay: 0,
      roundTripCostUsd: 1,
      slippageVarianceUsd: 0,
      varianceFloorUsd: 0.1,
      holdingPeriodDays: 1,
    }),
    { minNotionalUsd: null, infeasible: true, reason: "negative_or_zero_edge" },
  );
  assert.deepEqual(
    solveMinViableNotional({
      edgeBpsPerDay: 10,
      roundTripCostUsd: 0,
      slippageVarianceUsd: 0,
      varianceFloorUsd: 0.1,
      holdingPeriodDays: 1,
    }),
    { minNotionalUsd: null, infeasible: true, reason: "cost_input_invalid" },
  );
});

test("minimum viable notional classifies floor infeasible at committed caps", () => {
  const result = solveMinViableNotional({
    edgeBpsPerDay: 20,
    roundTripCostUsd: 1,
    slippageVarianceUsd: 0.2,
    varianceFloorUsd: 0.5,
    holdingPeriodDays: 1,
    caps: {
      perTxUsd: 100,
      perChainUsd: { base: 150 },
      chain: "base",
    },
  });
  assert.equal(result.infeasible, true);
  assert.equal(result.reason, "floor_infeasible_at_committed_caps");
  assert.ok(result.minNotionalUsd > 750);
});
