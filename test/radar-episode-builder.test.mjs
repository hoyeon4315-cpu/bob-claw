import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStrategyEpisode,
  episodeBlocksPortability,
} from "../src/strategy/radar/strategy-episode-builder.mjs";

const observation = Object.freeze({
  obsId: "obs_episode_001",
  walletClusterId: "cluster_episode",
});

test("buildStrategyEpisode creates a provisional hypothesis without treating external pnl as verified", () => {
  const result = buildStrategyEpisode({
    episodeId: "episode_001",
    observations: [observation],
    strategyCategory: "campaign_reward_farming",
    hypothesisAssumptions: ["same wallet entered and exited the market"],
    falsifiers: [{ name: "cex_hop", result: false }],
    referenceWalletPnlClaim: { valueSats: "1000", source: "external_label" },
    selfReplayPnlSats: null,
    pnlClosurePathProof: [],
    pnlClosureStatus: "unknown",
  });

  assert.equal(result.ok, true);
  assert.equal(result.episode.referenceWalletPnlClaim.verified, false);
  assert.equal(result.episode.derivedFrom[0], "obs_episode_001");
});

test("episodeBlocksPortability blocks broken attribution paths", () => {
  const result = buildStrategyEpisode({
    episodeId: "episode_cex",
    observations: [observation],
    strategyCategory: "lending_supply_carry",
    hypothesisAssumptions: ["deposit and withdrawal observed"],
    falsifiers: [{ name: "cex_hop", result: true }],
    referenceWalletPnlClaim: null,
    selfReplayPnlSats: "50",
    pnlClosurePathProof: ["entry", "cex_hop"],
    pnlClosureStatus: "broken_at_cex",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(episodeBlocksPortability(result.episode), ["radar_pnl_closure_broken_at_cex"]);
});
