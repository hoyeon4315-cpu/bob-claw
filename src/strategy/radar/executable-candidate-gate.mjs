import { RADAR_POLICY } from "../../config/radar-policy.mjs";
import { validateExecutableCandidate } from "./schema/index.mjs";

const REQUIRED_THRESHOLD_KEYS = Object.freeze([
  "clusterConfidenceMin",
  "portableWalletSetMin",
  "protocolAgeDaysMin",
  "protocolTvlUsdMin",
  "slippageBpsMax",
  "mevExposureScoreMax",
]);

function thresholdsResolved(policy = RADAR_POLICY) {
  return REQUIRED_THRESHOLD_KEYS.every((key) => Number.isFinite(policy?.thresholds?.[key]));
}

function compareBtc(proposed, cap) {
  const proposedNumber = Number(proposed);
  const capNumber = Number(cap);
  if (!Number.isFinite(proposedNumber) || !Number.isFinite(capNumber)) return null;
  return proposedNumber <= capNumber;
}

function candidateDefaults(packet = {}, candidate = {}) {
  return {
    candidateId: candidate.candidateId,
    packetId: packet.packetId || candidate.packetId || null,
    proposedSizeBtc: candidate.proposedSizeBtc ?? null,
    committedCapBtc: candidate.committedCapBtc ?? null,
    executionPath: candidate.executionPath ?? null,
    protocolAuditStatus: candidate.protocolAuditStatus ?? "unknown",
    protocolAuditFirms: candidate.protocolAuditFirms || [],
    auditReportHash: candidate.auditReportHash || [],
    protocolAgeDays: candidate.protocolAgeDays ?? null,
    protocolDeployTxHash: candidate.protocolDeployTxHash ?? null,
    protocolTvlNow: candidate.protocolTvlNow ?? null,
    protocolTvlPeak: candidate.protocolTvlPeak ?? null,
    protocolTvlDrawdown30d: candidate.protocolTvlDrawdown30d ?? null,
    protocolExploitHistory: candidate.protocolExploitHistory || [],
    reentrancyStaticAnalysisScore: candidate.reentrancyStaticAnalysisScore ?? null,
    governanceTokenSupply: candidate.governanceTokenSupply ?? null,
    governanceQuorum: candidate.governanceQuorum ?? null,
    governanceTimelockSeconds: candidate.governanceTimelockSeconds ?? null,
    governanceMultisigThreshold: candidate.governanceMultisigThreshold ?? null,
    mevExposureScore: candidate.mevExposureScore ?? null,
    privateRpcUsed: candidate.privateRpcUsed ?? false,
    bundleSubmissionVenue: candidate.bundleSubmissionVenue ?? null,
    sanctionsFlag: candidate.sanctionsFlag ?? "unknown",
    taxJurisdictionFlag: candidate.taxJurisdictionFlag ?? "unknown",
    bridgeRouteSanctionsCheck: candidate.bridgeRouteSanctionsCheck ?? "unknown",
    relayerJurisdiction: candidate.relayerJurisdiction ?? null,
    custodianEntity: candidate.custodianEntity ?? null,
    gatewayQuoteId: candidate.gatewayQuoteId ?? null,
    gatewayFeeSats: candidate.gatewayFeeSats ?? null,
    gatewayLatencyObserved: candidate.gatewayLatencyObserved ?? null,
    relayerLivenessProof: candidate.relayerLivenessProof ?? null,
    lpEscrowAddress: candidate.lpEscrowAddress ?? null,
    policyHashAtEvaluation: candidate.policyHashAtEvaluation ?? null,
    killSwitchState: candidate.killSwitchState ?? "unknown",
    capUtilizationAtEvaluationBps: candidate.capUtilizationAtEvaluationBps ?? null,
    blockers: [],
    gateStatus: "blocked",
  };
}

export function evaluateExecutableCandidateGate({
  packet = {},
  candidate = {},
  policy = RADAR_POLICY,
} = {}) {
  const blockers = [];
  if (!thresholdsResolved(policy)) blockers.push("radar_policy_thresholds_unresolved");
  if (candidate.executionPath !== "gateway_destination") blockers.push("manual_bridge_execution_not_supported");
  if (candidate.sanctionsFlag !== "clean") blockers.push("sanctions_check_not_clean");
  if (candidate.bridgeRouteSanctionsCheck !== "clean") blockers.push("bridge_route_sanctions_check_not_clean");
  if (candidate.killSwitchState !== "running") blockers.push("kill_switch_not_running");
  const capCheck = compareBtc(candidate.proposedSizeBtc, candidate.committedCapBtc);
  if (capCheck !== true) blockers.push("committed_cap_btc_insufficient_or_unknown");
  if (Number.isFinite(candidate.slippageSimAtSize) && Number.isFinite(policy?.thresholds?.slippageBpsMax) &&
    candidate.slippageSimAtSize > policy.thresholds.slippageBpsMax) {
    blockers.push("radar_slippage_above_policy");
  }
  if (Number.isFinite(candidate.mevExposureScore) && Number.isFinite(policy?.thresholds?.mevExposureScoreMax) &&
    candidate.mevExposureScore > policy.thresholds.mevExposureScoreMax) {
    blockers.push("radar_mev_exposure_above_policy");
  }

  const normalized = {
    ...candidateDefaults(packet, candidate),
    blockers: [...new Set(blockers)],
    gateStatus: blockers.length === 0 ? "executable" : "blocked",
  };
  const validation = validateExecutableCandidate(normalized);
  const finalBlockers = [...new Set([...normalized.blockers, ...validation.blockers])];
  return {
    ok: finalBlockers.length === 0,
    gateStatus: finalBlockers.length === 0 ? "executable" : "blocked",
    blockers: finalBlockers,
    candidate: finalBlockers.length === 0 ? validation.value : { ...normalized, blockers: finalBlockers },
  };
}
