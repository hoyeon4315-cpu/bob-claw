import { arrayBlocker, compactBlockers, enumBlocker, missingFieldBlockers, validationResult } from "./common.mjs";

const EXECUTION_PATHS = Object.freeze([
  "gateway_destination",
  "post_gateway_manual_bridge",
  "out_of_scope",
]);

const GATE_STATUSES = Object.freeze([
  "executable",
  "blocked",
  "review_only",
]);

const REQUIRED_FIELDS = Object.freeze([
  "candidateId",
  "packetId",
  "proposedSizeBtc",
  "committedCapBtc",
  "executionPath",
  "protocolAuditStatus",
  "protocolAuditFirms",
  "auditReportHash",
  "protocolAgeDays",
  "protocolDeployTxHash",
  "protocolTvlNow",
  "protocolTvlPeak",
  "protocolTvlDrawdown30d",
  "protocolExploitHistory",
  "reentrancyStaticAnalysisScore",
  "governanceTokenSupply",
  "governanceQuorum",
  "governanceTimelockSeconds",
  "governanceMultisigThreshold",
  "mevExposureScore",
  "privateRpcUsed",
  "bundleSubmissionVenue",
  "sanctionsFlag",
  "taxJurisdictionFlag",
  "bridgeRouteSanctionsCheck",
  "relayerJurisdiction",
  "custodianEntity",
  "gatewayQuoteId",
  "gatewayFeeSats",
  "gatewayLatencyObserved",
  "relayerLivenessProof",
  "lpEscrowAddress",
  "policyHashAtEvaluation",
  "killSwitchState",
  "capUtilizationAtEvaluationBps",
  "blockers",
  "gateStatus",
]);

export function validateExecutableCandidate(input = {}) {
  const blockers = [
    ...missingFieldBlockers(input, REQUIRED_FIELDS),
    arrayBlocker(input, "protocolAuditFirms"),
    arrayBlocker(input, "auditReportHash"),
    arrayBlocker(input, "protocolExploitHistory"),
    arrayBlocker(input, "blockers"),
    enumBlocker(input, "executionPath", EXECUTION_PATHS),
    enumBlocker(input, "gateStatus", GATE_STATUSES),
  ];

  return validationResult({
    blockers: compactBlockers(blockers),
    value: { ...input },
  });
}
