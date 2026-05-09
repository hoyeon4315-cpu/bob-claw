import assert from "node:assert/strict";
import { test } from "node:test";
import { solveMinViableNotional } from "../../../src/strategy/economics/min-viable-notional.mjs";

test("holding-period feasibility allows 10 pct APR to clear gas over a 30 day hold", () => {
  const result = solveMinViableNotional({
    edgeBpsPerDay: (1000 / 365),
    roundTripCostUsd: 5,
    slippageVarianceUsd: 0,
    varianceFloorUsd: 0,
    holdingPeriodDays: 30,
    caps: { perTxUsd: 1000, perChainUsd: { base: 1000 }, chain: "base" },
  });

  assert.equal(result.infeasible, false);
  assert.ok(result.minNotionalUsd < 1000);
});

test("holding-period feasibility keeps the same 10 pct APR infeasible for a one day hold", () => {
  const result = solveMinViableNotional({
    edgeBpsPerDay: (1000 / 365),
    roundTripCostUsd: 5,
    slippageVarianceUsd: 0,
    varianceFloorUsd: 0,
    holdingPeriodDays: 1,
    caps: { perTxUsd: 1000, perChainUsd: { base: 1000 }, chain: "base" },
  });

  assert.equal(result.infeasible, true);
  assert.equal(result.reason, "floor_infeasible_at_committed_caps");
});
