import assert from "node:assert/strict";
import test from "node:test";

import { evaluateExecutableCandidateGate } from "../src/strategy/radar/executable-candidate-gate.mjs";

const packet = Object.freeze({
  packetId: "packet_exec",
});

const calibratedPolicy = Object.freeze({
  calibrationStatus: "calibrated_aggressive_v1",
  thresholds: Object.freeze({
    clusterConfidenceMin: 0.7,
    portableWalletSetMin: 2,
    protocolAgeDaysMin: 30,
    protocolTvlUsdMin: 1_000_000,
    slippageBpsMax: 100,
    mevExposureScoreMax: 0.5,
  }),
});

test("executable gate blocks while radar policy thresholds are unresolved", () => {
  const result = evaluateExecutableCandidateGate({
    policy: {
      calibrationStatus: "unresolved_operator_policy",
      thresholds: {
        clusterConfidenceMin: null,
        portableWalletSetMin: null,
        protocolAgeDaysMin: null,
        protocolTvlUsdMin: null,
        slippageBpsMax: null,
        mevExposureScoreMax: null,
      },
    },
    packet,
    candidate: {
      candidateId: "candidate_unresolved",
      executionPath: "gateway_destination",
      proposedSizeBtc: "0.0001",
      committedCapBtc: "0.0002",
      sanctionsFlag: "clean",
      bridgeRouteSanctionsCheck: "clean",
      killSwitchState: "running",
    },
  });

  assert.equal(result.gateStatus, "blocked");
  assert.ok(result.blockers.includes("radar_policy_thresholds_unresolved"));
});

test("executable gate blocks when thresholds are finite but calibration is not aggressive", () => {
  const result = evaluateExecutableCandidateGate({
    policy: {
      ...calibratedPolicy,
      calibrationStatus: "unresolved_operator_policy",
    },
    packet,
    candidate: {
      candidateId: "candidate_wrong_status",
      executionPath: "gateway_destination",
      proposedSizeBtc: "0.0001",
      committedCapBtc: "0.0002",
      sanctionsFlag: "clean",
      bridgeRouteSanctionsCheck: "clean",
      killSwitchState: "running",
    },
  });

  assert.equal(result.gateStatus, "blocked");
  assert.ok(result.blockers.includes("radar_policy_not_calibrated_aggressive"));
});

test("executable gate rejects non-Gateway execution paths", () => {
  const result = evaluateExecutableCandidateGate({
    policy: calibratedPolicy,
    packet,
    candidate: {
      candidateId: "candidate_manual_bridge",
      executionPath: "post_gateway_manual_bridge",
      proposedSizeBtc: "0.0001",
      committedCapBtc: "0.0002",
      sanctionsFlag: "clean",
      bridgeRouteSanctionsCheck: "clean",
      killSwitchState: "running",
    },
  });

  assert.equal(result.gateStatus, "blocked");
  assert.deepEqual(result.blockers, ["manual_bridge_execution_not_supported"]);
});

test("executable gate allows Base-native EVM execution under aggressive calibrated policy", () => {
  const result = evaluateExecutableCandidateGate({
    policy: calibratedPolicy,
    packet,
    candidate: {
      candidateId: "candidate_base_native",
      executionPath: "base_native_evm",
      proposedSizeBtc: "0.0001",
      committedCapBtc: "0.0002",
      protocolAuditStatus: "audited_by_known",
      sanctionsFlag: "clean",
      bridgeRouteSanctionsCheck: "clean",
      killSwitchState: "running",
      slippageSimAtSize: 50,
      mevExposureScore: 0.2,
    },
  });

  assert.equal(result.gateStatus, "executable");
  assert.deepEqual(result.blockers, []);
});

test("executable gate can produce executable status under explicit calibrated policy", () => {
  const result = evaluateExecutableCandidateGate({
    policy: calibratedPolicy,
    packet,
    candidate: {
      candidateId: "candidate_ready",
      executionPath: "gateway_destination",
      proposedSizeBtc: "0.0001",
      committedCapBtc: "0.0002",
      protocolAuditStatus: "audited_by_known",
      sanctionsFlag: "clean",
      bridgeRouteSanctionsCheck: "clean",
      killSwitchState: "running",
      slippageSimAtSize: 50,
      mevExposureScore: 0.2,
    },
  });

  assert.equal(result.gateStatus, "executable");
  assert.deepEqual(result.blockers, []);
});
