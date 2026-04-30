import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRadarLossLock } from "../src/risk/radar-loss-lock.mjs";

test("evaluateRadarLossLock trips on 24h realized radar loss above threshold", () => {
  const result = evaluateRadarLossLock({
    realizationRecords: [{
      lifecycle: { strategyRealized: true },
      netRealizedPnlUsd: -26,
      settledAt: "2026-05-01T11:00:00.000Z",
    }],
    now: "2026-05-01T12:00:00.000Z",
    thresholdUsd: 25,
    env: {},
  });

  assert.equal(result.tripped, true);
  assert.equal(result.loss24hUsd, 26);
  assert.equal(result.lockPath, "~/.bob-claw/RADAR_LOCK");
});

test("evaluateRadarLossLock ignores open or old losses", () => {
  const result = evaluateRadarLossLock({
    realizationRecords: [
      {
        lifecycle: { strategyRealized: false },
        netRealizedPnlUsd: -100,
        settledAt: "2026-05-01T11:00:00.000Z",
      },
      {
        lifecycle: { strategyRealized: true },
        netRealizedPnlUsd: -100,
        settledAt: "2026-04-29T11:00:00.000Z",
      },
    ],
    now: "2026-05-01T12:00:00.000Z",
    thresholdUsd: 25,
    env: { RADAR_LOCK_PATH: "/tmp/radar.lock" },
  });

  assert.equal(result.tripped, false);
  assert.equal(result.loss24hUsd, 0);
  assert.equal(result.lockPath, "/tmp/radar.lock");
});
