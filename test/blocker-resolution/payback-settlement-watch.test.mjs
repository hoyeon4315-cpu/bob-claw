import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaybackLifecycleBlockers } from "../../src/status/blocker-funnel-slice.mjs";

test("payback settlement pending is raised when Gateway order lacks BTC L1 delta past timeout", () => {
  const blockers = buildPaybackLifecycleBlockers({
    payback: {
      scheduler: {
        lastIntent: {
          emittedAt: "2026-05-09T00:00:00.000Z",
          gatewayOrderId: "gw-1",
        },
      },
      lastBitcoinL1DeltaAt: null,
    },
    now: "2026-05-09T07:00:00.000Z",
    config: { paybackSettlementTimeoutHours: 6 },
  });
  assert.equal(blockers[0].code, "payback_lifecycle:payback_settlement_pending");
});
