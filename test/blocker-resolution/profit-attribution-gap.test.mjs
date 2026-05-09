import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaybackLifecycleBlockers } from "../../src/status/blocker-funnel-slice.mjs";

test("profit attribution gap is raised after live broadcast with zero realized sats beyond threshold", () => {
  const blockers = buildPaybackLifecycleBlockers({
    strategyTickStatus: {
      strategies: [
        {
          strategyId: "s1",
          firstLiveBroadcastAt: "2026-05-01T00:00:00.000Z",
          firstRealizedPnlSats: 0,
        },
      ],
    },
    now: "2026-05-09T00:00:00.000Z",
    config: { profitAttributionGapDays: 7 },
  });
  assert.equal(blockers[0].code, "payback_lifecycle:profit_attribution_gap");
  assert.equal(blockers[0].params.strategyId, "s1");
});
