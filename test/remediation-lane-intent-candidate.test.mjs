import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_STATUSES,
  FUTURE_BACKLOG_LANES,
  LIFECYCLE_PRODUCERS,
  READINESS_BLOCKER_CLASSES,
  buildLaneIntentCandidateReport,
} from "../src/strategy/remediation-lane-intent-candidate.mjs";

function readyHandlerReport(overrides = {}, intentOverrides = {}) {
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
      selectedMethod: intentOverrides.selectedMethod || "cross_chain_bridge_or_swap",
      plannerCandidateMethods: intentOverrides.plannerCandidateMethods || [
        "cross_chain_bridge_or_swap",
        "cross_chain_swap_via_btc_intermediate",
      ],
      source: intentOverrides.source || { chain: "bitcoin", asset: "BTC", token: "0x0", estimatedUsd: 91.1 },
      destination: intentOverrides.destination || {
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
    [
      "READY_FOR_INTENT_CANDIDATE",
      "NO_LIVE_ROUTE",
      "BACKLOG_MISSING_EVIDENCE",
      "TYPED_MISSING_EVIDENCE",
      "UNRESOLVED_GOVERNING_SYNC_MISMATCH",
      "UNRESOLVED_STALE_READINESS_SNAPSHOT",
    ],
  );
  assert.deepEqual(
    [...FUTURE_BACKLOG_LANES],
    ["receipt_reconciliation", "claim_harvest", "exit_redeem", "producer_backlog", "policy_review", "live_eligibility"],
  );
  assert.deepEqual(
    [...READINESS_BLOCKER_CLASSES],
    ["method_collision", "destination_collision", "method_unspecified_collision", "stale_snapshot_method"],
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
  assert.equal(candidate.stableSourceRef, "familyCoverage[family=capital_family].firstBlockingReason");
  assert.equal(candidate.evidenceComplete, true);
  assert.equal(candidate.governingFieldPath, "familyCoverage[family=capital_family].firstBlockingReason");
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
  handlerReport.handlerResults[0].dryRunIntent.selectedMethod = null;
  handlerReport.handlerResults[0].dryRunIntent.expectedNetUsd = null;
  handlerReport.handlerResults[0].dryRunIntent.source.chain = null;
  handlerReport.handlerResults[0].dryRunIntent.source.asset = null;
  handlerReport.handlerResults[0].dryRunIntent.destination.asset = null;
  handlerReport.handlerResults[0].dryRunIntent.costs.expectedExecutionRefillCostUsd = null;
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  assert.equal(report.status, "BACKLOG_MISSING_EVIDENCE");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "BACKLOG_MISSING_EVIDENCE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.ok(candidate.missingEvidence.includes("selectedMethod"));
  assert.ok(candidate.missingEvidence.includes("sourceChain"));
  assert.ok(candidate.missingEvidence.includes("sourceAsset"));
  assert.ok(candidate.missingEvidence.includes("destinationAsset"));
  assert.ok(candidate.missingEvidence.includes("expectedNetUsd"));
  assert.ok(candidate.missingEvidence.includes("expectedExecutionRefillCostUsd"));
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
  assert.ok(receipt.requiredEvidence.includes("receipt_target_identity"));
  assert.ok(receipt.requiredEvidence.includes("tx_hash_or_stable_broadcast_id"));
  assert.ok(receipt.requiredEvidence.includes("dry_run_reconciliation_path_or_exact_missing_producer"));
  assert.equal(receipt.handlerBacklogCount, 1);
  assert.ok(receipt.queueFamilies.includes("merkl"));
  const claim = report.laneBacklog.find((entry) => entry.lane === "claim_harvest");
  assert.ok(claim.requiredEvidence.includes("chain_token_distributor_or_exact_missing_field"));
  assert.ok(claim.requiredEvidence.includes("claim_readiness"));
  const exit = report.laneBacklog.find((entry) => entry.lane === "exit_redeem");
  assert.ok(exit.requiredEvidence.includes("action_specific_exit_or_redeem_expected_net_usd"));
  assert.ok(exit.requiredEvidence.includes("executor_binding_or_exact_missing_binding"));
  const live = report.futureHandlerBacklog.find((entry) => entry.lane === "live_eligibility");
  assert.equal(live.status, "FUTURE_HANDLER_BACKLOG");
  assert.equal(live.canIntent, false);
  assert.equal(live.canLive, false);
  assert.ok(live.requiredEvidence.includes("policy_proof"));
  assert.ok(live.requiredEvidence.includes("kill_switch_proof"));
  assert.equal(report.laneHandlerCoverage.reportOnly, true);
  assert.equal(report.laneSafetyProof.runtimeAuthority, "none");
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

test("readiness blocker whose method left planner candidate set marks UNRESOLVED_STALE_READINESS_SNAPSHOT", () => {
  const handlerReport = readyHandlerReport(
    {},
    {
      plannerCandidateMethods: ["method_alpha", "method_beta"],
      selectedMethod: "method_alpha",
      destination: {
        chain: "synthchain",
        asset: "SYNTH",
        token: "0xsynth",
        targetAmount: "1000",
        targetAmountDecimal: 0.001,
        estimatedAssetValueUsd: 50,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synthchain",
            asset: "SYNTH",
            reason: "routing_exhausted",
            category: "routing_exhausted",
            selectedMethod: "method_obsolete_gamma",
          },
          {
            chain: "synthchain",
            asset: "SYNTH",
            reason: "expected_net_below_receipt_cost_p90_floor",
            category: "execution_unresolved",
            selectedMethod: "method_obsolete_delta",
          },
        ],
      },
    },
  });
  assert.equal(report.status, "UNRESOLVED_STALE_READINESS_SNAPSHOT");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "UNRESOLVED_STALE_READINESS_SNAPSHOT");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.governingAgreement.onlyStaleSnapshot, true);
  assert.equal(candidate.governingAgreement.staleSnapshotCount, 2);
  assert.equal(candidate.governingAgreement.liveCollisionCount, 0);
  assert.equal(candidate.nextAutomationStep, "rerun_autopilot_to_refresh_governing_refill_blockers");
  for (const blocker of candidate.readinessBlockers) {
    assert.equal(blocker.mismatchClass, "stale_snapshot_method");
  }
  assert.equal(report.laneIntentCandidateSummary.staleSnapshotCount, 1);
  assert.equal(report.laneIntentCandidateSummary.governingMismatchCount, 0);
});

test("mixed stale and current-method blockers keep UNRESOLVED_GOVERNING_SYNC_MISMATCH", () => {
  const handlerReport = readyHandlerReport(
    {},
    {
      plannerCandidateMethods: ["method_alpha", "method_beta"],
      selectedMethod: "method_alpha",
      destination: {
        chain: "synthchain",
        asset: "SYNTH",
        token: "0xsynth",
        targetAmount: "1000",
        targetAmountDecimal: 0.001,
        estimatedAssetValueUsd: 50,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synthchain",
            asset: "SYNTH",
            reason: "routing_exhausted",
            selectedMethod: "method_obsolete_gamma",
          },
          {
            chain: "synthchain",
            asset: "SYNTH",
            reason: "routing_exhausted",
            selectedMethod: "method_alpha",
          },
        ],
      },
    },
  });
  assert.equal(report.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.governingAgreement.staleSnapshotCount, 1);
  assert.equal(candidate.governingAgreement.liveCollisionCount, 1);
  const classes = candidate.readinessBlockers.map((entry) => entry.mismatchClass);
  assert.deepEqual(classes.sort(), ["method_collision", "stale_snapshot_method"]);
  assert.equal(candidate.nextAutomationStep, "reconcile_refill_planner_and_readiness_governing_fields");
});

test("readiness blocker without selectedMethod is destination_collision and blocks intent", () => {
  const handlerReport = readyHandlerReport(
    {},
    {
      plannerCandidateMethods: ["method_alpha"],
      selectedMethod: "method_alpha",
      destination: {
        chain: "altchain",
        asset: "ALT",
        token: "0xalt",
        targetAmount: "1",
        targetAmountDecimal: 1,
        estimatedAssetValueUsd: 5,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [{ chain: "altchain", asset: "ALT", reason: "routing_exhausted", selectedMethod: null }],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
  assert.equal(candidate.readinessBlockers[0].mismatchClass, "destination_collision");
});

test("absent plannerCandidateMethods falls back to method_unspecified_collision", () => {
  const handlerReport = readyHandlerReport(
    {},
    {
      plannerCandidateMethods: [],
      selectedMethod: "method_alpha",
      destination: {
        chain: "altchain",
        asset: "ALT",
        token: "0xalt",
        targetAmount: "1",
        targetAmountDecimal: 1,
        estimatedAssetValueUsd: 5,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          { chain: "altchain", asset: "ALT", reason: "routing_exhausted", selectedMethod: "method_anything" },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.readinessBlockers[0].mismatchClass, "method_unspecified_collision");
  assert.equal(candidate.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
});

test("lifecycle exposes producer paths on candidates, backlog, and report root", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: readyHandlerReport(),
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  assert.equal(report.producers, LIFECYCLE_PRODUCERS);
  assert.equal(report.producers.refillPlanner.cli, "node src/cli/plan-capital-manager-refill-jobs.mjs --json");
  assert.equal(report.producers.readinessRefillBlockers.cli, "node src/cli/check-full-automation-readiness.mjs --json");
  assert.equal(report.producers.readinessRefillBlockers.upstreamModule, "src/status/all-chain-autopilot-slice.mjs");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.producers, LIFECYCLE_PRODUCERS);
  const receipt = report.futureHandlerBacklog.find((entry) => entry.lane === "receipt_reconciliation");
  assert.ok(receipt.owningProducer);
  assert.ok(receipt.owningProducer.cli.includes("report:receipt-ledger"));
  const live = report.futureHandlerBacklog.find((entry) => entry.lane === "live_eligibility");
  assert.ok(live.owningProducer);
  assert.ok(live.owningProducer.module.includes("policy"));
});

test("precise NO_LIVE_ROUTE requires current-method blocker and direct cost evidence", () => {
  const handlerReport = readyHandlerReport();
  handlerReport.handlerResults[0].dryRunIntent.blocker = "expected_net_below_receipt_cost_p90_floor";
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "base",
            asset: "wBTC.OFT",
            reason: "expected_net_below_receipt_cost_p90_floor",
            selectedMethod: "cross_chain_bridge_or_swap",
            stalePlannerMethod: false,
            expectedNetUsd: -0.1,
            requiredNetUsd: 0.5,
            p90CostUsd: 0.6,
          },
        ],
      },
    },
  });
  assert.equal(report.status, "NO_LIVE_ROUTE");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.evidenceComplete, true);
  assert.equal(candidate.noLiveRouteEvidence.method, "cross_chain_bridge_or_swap");
  assert.equal(candidate.noLiveRouteEvidence.costEvidence[0].expectedNetUsd, -0.1);
  assert.equal(candidate.noLiveRouteEvidence.costEvidence[0].requiredNetUsd, 0.5);
  assert.equal(candidate.noLiveRouteEvidence.costEvidence[0].p90CostUsd, 0.6);
});

test("NO_LIVE_ROUTE requires planner and readiness blocker reason agreement", () => {
  const handlerReport = readyHandlerReport();
  handlerReport.handlerResults[0].dryRunIntent.blocker = "expected_net_below_receipt_cost_p90_floor";
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "base",
            asset: "wBTC.OFT",
            reason: "routing_exhausted",
            selectedMethod: "cross_chain_bridge_or_swap",
            stalePlannerMethod: false,
            expectedNetUsd: -0.1,
            requiredNetUsd: 0.5,
            p90CostUsd: 0.6,
          },
        ],
      },
    },
  });
  assert.equal(report.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.noLiveRouteEvidence, null);
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
});

test("producer backlog and waitlist expose exact common lifecycle fields", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: readyHandlerReport({
      handlerBacklog: [
        {
          lane: "producer_backlog",
          family: "arbitrary_family",
          status: "BLOCKED_MISSING_PRODUCER",
          missingProducer: "build_arbitrary_receipt_producer",
          governingFieldPath: "familyActionTable[family=arbitrary_family].missingProducer",
        },
        {
          lane: "waitlist",
          family: "wait_family",
          status: "WAITLIST",
          reason: "negative_ev",
          governingFieldPath: "familyActionTable[family=wait_family].reason",
        },
      ],
    }),
    readinessReport: { liveAutomation: { refillBlockers: [] } },
  });
  const producer = report.laneBacklog.find((entry) => entry.family === "arbitrary_family");
  assert.equal(producer.missingProducer, "build_arbitrary_receipt_producer");
  assert.equal(producer.governingFieldPath, "familyActionTable[family=arbitrary_family].missingProducer");
  assert.equal(producer.canLive, false);
  assert.equal(producer.reportOnly, true);
  assert.ok(producer.evidenceContract.includes("owner_or_best_owner_guess"));
  const wait = report.laneWaitlist.find((entry) => entry.family === "wait_family");
  assert.equal(wait.reason, "negative_ev");
  assert.equal(wait.recheckCondition, "negative_ev");
  assert.equal(wait.governingFieldPath, "familyActionTable[family=wait_family].reason");
  assert.ok(wait.validWaitReasons.includes("negative_ev"));
});

test("classification works across arbitrary chain/asset/method strings (no hardcoding)", () => {
  const cases = [
    { chain: "zzz", asset: "QQQ", planner: ["m1", "m2"], blockerMethod: "m1", expected: "method_collision" },
    { chain: "alpha", asset: "BETA", planner: ["m1", "m2"], blockerMethod: "m_old", expected: "stale_snapshot_method" },
    { chain: "x", asset: "Y", planner: ["only_one"], blockerMethod: "only_one", expected: "method_collision" },
    { chain: "n", asset: "N", planner: ["fresh"], blockerMethod: "obsolete", expected: "stale_snapshot_method" },
  ];
  for (const fixture of cases) {
    const handlerReport = readyHandlerReport(
      {},
      {
        plannerCandidateMethods: fixture.planner,
        selectedMethod: fixture.planner[0],
        destination: {
          chain: fixture.chain,
          asset: fixture.asset,
          token: "0x0",
          targetAmount: "1",
          targetAmountDecimal: 1,
          estimatedAssetValueUsd: 1,
        },
      },
    );
    const report = buildLaneIntentCandidateReport({
      laneHandlerReport: handlerReport,
      readinessReport: {
        liveAutomation: {
          refillBlockers: [
            {
              chain: fixture.chain,
              asset: fixture.asset,
              reason: "routing_exhausted",
              selectedMethod: fixture.blockerMethod,
            },
          ],
        },
      },
    });
    const candidate = report.laneIntentCandidates[0];
    assert.equal(
      candidate.readinessBlockers[0].mismatchClass,
      fixture.expected,
      `expected ${fixture.expected} for ${JSON.stringify(fixture)}`,
    );
  }
});

test("normalized tuple match with route-absence taxonomy emits TYPED_MISSING_EVIDENCE", () => {
  // planner has fresh ready job (blocker:null); readiness blocker matches the
  // full normalized tuple (chain + asset + sourceChain + sourceAsset +
  // selectedMethod) AND carries a route-absence taxonomy whose cost-floor is
  // structurally unavailable. Synthetic chain/asset/method strings prove no
  // target literal is required.
  const handlerReport = readyHandlerReport(
    {},
    {
      selectedMethod: "synthetic_cross_chain_method_a",
      plannerCandidateMethods: ["synthetic_cross_chain_method_a", "synthetic_cross_chain_method_b"],
      source: { chain: "syntheticSrcChain", asset: "SYN_SRC_ASSET", token: "0xsrc", estimatedUsd: 50 },
      destination: {
        chain: "syntheticDstChain",
        asset: "SYN_DST_ASSET",
        token: "0xdst",
        targetAmount: "1",
        targetAmountDecimal: 1,
        estimatedAssetValueUsd: 1,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "syntheticDstChain",
            asset: "SYN_DST_ASSET",
            sourceChain: "syntheticSrcChain",
            sourceAsset: "SYN_SRC_ASSET",
            reason: "routing_exhausted",
            category: "routing_exhausted",
            selectedMethod: "synthetic_cross_chain_method_a",
            stalePlannerMethod: false,
            taxonomy: "route_specific_failure_lock",
          },
        ],
      },
    },
  });
  assert.equal(report.status, "TYPED_MISSING_EVIDENCE");
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "TYPED_MISSING_EVIDENCE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.ok(
    candidate.typedMissingEvidence.includes(
      "planner_blocker_absent_for_normalized_tuple_with_active_readiness_blocker",
    ),
  );
  assert.ok(candidate.typedMissingEvidence.includes("readiness_cost_floor_unavailable_for_route_absence_taxonomy"));
  assert.equal(candidate.typedMissingEvidenceDetail.method, "synthetic_cross_chain_method_a");
  assert.equal(candidate.typedMissingEvidenceDetail.resource.sourceChain, "syntheticSrcChain");
  assert.equal(candidate.typedMissingEvidenceDetail.resource.sourceAsset, "SYN_SRC_ASSET");
  assert.equal(report.laneIntentCandidateSummary.typedMissingEvidenceCount, 1);
  assert.equal(candidate.nextAutomationStep, "supply_typed_missing_evidence_fields_for_governing_alignment");
});

test("EV-style current-method blocker without cost-floor numbers emits TYPED_MISSING_EVIDENCE", () => {
  // Same shape but blocker reflects an EV-rejected category. Cost-floor numeric
  // fields are absent from the producer projection so the lifecycle requests
  // them explicitly instead of collapsing into UNRESOLVED. Synthetic strings.
  const handlerReport = readyHandlerReport(
    {},
    {
      selectedMethod: "synthetic_swap_via_intermediate",
      plannerCandidateMethods: ["synthetic_swap_via_intermediate"],
      source: { chain: "synthSrc", asset: "SYNX", token: "0xsx", estimatedUsd: 25 },
      destination: {
        chain: "synthDst",
        asset: "SYNY",
        token: "0xdy",
        targetAmount: "1",
        targetAmountDecimal: 1,
        estimatedAssetValueUsd: 1,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synthDst",
            asset: "SYNY",
            sourceChain: "synthSrc",
            sourceAsset: "SYNX",
            reason: "expected_net_below_receipt_cost_p90_floor",
            category: "execution_unresolved",
            selectedMethod: "synthetic_swap_via_intermediate",
            stalePlannerMethod: false,
            taxonomy: "real_negative_ev",
            // Cost-floor numeric fields intentionally absent — producer
            // projection has not propagated them yet.
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "TYPED_MISSING_EVIDENCE");
  assert.ok(
    candidate.typedMissingEvidence.includes("readiness_cost_floor_numeric_fields_missing_from_producer_projection"),
  );
});

test("source-tuple mismatch falls back to UNRESOLVED_GOVERNING_SYNC_MISMATCH", () => {
  // Planner source tuple does not match readiness blocker source tuple — the
  // typed-missing-evidence path requires structural tuple agreement, so the
  // verdict stays UNRESOLVED rather than over-aggregating.
  const handlerReport = readyHandlerReport(
    {},
    {
      selectedMethod: "synthetic_method_alpha",
      plannerCandidateMethods: ["synthetic_method_alpha"],
      source: { chain: "srcAlpha", asset: "ALPHA", token: "0xa", estimatedUsd: 30 },
      destination: {
        chain: "dstAlpha",
        asset: "DALPHA",
        token: "0xda",
        targetAmount: "1",
        targetAmountDecimal: 1,
        estimatedAssetValueUsd: 1,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "dstAlpha",
            asset: "DALPHA",
            sourceChain: "srcBeta", // different source chain
            sourceAsset: "BETA",
            reason: "routing_exhausted",
            category: "routing_exhausted",
            selectedMethod: "synthetic_method_alpha",
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "UNRESOLVED_GOVERNING_SYNC_MISMATCH");
  assert.equal(candidate.typedMissingEvidence.length, 0);
});

test("TYPED_MISSING_EVIDENCE never implies canIntent or canLive", () => {
  const handlerReport = readyHandlerReport(
    {},
    {
      selectedMethod: "synthetic_method_gamma",
      plannerCandidateMethods: ["synthetic_method_gamma"],
      source: { chain: "srcG", asset: "GAM", token: "0xg", estimatedUsd: 12 },
      destination: {
        chain: "dstG",
        asset: "DG",
        token: "0xdg",
        targetAmount: "1",
        targetAmountDecimal: 1,
        estimatedAssetValueUsd: 1,
      },
    },
  );
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: handlerReport,
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "dstG",
            asset: "DG",
            sourceChain: "srcG",
            sourceAsset: "GAM",
            reason: "routing_exhausted",
            category: "routing_exhausted",
            selectedMethod: "synthetic_method_gamma",
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "TYPED_MISSING_EVIDENCE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.allowedToExecuteLive, false);
  assert.equal(report.safety.canLive, false);
  assert.equal(report.safety.signerCalled, false);
  assert.equal(report.safety.liveQueueEnqueued, false);
});
