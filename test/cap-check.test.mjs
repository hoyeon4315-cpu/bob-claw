import assert from "node:assert/strict";
import { test } from "node:test";

import { assertStrategyCaps } from "../src/config/strategy-caps.mjs";
import { evaluateCapCheck } from "../src/executor/policy/cap-check.mjs";

test("cap check consumes small-cap effective transport daily cap", () => {
  const strategyCaps = assertStrategyCaps("gateway-btc-funding-transfer", {
    activeCapitalUsd: 500,
  });
  const result = evaluateCapCheck({
    intent: {
      strategyId: "gateway-btc-funding-transfer",
      chain: "base",
      mode: "live",
      intentType: "bridge",
      amountUsd: 75,
    },
    strategyCaps,
    auditRecords: [
      {
        strategyId: "gateway-btc-funding-transfer",
        chain: "base",
        timestamp: "2026-05-08T00:00:00.000Z",
        amountUsd: 150,
        policyVerdict: "approved",
        lifecycle: { stage: "confirmed" },
      },
    ],
    now: "2026-05-08T01:00:00.000Z",
  });

  assert.equal(strategyCaps.caps.perDayUsd, 200);
  assert.ok(result.blockers.includes("strategy_per_day_cap_exceeded"));
});
