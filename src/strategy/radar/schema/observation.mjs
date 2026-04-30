import { arrayBlocker, compactBlockers, enumBlocker, missingFieldBlockers, validationResult } from "./common.mjs";

const EXECUTION_PATHS = Object.freeze([
  "gateway_destination",
  "post_gateway_manual_bridge",
  "out_of_scope",
]);

const DISCOVERY_CLAIM_TYPES = Object.freeze([
  "behavior_observed",
  "label_claimed",
  "pnl_claimed_unverified",
  "pnl_verified_by_self_replay",
]);

const REQUIRED_FIELDS = Object.freeze([
  "obsId",
  "observedAt",
  "sourceList",
  "sourceFreshness",
  "walletClusterId",
  "clusterMethod",
  "clusterConfidence",
  "chain",
  "protocolId",
  "poolOrMarket",
  "sourceTxs",
  "rawEventPayloadHash",
  "executionPath",
  "discoveryClaimType",
]);

export function validateOpportunityObservation(input = {}) {
  const blockers = [
    ...missingFieldBlockers(input, REQUIRED_FIELDS),
    arrayBlocker(input, "sourceList"),
    arrayBlocker(input, "sourceTxs"),
    enumBlocker(input, "executionPath", EXECUTION_PATHS),
    enumBlocker(input, "discoveryClaimType", DISCOVERY_CLAIM_TYPES),
  ];

  return validationResult({
    blockers: compactBlockers(blockers),
    value: { ...input },
  });
}
