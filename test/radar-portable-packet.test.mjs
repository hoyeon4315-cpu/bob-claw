import assert from "node:assert/strict";
import test from "node:test";

import { buildPortableOpportunityPacket } from "../src/strategy/radar/portable-packet-builder.mjs";

const closedEpisode = Object.freeze({
  episodeId: "episode_closed",
  strategyCategory: "campaign_reward_farming",
  selfReplayPnlSats: "12",
  pnlClosureStatus: "closed",
  walletClusterId: "cluster_a",
});

test("buildPortableOpportunityPacket requires closed positive self replay evidence", () => {
  const result = buildPortableOpportunityPacket({
    packetId: "packet_001",
    episodes: [closedEpisode],
    portabilityWalletSet: ["cluster_a", "cluster_b"],
    portabilityClusterIndependenceProof: "distinct_funding_sources",
    rewardTokenSymbol: "TOKEN",
    rewardVestingSchedule: "none_observed",
    rewardLockupSeconds: 0,
    rewardTokenHaircutSats: "0",
    oracleSource: "chainlink",
    oracleStalenessSecondsMax: 60,
    capacityAtProposedSize: "unknown",
  });

  assert.equal(result.ok, true);
  assert.equal(result.packet.packetId, "packet_001");
  assert.deepEqual(result.blockers, []);
});

test("buildPortableOpportunityPacket blocks missing replay and open closure", () => {
  const result = buildPortableOpportunityPacket({
    packetId: "packet_blocked",
    episodes: [{
      ...closedEpisode,
      episodeId: "episode_open",
      selfReplayPnlSats: null,
      pnlClosureStatus: "open",
    }],
    portabilityWalletSet: ["cluster_a"],
    portabilityClusterIndependenceProof: null,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, [
    "radar_portability_wallet_set_below_policy",
    "radar_portability_cluster_independence_missing",
    "radar_self_replay_missing",
    "radar_pnl_closure_not_closed",
  ]);
});
