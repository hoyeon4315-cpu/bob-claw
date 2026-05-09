import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlockerFunnelSlice } from "../../src/status/blocker-funnel-slice.mjs";

test("blocker funnel marks quarantine candidates without auto-pausing", () => {
  const slice = buildBlockerFunnelSlice({
    strategyTickStatus: {
      strategies: [
        { strategyId: "s1", lastTickBlockers: ["stale_gateway_quote"], lastTickAt: "2026-05-09T00:00:00.000Z" },
      ],
    },
    resolverState: {
      byParamsKey: {},
    },
    config: { quarantineTickThreshold: 2 },
    generatedAt: "2026-05-09T00:00:02.000Z",
    previousSlice: {
      strategies: [
        { strategyId: "s1", code: "proof_acquisition:route_quote_stale", paramsKey: "ignored", consecutiveTicks: 1 },
      ],
    },
  });
  assert.equal(slice.strategies[0].consecutiveTicks, 2);
  assert.equal(slice.strategies[0].quarantineCandidate, true);
  assert.equal(slice.strategies[0].autoPaused, undefined);
});
