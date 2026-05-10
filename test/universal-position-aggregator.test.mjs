import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUniversalPositionSnapshot } from "../src/treasury/universal-position-aggregator.mjs";

test("reader failure keeps known position visible with staleness metadata", () => {
  const snapshot = buildUniversalPositionSnapshot({
    now: "2026-05-10T00:00:00.000Z",
    readerResults: [
      {
        ok: false,
        source: "reader:base:yo",
        chain: "base",
        protocolId: "yo",
        error: { code: "rpc_failed", message: "timeout" },
      },
    ],
    lastKnownPositions: [
      {
        positionId: "protocol:base:yo:vault",
        chain: "base",
        protocolId: "yo",
        valueUsd: 40,
        observedAt: "2026-05-09T23:00:00.000Z",
      },
    ],
    auditRecords: [
      {
        strategyId: "yo-vault",
        lifecycle: { stage: "broadcasted" },
        intent: { positionId: "protocol:base:yo:vault" },
      },
    ],
  });

  assert.equal(snapshot.positions.length, 1);
  assert.equal(snapshot.positions[0].visibilityStatus, "stale_reader_fallback");
  assert.equal(snapshot.positions[0].staleness.reason, "reader_failed_last_known_preserved");
  assert.equal(snapshot.positions[0].auditBacked, true);
  assert.equal(snapshot.sourceHealth[0].ok, false);
});
