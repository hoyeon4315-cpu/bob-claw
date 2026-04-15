import { buildPreliveExecutionAudit } from "./execution-audit.mjs";
import { buildForkExecutionSummary } from "./fork-execution.mjs";

function queueActionLines(shadowCycle = null, limit = 4) {
  return (shadowCycle?.refreshQueue || [])
    .filter((item) => item?.scope !== "eth_family_watch")
    .slice(0, limit)
    .map((item) => ({
    rank: item.rank ?? null,
    scope: item.scope || null,
    label: item.routeLabel || item.routeKey || item.scope || "refresh",
    reason: item.reason || item.code || null,
    command: item.command || null,
    }));
}

function phaseStatus({ ready, blockers, readyCode, inProgressCode, blockedCode }) {
  if (ready) {
    return { ready: true, status: readyCode, blockers: [] };
  }
  return {
    ready: false,
    status: blockers.length ? blockedCode : inProgressCode,
    blockers,
  };
}

export function buildPreliveReadinessSummary({
  overall = {},
  audit = null,
  shadowCycle = null,
  strategy = null,
  simulationRuns = [],
  forkExecutionPlans = [],
  forkExecutionSubmissions = [],
  forkExecutionReceipts = [],
  executionEvents = [],
  targetSimulationSuccessCount = 50,
  targetForkConfirmedCount = 3,
} = {}) {
  const manualReviewReady = Boolean(strategy?.manualCanaryReviewReady);
  const measuredPolicyReady = Number(strategy?.edgeViability?.policyReadyCount || 0);
  const objectiveExecutionRoute = shadowCycle?.objectivePlans?.executionReview?.routeKey || null;
  const successfulSimulations = simulationRuns.filter((item) => item.status === "simulated_ok");
  const failedSimulations = simulationRuns.filter((item) => item.status === "simulation_failed");
  const latestFailure = [...failedSimulations].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;

  const shadowReplayBlockers = [];
  if (audit?.decision !== "LIVE_CANARY_REVIEW_POSSIBLE") {
    shadowReplayBlockers.push(`audit:${audit?.decision || "missing_audit"}`);
  }
  if (!manualReviewReady) {
    shadowReplayBlockers.push("manual_canary_review_not_ready");
  }
  if (measuredPolicyReady <= 0) {
    shadowReplayBlockers.push("no_policy_ready_measured_route");
  }
  if (!objectiveExecutionRoute) {
    shadowReplayBlockers.push("no_execution_review_route");
  }

  const shadowReplay = phaseStatus({
    ready: shadowReplayBlockers.length === 0,
    blockers: shadowReplayBlockers,
    readyCode: "ready_for_mechanical_simulation",
    inProgressCode: "accumulating_shadow_evidence",
    blockedCode: "shadow_replay_blocked",
  });

  const mechanicalSimulationBlockers = [];
  if (!shadowReplay.ready) {
    mechanicalSimulationBlockers.push("shadow_replay_not_ready");
  }
  if (successfulSimulations.length < targetSimulationSuccessCount) {
    mechanicalSimulationBlockers.push(`needs_${targetSimulationSuccessCount - successfulSimulations.length}_more_successful_simulations`);
  }
  if (failedSimulations.length > 0) {
    mechanicalSimulationBlockers.push("simulation_failures_present");
  }

  const mechanicalSimulation = {
    ...phaseStatus({
      ready: mechanicalSimulationBlockers.length === 0,
      blockers: mechanicalSimulationBlockers,
      readyCode: "mechanical_path_proven",
      inProgressCode: "building_mechanical_evidence",
      blockedCode: "mechanical_simulation_blocked",
    }),
    targetSuccessCount: targetSimulationSuccessCount,
    successCount: successfulSimulations.length,
    failureCount: failedSimulations.length,
    latestFailureReason: latestFailure?.call?.reason || latestFailure?.gasEstimate?.reason || null,
    latestFailureAt: latestFailure?.observedAt || null,
  };

  const forkExecution = {
    ...buildForkExecutionSummary({
      plans: forkExecutionPlans,
      submissions: forkExecutionSubmissions,
      receipts: forkExecutionReceipts,
      targetConfirmedCount: targetForkConfirmedCount,
    }),
  };
  const executionAudit = buildPreliveExecutionAudit({
    forkExecutionPlans,
    forkExecutionSubmissions,
    forkExecutionReceipts,
    executionEvents,
  });
  const forkExecutionBlockers = [];
  if (!mechanicalSimulation.ready) {
    forkExecutionBlockers.push("mechanical_simulation_not_ready");
  }
  if (forkExecution.planCount <= 0) {
    forkExecutionBlockers.push("no_fork_execution_plan");
  }
  if (forkExecution.confirmedCount < targetForkConfirmedCount) {
    forkExecutionBlockers.push(`needs_${targetForkConfirmedCount - forkExecution.confirmedCount}_more_confirmed_fork_cycles`);
  }
  if (forkExecution.pendingOutputCount > 0) {
    forkExecutionBlockers.push("fork_output_resolution_required");
  }
  if (forkExecution.submissionFailureCount > 0) {
    forkExecutionBlockers.push("fork_submission_failures_present");
  }
  if (forkExecution.failedCount > 0) {
    forkExecutionBlockers.push("fork_execution_failures_present");
  }
  if (executionAudit.missingRecordCount > 0) {
    forkExecutionBlockers.push("fork_execution_records_missing");
  }
  forkExecution.ready = forkExecutionBlockers.length === 0;
  forkExecution.status = forkExecution.ready
    ? "fork_execution_proven"
    : forkExecutionBlockers.length
      ? "fork_execution_blocked"
      : "building_fork_evidence";
  forkExecution.blockers = forkExecution.ready ? [] : forkExecutionBlockers;

  const tinyCanaryBlockers = [];
  if (!shadowReplay.ready) {
    tinyCanaryBlockers.push("shadow_replay_not_ready");
  }
  if (!mechanicalSimulation.ready) {
    tinyCanaryBlockers.push("mechanical_simulation_not_ready");
  }
  if (!forkExecution.ready) {
    tinyCanaryBlockers.push("fork_execution_not_ready");
  }
  if (forkExecution.pendingOutputCount > 0) {
    tinyCanaryBlockers.push("fork_output_resolution_required");
  }
  if (overall?.liveTrading !== "BLOCKED") {
    tinyCanaryBlockers.push("live_policy_state_changed");
  }

  const tinyLiveCanary = phaseStatus({
    ready: tinyCanaryBlockers.length === 0,
    blockers: tinyCanaryBlockers,
    readyCode: "review_only_canary_candidate",
    inProgressCode: "not_ready_for_live_review",
    blockedCode: "tiny_canary_blocked",
  });

  const currentStage = !shadowReplay.ready
    ? "shadow_replay"
    : !mechanicalSimulation.ready
      ? "mechanical_simulation"
      : !forkExecution.ready
        ? "fork_execution"
        : "tiny_live_canary_review";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    liveTradingPolicy: overall?.liveTrading || "BLOCKED",
    currentStage,
    shadowReplay: {
      ...shadowReplay,
      auditDecision: audit?.decision || null,
      manualCanaryReviewReady: manualReviewReady,
      policyReadyMeasuredRoutes: measuredPolicyReady,
      executionReviewRoute: objectiveExecutionRoute,
    },
    mechanicalSimulation,
    forkExecution,
    executionAudit,
    tinyLiveCanary,
    nextActions: queueActionLines(shadowCycle),
    notes: [
      "Mechanical simulation uses RPC estimation and eth_call only; it is not realized execution proof.",
      "Pre-live execution audit requires plan, submission, receipt, and journal records to stay in sync.",
      "Fork execution requires an external signer and never stores private keys in planner or dashboard code.",
      "liveTrading remains BLOCKED until architecture review and explicit canary approval.",
    ],
  };
}
