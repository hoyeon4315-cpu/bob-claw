import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPreliveReadinessSummary } from "../src/prelive/readiness.mjs";

test("prelive readiness advances to tiny canary review when shadow and simulation gates clear", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: "ethereum:btc->base:btc",
        },
      },
      refreshQueue: [
        {
          rank: 1,
          scope: "canary_readiness",
          routeLabel: "base->avalanche",
          reason: "wallet_ready",
          command: "npm run check:estimator-wallet -- --route-key=\"base:btc->avalanche:btc\" --amount=\"10000\"",
        },
      ],
    },
    strategy: {
      policyCanaryReviewReady: true,
      edgeViability: {
        policyReadyCount: 2,
      },
    },
    simulationRuns: [
      { observedAt: "2026-04-12T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-12T10:05:00.000Z", status: "simulated_ok" },
    ],
    forkExecutionPlans: [
      {
        observedAt: "2026-04-12T10:06:00.000Z",
        planId: "plan-1",
        routeLabel: "ethereum->base",
      },
      {
        observedAt: "2026-04-12T10:06:30.000Z",
        planId: "plan-2",
        routeLabel: "ethereum->unichain",
      },
    ],
    forkExecutionSubmissions: [
      {
        observedAt: "2026-04-12T10:07:00.000Z",
        planId: "plan-1",
        submissionStatus: "submitted",
        txHash: "0xabc",
      },
      {
        observedAt: "2026-04-12T10:07:30.000Z",
        planId: "plan-2",
        submissionStatus: "submitted",
        txHash: "0xdef",
      },
    ],
    forkExecutionReceipts: [
      {
        observedAt: "2026-04-12T10:08:00.000Z",
        planId: "plan-1",
        reconciliationStatus: "reconciled",
        txHash: "0xabc",
        flags: { failed: false },
      },
      {
        observedAt: "2026-04-12T10:09:00.000Z",
        planId: "plan-2",
        reconciliationStatus: "reconciled",
        txHash: "0xdef",
        flags: { failed: false },
      },
    ],
    executionEvents: [
      { observedAt: "2026-04-12T10:07:00.000Z", jobId: "plan-1", status: "submitted", executionMethod: "external_signed_raw_tx", txHash: "0xabc" },
      { observedAt: "2026-04-12T10:07:30.000Z", jobId: "plan-2", status: "submitted", executionMethod: "external_signed_raw_tx", txHash: "0xdef" },
      { observedAt: "2026-04-12T10:08:00.000Z", jobId: "plan-1", status: "confirmed", executionMethod: "external_signed_raw_tx", txHash: "0xabc" },
      { observedAt: "2026-04-12T10:09:00.000Z", jobId: "plan-2", status: "confirmed", executionMethod: "external_signed_raw_tx", txHash: "0xdef" },
    ],
    targetSimulationSuccessCount: 2,
    targetForkConfirmedCount: 2,
  });

  assert.equal(summary.currentStage, "tiny_live_canary_review");
  assert.equal(summary.shadowReplay.ready, true);
  assert.equal(summary.mechanicalSimulation.ready, true);
  assert.equal(summary.forkExecution.ready, true);
  assert.equal(summary.executionAudit.status, "complete");
  assert.equal(summary.tinyLiveCanary.ready, true);
  assert.equal(summary.nextActions.length, 1);
});

test("prelive readiness stays in shadow replay when audit and policy gates are blocked", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "MORE_SHADOW_REQUIRED",
    },
    shadowCycle: {
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 0,
      },
    },
    simulationRuns: [],
    targetSimulationSuccessCount: 2,
  });

  assert.equal(summary.currentStage, "shadow_replay");
  assert.equal(summary.shadowReplay.ready, false);
  assert.equal(summary.shadowReplay.blockers.includes("policy_canary_review_not_ready"), true);
  assert.equal(summary.shadowReplay.blockers.includes("no_policy_ready_measured_route"), true);
  assert.equal(summary.mechanicalSimulation.blockers.includes("shadow_replay_not_ready"), true);
  assert.equal(summary.tinyLiveCanary.blockers.includes("shadow_replay_not_ready"), true);
});

test("prelive readiness honors review-package policy waiting state even when strategy summary lags", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: "base:btc->ethereum:btc",
        },
      },
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 1,
      },
    },
    reviewPackage: {
      readyForPolicyReview: true,
      tinyCanaryAdmission: {
        status: "policy_waiting",
      },
    },
    targetSimulationSuccessCount: 1,
  });

  assert.equal(summary.shadowReplay.blockers.includes("policy_canary_review_not_ready"), false);
  assert.equal(summary.shadowReplay.policyCanaryReviewReady, true);
  assert.equal(summary.currentStage, "mechanical_simulation");
});

test("prelive readiness does not require a route edge when a strategy candidate is review-ready", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 0,
      },
    },
    reviewPackage: {
      readyForPolicyReview: true,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        tradeReadiness: "strategy_candidate_review_only",
        reviewReady: true,
      },
      tinyCanaryAdmission: {
        status: "policy_waiting",
      },
    },
    targetSimulationSuccessCount: 1,
  });

  assert.equal(summary.shadowReplay.blockers.includes("no_policy_ready_measured_route"), false);
  assert.equal(summary.shadowReplay.blockers.includes("no_execution_review_route"), false);
  assert.equal(summary.shadowReplay.strategyReviewCandidateReady, true);
  assert.equal(summary.currentStage, "mechanical_simulation");
});

test("prelive readiness treats transport-only audit blockers as warnings for ready strategy candidates", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["candidate amount diversity"],
      checks: [
        {
          label: "candidate amount diversity",
          ok: false,
          detail: "1 candidate routes have < 4 amount levels",
        },
      ],
    },
    shadowCycle: {
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 0,
      },
    },
    reviewPackage: {
      readyForPolicyReview: true,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        tradeReadiness: "strategy_candidate_review_only",
        reviewReady: true,
      },
      tinyCanaryAdmission: {
        status: "policy_waiting",
      },
    },
    targetSimulationSuccessCount: 1,
  });

  assert.equal(summary.shadowReplay.ready, true);
  assert.equal(summary.shadowReplay.blockers.includes("audit:LIVE_BLOCKED"), false);
  assert.equal(summary.shadowReplay.auditBlocksSelectedLane, false);
  assert.equal(summary.shadowReplay.transportAuditWarningOnly, true);
  assert.deepEqual(summary.shadowReplay.auditBlockers, ["candidate amount diversity"]);
  assert.equal(summary.currentStage, "mechanical_simulation");
});

test("prelive readiness still blocks strategy candidates on non-transport audit failures", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["shadow time window"],
      checks: [
        {
          label: "shadow time window",
          ok: false,
          detail: "12h observed, target 168h",
        },
      ],
    },
    shadowCycle: {
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 0,
      },
    },
    reviewPackage: {
      readyForPolicyReview: true,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        tradeReadiness: "strategy_candidate_review_only",
        reviewReady: true,
      },
      tinyCanaryAdmission: {
        status: "policy_waiting",
      },
    },
    targetSimulationSuccessCount: 1,
  });

  assert.equal(summary.shadowReplay.ready, false);
  assert.equal(summary.shadowReplay.blockers.includes("audit:LIVE_BLOCKED"), true);
  assert.equal(summary.shadowReplay.auditBlocksSelectedLane, true);
  assert.equal(summary.shadowReplay.transportAuditWarningOnly, false);
  assert.equal(summary.currentStage, "shadow_replay");
});

test("prelive readiness pauses at fork execution after mechanical proof", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: "ethereum:btc->base:btc",
        },
      },
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: true,
      edgeViability: {
        policyReadyCount: 1,
      },
    },
    simulationRuns: [
      { observedAt: "2026-04-12T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-12T10:05:00.000Z", status: "simulated_ok" },
    ],
    targetSimulationSuccessCount: 2,
    targetForkConfirmedCount: 2,
  });

  assert.equal(summary.currentStage, "fork_execution");
  assert.equal(summary.mechanicalSimulation.ready, true);
  assert.equal(summary.forkExecution.ready, false);
  assert.equal(summary.forkExecution.blockers.includes("no_fork_execution_plan"), true);
  assert.equal(summary.tinyLiveCanary.blockers.includes("fork_execution_not_ready"), true);
});

test("prelive readiness accepts signer-backed strategy execution proof instead of route fork cycles", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["candidate amount diversity"],
    },
    shadowCycle: {
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 0,
      },
    },
    reviewPackage: {
      readyForPolicyReview: true,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
        tradeReadiness: "strategy_candidate_review_only",
        reviewReady: true,
        evidence: {
          liveRoundtripProofStatus: "signer_backed_roundtrip_recorded",
          liveRoundtripEntryCount: 8,
          liveRoundtripUnwindCount: 4,
        },
      },
      tinyCanaryAdmission: {
        status: "policy_waiting",
      },
    },
    simulationRuns: [
      { observedAt: "2026-04-12T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-12T10:05:00.000Z", status: "simulated_ok" },
    ],
    targetSimulationSuccessCount: 2,
    targetForkConfirmedCount: 3,
  });

  assert.equal(summary.currentStage, "tiny_live_canary_review");
  assert.equal(summary.forkExecution.ready, true);
  assert.equal(summary.forkExecution.status, "strategy_execution_proven");
  assert.equal(summary.forkExecution.blockers.includes("no_fork_execution_plan"), false);
  assert.equal(summary.forkExecution.blockers.some((blocker) => blocker.includes("confirmed_fork_cycles")), false);
  assert.equal(summary.forkExecution.strategyExecutionProof.ready, true);
  assert.equal(summary.tinyLiveCanary.ready, true);
});

test("prelive readiness still requires fork cycles when a strategy lacks signer-backed proof", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 0,
      },
    },
    reviewPackage: {
      readyForPolicyReview: true,
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "recursive_wrapped_btc_lending_loop",
        candidateLabel: "Recursive wrapped-BTC lending loop",
        tradeReadiness: "strategy_candidate_review_only",
        reviewReady: true,
        evidence: {
          dryRunReceiptRecorded: true,
          signerBackedRunCount: 0,
        },
      },
      tinyCanaryAdmission: {
        status: "policy_waiting",
      },
    },
    simulationRuns: [
      { observedAt: "2026-04-12T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-12T10:05:00.000Z", status: "simulated_ok" },
    ],
    targetSimulationSuccessCount: 2,
    targetForkConfirmedCount: 3,
  });

  assert.equal(summary.currentStage, "fork_execution");
  assert.equal(summary.forkExecution.ready, false);
  assert.equal(summary.forkExecution.strategyExecutionProof.ready, false);
  assert.equal(summary.forkExecution.blockers.includes("no_fork_execution_plan"), true);
  assert.equal(summary.tinyLiveCanary.blockers.includes("fork_execution_not_ready"), true);
});

test("prelive readiness blocks on unresolved pending fork output", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: "ethereum:btc->base:btc",
        },
      },
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: true,
      edgeViability: {
        policyReadyCount: 1,
      },
    },
    simulationRuns: [
      { observedAt: "2026-04-12T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-12T10:05:00.000Z", status: "simulated_ok" },
    ],
    forkExecutionPlans: [
      {
        observedAt: "2026-04-12T10:06:00.000Z",
        planId: "plan-1",
        routeLabel: "ethereum->base",
        routeKey: "ethereum:btc->base:btc",
        amount: "10000",
        dstChain: "base",
        routeContext: {
          routeKey: "ethereum:btc->base:btc",
          dstAsset: { chain: "base", token: "0x0555" },
          price: { dstRawUsd: 73000 },
        },
      },
    ],
    forkExecutionSubmissions: [
      {
        observedAt: "2026-04-12T10:07:00.000Z",
        planId: "plan-1",
        submissionStatus: "submitted",
        txHash: "0xabc",
      },
    ],
    forkExecutionReceipts: [
      {
        observedAt: "2026-04-12T10:08:00.000Z",
        planId: "plan-1",
        routeLabel: "ethereum->base",
        amount: "10000",
        txHash: "0xabc",
        reconciliationStatus: "pending_output",
        routeContext: {
          routeKey: "ethereum:btc->base:btc",
          dstAsset: { chain: "base", token: "0x0555" },
          price: { dstRawUsd: 73000 },
        },
        flags: { failed: false },
      },
    ],
    executionEvents: [
      { observedAt: "2026-04-12T10:07:00.000Z", jobId: "plan-1", status: "submitted", executionMethod: "external_signed_raw_tx", txHash: "0xabc" },
      { observedAt: "2026-04-12T10:08:00.000Z", jobId: "plan-1", status: "pending_output", executionMethod: "external_signed_raw_tx", txHash: "0xabc" },
    ],
    targetSimulationSuccessCount: 2,
    targetForkConfirmedCount: 1,
  });

  assert.equal(summary.currentStage, "fork_execution");
  assert.equal(summary.forkExecution.pendingOutputCount, 1);
  assert.equal(summary.forkExecution.blockers.includes("fork_output_resolution_required"), true);
  assert.equal(summary.tinyLiveCanary.blockers.includes("fork_output_resolution_required"), true);
  assert.equal(summary.forkExecution.latestPendingOutput.planId, "plan-1");
});

test("prelive readiness does not keep remediated active insufficient-funds failures as mechanical blockers", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: "base:btc->ethereum:btc",
          amount: "10000",
        },
      },
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: true,
      edgeViability: {
        policyReadyCount: 1,
      },
    },
    simulationRuns: [
      {
        observedAt: "2026-04-12T10:00:00.000Z",
        routeKey: "base:btc->ethereum:btc",
        amount: "10000",
        status: "simulation_failed",
        gasEstimate: { reason: "insufficient_funds" },
        call: { reason: "insufficient_funds" },
      },
      {
        observedAt: "2026-04-12T10:10:00.000Z",
        routeKey: "base:btc->ethereum:btc",
        amount: "10000",
        status: "simulated_ok",
      },
    ],
    walletReadinessRecords: [
      {
        observedAt: "2026-04-12T10:11:00.000Z",
        routeKey: "base:btc->ethereum:btc",
        amount: "10000",
        overallReady: true,
      },
    ],
    targetSimulationSuccessCount: 1,
  });

  assert.equal(summary.mechanicalSimulation.ready, true);
  assert.equal(summary.mechanicalSimulation.blockers.includes("simulation_failures_present"), false);
  assert.equal(summary.mechanicalSimulation.failureCount, 1);
  assert.equal(summary.mechanicalSimulation.unresolvedFailureCount, 0);
  assert.equal(summary.mechanicalSimulation.remediatedFailureCount, 1);
  assert.equal(summary.currentStage, "fork_execution");
});

test("prelive readiness treats failures outside active routes as historical instead of active blockers", () => {
  const summary = buildPreliveReadinessSummary({
    overall: {
      liveTrading: "BLOCKED",
    },
    audit: {
      decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: "base:btc->ethereum:btc",
          amount: "10000",
        },
      },
      refreshQueue: [],
    },
    strategy: {
      policyCanaryReviewReady: true,
      edgeViability: {
        policyReadyCount: 1,
      },
    },
    simulationRuns: [
      {
        observedAt: "2026-04-12T10:00:00.000Z",
        routeKey: "avalanche:btc->ethereum:btc",
        amount: "10000",
        status: "simulation_failed",
        gasEstimate: { reason: "execution_reverted" },
        call: { reason: "execution_reverted" },
      },
      {
        observedAt: "2026-04-12T10:10:00.000Z",
        routeKey: "base:btc->ethereum:btc",
        amount: "10000",
        status: "simulated_ok",
      },
    ],
    targetSimulationSuccessCount: 1,
  });

  assert.equal(summary.mechanicalSimulation.ready, true);
  assert.equal(summary.mechanicalSimulation.failureCount, 1);
  assert.equal(summary.mechanicalSimulation.unresolvedFailureCount, 0);
  assert.equal(summary.mechanicalSimulation.historicalFailureCount, 1);
  assert.equal(summary.mechanicalSimulation.blockers.includes("simulation_failures_present"), false);
});
