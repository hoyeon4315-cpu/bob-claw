import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_STATUSES,
  FUTURE_BACKLOG_LANES,
  buildLaneIntentCandidateReport,
} from "../src/strategy/remediation-lane-intent-candidate.mjs";

function readyHandlerReport(overrides = {}) {
  const handlerResult = {
    lane: "capital_refill",
    family: "capital_family",
    sourceQueueItem: {
      lane: "capital_refill",
      family: "capital_family",
      governingFieldPath: "familyCoverage[family=capital_family].firstBlockingReason",
      canDryRun: true,
      safetyBlockers: [],
    },
    status: "READY_FOR_DRY_RUN",
    canDryRun: true,
    dryRunIntent: {
      intentType: "capital_refill_dry_run",
      selectedMethod: "cross_chain_bridge_or_swap",
      source: { chain: "bitcoin", asset: "BTC", token: "0x0", estimatedUsd: 91.1 },
      destination: {
        chain: "base",
        asset: "wBTC.OFT",
        token: "0xdest",
        targetAmount: "118732",
        targetAmountDecimal: 0.00118732,
        estimatedAssetValueUsd: 91.12,
      },
      expectedNetUsd: 0.91,
      costs: {
        expectedExecutionRefillCostUsd: 0.88,
        expectedReserveReplenishmentCostUsd: 0,
        bridgeQuoteCostUsd: 0.88,
        bridgeQuoteCostCeilingUsd: 1.5,
        routeKnownCostUsd: 0.38,
      },
      blocker: null,
      governingAgreement: {
        queueLane: "capital_refill",
        plannerDecision: "REFILL_REQUIRED",
        jobDecision: "REFILL_REQUIRED",
        selectionStatus: "ready",
        agrees: true,
      },
    },
    missingInputs: [],
    missingProducer: null,
    safetyBlockers: [],
    canLive: false,
    reportOnly: true,
  };
  return {
    selectedPilotLane: "capital_refill",
    status: "LANE_HANDLER_PILOT_READY",
    handlerResults: [handlerResult],
    handlerBacklog: [],
    reportOnly: true,
    canLive: false,
    runtimeAuthority: "none",
    ...overrides,
  };
}

test("statuses enumerate report-only lifecycle outcomes", () => {
  assert.deepEqual(
    [...CANDIDATE_STATUSES],
    ["READY_FOR_INTENT_CANDIDATE", "BACKLOG_MISSING_EVIDENCE", "UNRESOLVED_GOVERNING_SYNC_MISMATCH"],
  );
  assert.deepEqual(
    [...FUTURE_BACKLOG_LANES],
    ["receipt_reconciliation", "claim_harvest", "exit_redeem", "producer_backlog", "policy_review", "live_eligibility"],
  );
});

test("complete evidence and aligned governing surfaces produce a report-only intent candidate", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: readyHandlerReport(),
    readinessReport: {
      liveAutomation: { refillBlockers: [] },
    },
  });
  assert.equal(report.status, "READY_FOR_INTENT_CANDIDATE");
  assert.equal(report.pilotLane, "capital_refill");
  assert.equal(report.laneIntentCandidates.length, 1);
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.lane, "capital_refill");
  assert.equal(candidate.status, "READY_FOR_INTENT_CANDIDATE");
  assert.equal(candidate.canDryRun, true);
  assert.equal(candidate.canIntent, true);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.equal(candidate.allowedToExecuteLive, false);
  assert.equal(candidate.selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(candidate.executionMethod, "cross_chain_bridge_or_swap");
  assert.equal(candidate.sourceChain, "bitcoin");
  assert.equal(candidate.sourceAsset, "BTC");
  assert.equal(candidate.destinationChain, "base");
  assert.equal(candidate.destinationAsset, "wBTC.OFT");
  assert.equal(candidate.expectedNetUsd, 0.91);
  assert.equal(candidate.costs.expectedExecutionRefillCostUsd, 0.88);
  assert.equal(candidate.governingAgreement.agrees, true);
  assert.deepEqual(candidate.missingEvidence, []);
  assert.equal(report.laneIntentCandidateSummary.intentCandidateCount, 1);
  assert.equal(report.laneIntentCandidateSummary.canLiveCount, 0);
  assert.equal(report.laneIntentCandidateSummary.blockedCount, 0);
  assert.equal(report.safety.canLive, false);
  assert.equal(report.safety.signerCalled, false);
  assert.equal(report.safety.liveQueueEnqueued, false);
  assert.equal(report.safety.autoExecuteChanged, false);
});

test("readiness blocker on the same destination forces UNRESOLVED_GOVERNING_SYNC_MISMATCH", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: readyHandlerReport(),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "base",
            asset: "wBTC.OFT",
            reason: "routing_exhausted",
            category: "routing_exhausted",
            selectedMethod: "cross_chain_bridge_or_swap",
          },
        ],
      },
    },
  });
  assert.equal(report.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.governingAgreement.agrees, false);
  assert.equal(candidate.governingAgreement.readinessBlockerCount, 1);
  assert.equal(candidate.governingAgreement.handlerAgrees, true);
  assert.equal(candidate.nextAutomationStep, "reconcile_refill_planner_and_readiness_governing_fields");
});

test("missing required fields drop the candidate into BACKLOG_MISSING_EVIDENCE", () => {
  const handlerReport = readyHandlerReport();
  handlerReport.handlerResults[0].dryRunIntent.expectedNetUsd = null;
  handlerReport.handlerResults[0].dryRunIntent.source.chain = null;
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  assert.equal(report.status, "BACKLOG_MISSING_EVIDENCE");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "BACKLOG_MISSING_EVIDENCE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.ok(candidate.missingEvidence.includes("sourceChain"));
  assert.ok(candidate.missingEvidence.includes("expectedNetUsd"));
  assert.equal(candidate.nextAutomationStep, "supply_missing_refill_intent_evidence_fields");
});

test("BLOCKED_MISSING_INPUT handler result keeps lane in BACKLOG_MISSING_EVIDENCE and never canIntent", () => {
  const handlerReport = readyHandlerReport();
  handlerReport.handlerResults[0].status = "BLOCKED_MISSING_INPUT";
  handlerReport.handlerResults[0].canDryRun = false;
  handlerReport.handlerResults[0].missingInputs = ["matching_refill_planner_job"];
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  assert.equal(report.status, "BACKLOG_MISSING_EVIDENCE");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.canDryRun, false);
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.ok(candidate.missingEvidence.includes("matching_refill_planner_job"));
});

test("canDryRun without governing alignment does not imply canIntent", () => {
  const handlerReport = readyHandlerReport();
  handlerReport.handlerResults[0].dryRunIntent.governingAgreement.agrees = false;
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.canDryRun, true);
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
});

test("canIntent true never propagates to canLive true", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: readyHandlerReport(),
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.canIntent, true);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.allowedToExecuteLive, false);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.equal(report.safety.canLive, false);
  assert.equal(report.safety.allowedToExecuteLive, false);
  assert.equal(report.safety.liveQueueEnqueued, false);
});

test("receipt/claim/exit/producer/policy/live remain futureHandlerBacklog with required evidence and next step", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: readyHandlerReport({
      handlerBacklog: [
        { lane: "receipt_reconciliation", family: "merkl", status: "BLOCKED_MISSING_INPUT" },
        { lane: "claim_harvest", family: "merkl", status: "BLOCKED_MISSING_INPUT" },
        { lane: "exit_redeem", family: "stable", status: "BLOCKED_MISSING_INPUT" },
        { lane: "producer_backlog", family: "bnb_radar", status: "BLOCKED_MISSING_PRODUCER" },
        { lane: "policy_review", family: "pendle_yt", status: "BLOCKED_POLICY_REVIEW" },
      ],
    }),
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  assert.equal(report.futureHandlerBacklog.length, FUTURE_BACKLOG_LANES.length);
  const receipt = report.futureHandlerBacklog.find((entry) => entry.lane === "receipt_reconciliation");
  assert.equal(receipt.status, "FUTURE_HANDLER_BACKLOG");
  assert.equal(receipt.canIntent, false);
  assert.equal(receipt.canLive, false);
  assert.ok(receipt.requiredEvidence.includes("receipt_target_identity_list"));
  assert.ok(receipt.requiredEvidence.includes("non_mutating_dry_run_command"));
  assert.equal(receipt.handlerBacklogCount, 1);
  assert.ok(receipt.queueFamilies.includes("merkl"));
  const live = report.futureHandlerBacklog.find((entry) => entry.lane === "live_eligibility");
  assert.equal(live.status, "FUTURE_HANDLER_BACKLOG");
  assert.equal(live.canIntent, false);
  assert.equal(live.canLive, false);
  assert.ok(live.requiredEvidence.includes("policy_proof"));
  assert.ok(live.requiredEvidence.includes("kill_switch_proof"));
});

test("no capital_refill pilot lane produces no candidate but keeps backlog populated", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: {
      selectedPilotLane: null,
      handlerResults: [],
      handlerBacklog: [],
    },
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  assert.equal(report.status, "NO_PILOT_LANE_FOR_INTENT_CANDIDATE");
  assert.equal(report.laneIntentCandidates.length, 0);
  assert.equal(report.laneIntentCandidateSummary.intentCandidateCount, 0);
  assert.equal(report.futureHandlerBacklog.length, FUTURE_BACKLOG_LANES.length);
});

test("no family-specific or protocol-specific special casing is required", () => {
  const handlerReport = readyHandlerReport();
  handlerReport.handlerResults[0].family = "any_other_family";
  handlerReport.handlerResults[0].sourceQueueItem.family = "any_other_family";
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.family, "any_other_family");
  assert.equal(candidate.status, "READY_FOR_INTENT_CANDIDATE");
  assert.equal(candidate.canIntent, true);
});
