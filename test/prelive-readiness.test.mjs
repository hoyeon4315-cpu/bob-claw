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
      manualCanaryReviewReady: true,
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
      manualCanaryReviewReady: false,
      edgeViability: {
        policyReadyCount: 0,
      },
    },
    simulationRuns: [],
    targetSimulationSuccessCount: 2,
  });

  assert.equal(summary.currentStage, "shadow_replay");
  assert.equal(summary.shadowReplay.ready, false);
  assert.equal(summary.shadowReplay.blockers.includes("manual_canary_review_not_ready"), true);
  assert.equal(summary.shadowReplay.blockers.includes("no_policy_ready_measured_route"), true);
  assert.equal(summary.mechanicalSimulation.blockers.includes("shadow_replay_not_ready"), true);
  assert.equal(summary.tinyLiveCanary.blockers.includes("shadow_replay_not_ready"), true);
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
      manualCanaryReviewReady: true,
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
