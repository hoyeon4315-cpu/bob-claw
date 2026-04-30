import { arrayBlocker, compactBlockers, enumBlocker, missingFieldBlockers, validationResult } from "./common.mjs";

const CLOSURE_STATUSES = Object.freeze([
  "closed",
  "open",
  "unknown",
  "broken_at_cex",
  "broken_at_mixer",
  "broken_at_unlabeled_hop",
]);

const REQUIRED_FIELDS = Object.freeze([
  "episodeId",
  "derivedFrom",
  "strategyCategory",
  "hypothesisAssumptions",
  "falsifiers",
  "referenceWalletPnlClaim",
  "selfReplayPnlSats",
  "pnlClosurePathProof",
  "pnlClosureStatus",
]);

function normalizeReferenceWalletPnlClaim(claim = null) {
  if (!claim || typeof claim !== "object") return claim;
  return {
    ...claim,
    verified: claim.verified === true || claim.verifiedBy === "self_replay",
  };
}

export function validateStrategyEpisode(input = {}) {
  const blockers = [
    ...missingFieldBlockers(input, REQUIRED_FIELDS),
    arrayBlocker(input, "derivedFrom"),
    arrayBlocker(input, "hypothesisAssumptions"),
    arrayBlocker(input, "falsifiers"),
    arrayBlocker(input, "pnlClosurePathProof"),
    enumBlocker(input, "pnlClosureStatus", CLOSURE_STATUSES),
  ];

  return validationResult({
    blockers: compactBlockers(blockers),
    value: {
      ...input,
      referenceWalletPnlClaim: normalizeReferenceWalletPnlClaim(input.referenceWalletPnlClaim),
    },
  });
}
