import { arrayBlocker, compactBlockers, missingFieldBlockers, validationResult } from "./common.mjs";

const REQUIRED_FIELDS = Object.freeze([
  "packetId",
  "episodeIds",
  "portabilityWalletSet",
  "portabilityClusterIndependenceProof",
  "rewardTokenSymbol",
  "rewardEmissionPerBlock",
  "rewardEmissionEndBlock",
  "rewardVestingSchedule",
  "rewardLockupSeconds",
  "rewardTokenLiquidityDepthUsd",
  "rewardTokenSlippageAtSize",
  "rewardTokenHaircutSats",
  "oracleSource",
  "oracleStalenessSecondsMax",
  "oracleManipulationCostUsd",
  "capacityAtProposedSize",
  "slippageSimAtSize",
  "slippageSimAt2x",
  "slippageSimAt5x",
  "poolUtilizationNow",
  "borrowRateCurveSnapshot",
  "withdrawalQueueDepth",
  "redemptionLatencySecondsP50",
  "redemptionLatencySecondsP99",
]);

export function validatePortableOpportunityPacket(input = {}) {
  const blockers = [
    ...missingFieldBlockers(input, REQUIRED_FIELDS),
    arrayBlocker(input, "episodeIds"),
    arrayBlocker(input, "portabilityWalletSet"),
  ];

  return validationResult({
    blockers: compactBlockers(blockers),
    value: { ...input },
  });
}
