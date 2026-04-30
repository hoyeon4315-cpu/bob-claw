import { RADAR_POLICY } from "../../config/radar-policy.mjs";
import { validatePortableOpportunityPacket } from "./schema/index.mjs";
import { episodeBlocksPortability } from "./strategy-episode-builder.mjs";

function positiveSats(value) {
  if (value === null || value === undefined) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function minPortableWalletSet(policy = RADAR_POLICY) {
  return Number.isInteger(policy?.thresholds?.portableWalletSetMin)
    ? policy.thresholds.portableWalletSetMin
    : 2;
}

function episodeBlockers(episode = {}) {
  const blockers = [...episodeBlocksPortability(episode)];
  const hasUsdPnl = episode.selfReplayNetPnlUsd !== null && episode.selfReplayNetPnlUsd !== undefined;
  const hasSatsPnl = episode.selfReplayPnlSats !== null && episode.selfReplayPnlSats !== undefined;
  if (!hasUsdPnl && !hasSatsPnl) {
    blockers.push("radar_self_replay_missing");
  } else if (!positiveNumber(episode.selfReplayNetPnlUsd) && !positiveSats(episode.selfReplayPnlSats)) {
    blockers.push("radar_self_replay_non_positive");
  }
  if (episode.pnlClosureStatus !== "closed") {
    blockers.push("radar_pnl_closure_not_closed");
  }
  return blockers;
}

export function buildPortableOpportunityPacket({
  packetId,
  episodes = [],
  portabilityWalletSet = [],
  portabilityClusterIndependenceProof = null,
  rewardTokenSymbol = null,
  rewardEmissionPerBlock = null,
  rewardEmissionEndBlock = null,
  rewardVestingSchedule = null,
  rewardLockupSeconds = null,
  rewardTokenLiquidityDepthUsd = null,
  rewardTokenSlippageAtSize = null,
  rewardTokenHaircutSats = null,
  oracleSource = null,
  oracleStalenessSecondsMax = null,
  oracleManipulationCostUsd = null,
  capacityAtProposedSize = null,
  slippageSimAtSize = null,
  slippageSimAt2x = null,
  slippageSimAt5x = null,
  poolUtilizationNow = null,
  borrowRateCurveSnapshot = null,
  withdrawalQueueDepth = null,
  redemptionLatencySecondsP50 = null,
  redemptionLatencySecondsP99 = null,
  policy = RADAR_POLICY,
} = {}) {
  const blockers = [];
  if (portabilityWalletSet.length < minPortableWalletSet(policy)) {
    blockers.push("radar_portability_wallet_set_below_policy");
  }
  if (!portabilityClusterIndependenceProof) {
    blockers.push("radar_portability_cluster_independence_missing");
  }
  for (const episode of episodes) {
    blockers.push(...episodeBlockers(episode));
  }

  const packet = {
    packetId,
    episodeIds: episodes.map((episode) => episode.episodeId).filter(Boolean),
    portabilityWalletSet,
    portabilityClusterIndependenceProof,
    rewardTokenSymbol,
    rewardEmissionPerBlock,
    rewardEmissionEndBlock,
    rewardVestingSchedule,
    rewardLockupSeconds,
    rewardTokenLiquidityDepthUsd,
    rewardTokenSlippageAtSize,
    rewardTokenHaircutSats,
    oracleSource,
    oracleStalenessSecondsMax,
    oracleManipulationCostUsd,
    capacityAtProposedSize,
    slippageSimAtSize,
    slippageSimAt2x,
    slippageSimAt5x,
    poolUtilizationNow,
    borrowRateCurveSnapshot,
    withdrawalQueueDepth,
    redemptionLatencySecondsP50,
    redemptionLatencySecondsP99,
  };
  const validation = validatePortableOpportunityPacket(packet);
  blockers.push(...validation.blockers);

  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    packet: blockers.length === 0 ? validation.value : null,
  };
}
