import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarBoard } from "../src/strategy/radar/radar-board.mjs";

test("buildRadarBoard summarizes all radar phases without exposing raw payloads", () => {
  const board = buildRadarBoard({
    observations: [{ obsId: "obs_1", rawEventPayloadHash: "sha256:hidden" }],
    episodes: [{ episodeId: "episode_1", pnlClosureStatus: "closed" }],
    packets: [{ packetId: "packet_1" }],
    candidates: [{ candidateId: "candidate_1", gateStatus: "blocked", blockers: ["radar_policy_thresholds_unresolved"] }],
    realizationRecords: [{
      runId: "run_1",
      lifecycle: { strategyRealized: true, paybackDelivered: false },
      netRealizedPnlUsd: 1.25,
      netRealizedPnlSats: "-5",
    }],
  });

  assert.equal(board.summary.observedCount, 1);
  assert.equal(board.summary.strategyEpisodeCount, 1);
  assert.equal(board.summary.portablePacketCount, 1);
  assert.equal(board.summary.executableCount, 0);
  assert.equal(board.summary.strategyRealizedCount, 1);
  assert.equal(board.summary.positiveRealizedPnlCount, 1);
  assert.equal(board.summary.totalNetRealizedPnlUsd, 1.25);
  assert.equal(board.summary.totalNetRealizedPnlSats, "-5");
  assert.deepEqual(board.blockerCounts, { radar_policy_thresholds_unresolved: 1 });
  assert.equal(JSON.stringify(board).includes("rawEventPayloadHash"), false);
});
