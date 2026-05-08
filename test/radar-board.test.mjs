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
  assert.equal(board.summary.candidateCount, 1);
  assert.equal(board.summary.executableCount, 0);
  assert.equal(board.summary.blockedCandidateCount, 1);
  assert.equal(board.summary.topCandidateBlocker, "radar_policy_thresholds_unresolved");
  assert.deepEqual(board.summary.candidateStatusCounts, { blocked: 1 });
  assert.equal(board.summary.strategyRealizedCount, 1);
  assert.equal(board.summary.positiveRealizedPnlCount, 1);
  assert.equal(board.summary.totalNetRealizedPnlUsd, 1.25);
  assert.equal(board.summary.totalNetRealizedPnlSats, "-5");
  assert.deepEqual(board.blockerCounts, { radar_policy_thresholds_unresolved: 1 });
  assert.equal(JSON.stringify(board).includes("rawEventPayloadHash"), false);
});

test("buildRadarBoard summarizes the latest version for each executable candidate", () => {
  const board = buildRadarBoard({
    generatedAt: "2026-05-01T00:05:30.000Z",
    candidates: [
      {
        candidateId: "candidate_1",
        observedAt: "2026-05-01T00:00:00.000Z",
        gateStatus: "blocked",
        blockers: ["position_below_min_position_usd"],
      },
      {
        candidateId: "candidate_1",
        observedAt: "2026-05-01T00:05:00.000Z",
        gateStatus: "executable",
        blockers: [],
      },
    ],
  });

  assert.equal(board.summary.executableCount, 1);
  assert.equal(board.summary.candidateCount, 1);
  assert.equal(board.summary.blockedCandidateCount, 0);
  assert.deepEqual(board.blockerCounts, {});
  assert.deepEqual(board.candidates, [{
    candidateId: "candidate_1",
    gateStatus: "executable",
    blockers: [],
  }]);
});

test("buildRadarBoard does not count stale executable candidates as executable", () => {
  const board = buildRadarBoard({
    generatedAt: "2026-05-07T00:00:00.000Z",
    candidates: [
      {
        candidateId: "candidate_1",
        observedAt: "2026-05-01T00:00:00.000Z",
        gateStatus: "executable",
        blockers: [],
      },
    ],
  });

  assert.equal(board.summary.executableCount, 0);
  assert.equal(board.summary.blockedCandidateCount, 1);
  assert.deepEqual(board.summary.candidateStatusCounts, { blocked: 1 });
  assert.deepEqual(board.blockerCounts, { executable_candidate_stale: 1 });
  assert.deepEqual(board.candidates, [{
    candidateId: "candidate_1",
    gateStatus: "blocked",
    blockers: ["executable_candidate_stale"],
  }]);
});
