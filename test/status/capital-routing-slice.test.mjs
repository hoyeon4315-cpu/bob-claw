import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCapitalRoutingSummary } from "../../src/status/capital-routing-slice.mjs";
import { buildBlockerFunnelSlice } from "../../src/status/blocker-funnel-slice.mjs";

test("capital routing summary is additive on blocker funnel schema", () => {
  const capitalRoutingPlan = {
    totalExpectedDailyUsdOnResolve: 3.25,
    routingPlan: [
      { strategyId: "s1", classification: "ready_with_capital_addition" },
      { strategyId: "s2", classification: "ready_no_capital_change" },
    ],
    unresolvable: [
      { strategyId: "s3", classification: "floor_infeasible_at_committed_caps" },
    ],
  };
  assert.deepEqual(buildCapitalRoutingSummary(capitalRoutingPlan), {
    totalExpectedDailyUsdOnResolve: 3.25,
    planCount: 2,
    unresolvableCount: 1,
    classificationBreakdown: {
      ready_with_capital_addition: 1,
      ready_no_capital_change: 1,
      floor_infeasible_at_committed_caps: 1,
    },
  });
  const slice = buildBlockerFunnelSlice({
    strategyTickStatus: { strategies: [] },
    capitalRoutingPlan,
    generatedAt: "2026-05-09T00:00:00.000Z",
  });
  assert.equal(slice.schemaVersion, 2);
  assert.equal(slice.capitalRouting.planCount, 2);
});
