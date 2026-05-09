import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGovernorReplay } from "../src/audit/governor-replay.mjs";

test("governor replay simulates policy rejects without mutating broadcast state", () => {
  const replay = buildGovernorReplay({
    auditRecords: [
      {
        timestamp: "2026-05-01T00:00:00.000Z",
        strategyId: "native-gas-refill",
        chain: "base",
        lifecycleStage: "refill",
        intent: {
          intentType: "capital_rebalance",
          expectedNetUsd: 0.1,
          gasEstimateUsd: 1,
        },
        lifecycle: { stage: "broadcasted" },
        broadcast: { txHash: "0x1" },
        realized: { actualKnownCostUsd: 0.25 },
      },
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        strategyId: "tiny-canary",
        chain: "base",
        lifecycleStage: "canary",
        intent: {
          intentType: "tiny_live_canary",
          expectedNetUsd: 10,
          gasEstimateUsd: 1,
        },
        lifecycle: { stage: "broadcasted" },
        broadcast: { txHash: "0x2" },
        realized: { actualKnownCostUsd: 0.1 },
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(replay.summary.broadcastCount, 2);
  assert.equal(replay.summary.wouldRejectCount, 1);
  assert.equal(replay.summary.avoidableGasUsd, 0.25);
  assert.equal(replay.markdown.includes("| native-gas-refill | base | refill | 1 | 0.25 |"), true);
});
