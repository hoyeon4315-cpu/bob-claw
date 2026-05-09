import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlockerFunnelSlice } from "../../src/status/blocker-funnel-slice.mjs";

test("blocker funnel groups root causes, normalizes codes, and separates resolver actionable from policy changes", () => {
  const slice = buildBlockerFunnelSlice({
    strategyTickStatus: {
      strategies: [
        { strategyId: "s1", lastTickBlockers: ["stale_gateway_quote"], lastTickAt: "2026-05-09T00:00:00.000Z" },
        { strategyId: "s2", topDenyReason: "same_chain_unprofitable:need_$5_on_base", lastTickAt: "2026-05-09T00:00:01.000Z" },
      ],
    },
    resolverState: {
      byParamsKey: {},
    },
    generatedAt: "2026-05-09T00:00:02.000Z",
  });
  assert.equal(slice.schemaVersion, 1);
  assert.equal(slice.resolverActionableCount, 1);
  assert.equal(slice.requiresStrategyOrCapitalChangeCount, 1);
  assert.equal(slice.codeFrequency["proof_acquisition:route_quote_stale"], 1);
  assert.equal(slice.codeFrequency["economic_no_go:edge_below_variance_floor"], 1);
  assert.equal(slice.rootCauseGroups.length, 2);
  assert.equal(slice.strategies[0].code, "proof_acquisition:route_quote_stale");
});
