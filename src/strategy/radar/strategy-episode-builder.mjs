import { validateStrategyEpisode } from "./schema/index.mjs";

const BROKEN_CLOSURE_STATUS_BLOCKERS = Object.freeze({
  broken_at_cex: "radar_pnl_closure_broken_at_cex",
  broken_at_mixer: "radar_pnl_closure_broken_at_mixer",
  broken_at_unlabeled_hop: "radar_pnl_closure_broken_at_unlabeled_hop",
});

function derivedFromObservations(observations = []) {
  return observations.map((item) => item?.obsId).filter(Boolean);
}

function firstCluster(observations = []) {
  return observations.map((item) => item?.walletClusterId).find(Boolean) || null;
}

export function episodeBlocksPortability(episode = {}) {
  const blocker = BROKEN_CLOSURE_STATUS_BLOCKERS[episode.pnlClosureStatus];
  return blocker ? [blocker] : [];
}

export function buildStrategyEpisode({
  episodeId,
  observations = [],
  strategyCategory,
  hypothesisAssumptions = [],
  falsifiers = [],
  referenceWalletPnlClaim = null,
  selfReplayPnlSats = null,
  pnlClosurePathProof = [],
  pnlClosureStatus = "unknown",
} = {}) {
  const candidate = {
    episodeId,
    derivedFrom: derivedFromObservations(observations),
    walletClusterId: firstCluster(observations),
    strategyCategory,
    hypothesisAssumptions,
    falsifiers,
    referenceWalletPnlClaim,
    selfReplayPnlSats,
    pnlClosurePathProof,
    pnlClosureStatus,
  };
  const result = validateStrategyEpisode(candidate);
  return {
    ok: result.ok,
    blockers: result.blockers,
    episode: result.value,
  };
}
