import assert from "node:assert/strict";
import test from "node:test";

import { evaluateExecutableCandidateGate } from "../src/strategy/radar/executable-candidate-gate.mjs";

const packet = Object.freeze({
  packetId: "packet_exec",
});

const calibratedPolicy = Object.freeze({
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
