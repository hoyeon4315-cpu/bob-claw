import { buildSimulationSummary } from "./execution-sim.mjs";

function finiteInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizedSource(value) {
  return value || "objective";
}

function defaultMaxRuns(successRemaining, limit) {
  const normalizedLimit = Math.max(1, finiteInteger(limit, 4));
  return Math.max(1, Math.ceil(Math.max(0, successRemaining) / normalizedLimit) + 1);
}

export function buildPreliveSimulationLoopPlan({
  simulationRuns = [],
  targetSuccessCount = 50,
  source = "objective",
  routeKey = null,
  amount = null,
  limit = 4,
  maxRuns = null,
  maxStallRuns = 2,
  stopOnFailure = true,
} = {}) {
  const currentSummary = buildSimulationSummary(simulationRuns, { targetSuccessCount });
  const resolvedLimit = Math.max(1, finiteInteger(limit, 4));
  const resolvedMaxRuns =
    maxRuns == null ? defaultMaxRuns(currentSummary.successRemaining, resolvedLimit) : Math.max(1, finiteInteger(maxRuns, 1));
  const resolvedMaxStallRuns = Math.max(1, finiteInteger(maxStallRuns, 2));
  const initialFailureCount = currentSummary.failureCount ?? 0;
  const nextAction =
    currentSummary.successRemaining <= 0
      ? "target_already_reached"
      : initialFailureCount > 0 && stopOnFailure
        ? "collect_remaining_successes_but_keep_failure_blocker_visible"
        : "collect_simulation_evidence";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    currentSummary,
    settings: {
      source: normalizedSource(source),
      routeKey: routeKey || null,
      amount: amount || null,
      limit: resolvedLimit,
      maxRuns: resolvedMaxRuns,
      maxStallRuns: resolvedMaxStallRuns,
      stopOnFailure,
      targetSuccessCount,
    },
    nextAction,
  };
}

export async function runPreliveSimulationLoop({
  loadRuns,
  runBatch,
  targetSuccessCount = 50,
  source = "objective",
  routeKey = null,
  amount = null,
  limit = 4,
  maxRuns = null,
  maxStallRuns = 2,
  stopOnFailure = true,
  now = new Date().toISOString(),
} = {}) {
  if (typeof loadRuns !== "function") {
    throw new Error("runPreliveSimulationLoop requires loadRuns");
  }
  if (typeof runBatch !== "function") {
    throw new Error("runPreliveSimulationLoop requires runBatch");
  }

  const initialRuns = await loadRuns();
  const plan = buildPreliveSimulationLoopPlan({
    simulationRuns: initialRuns,
    targetSuccessCount,
    source,
    routeKey,
    amount,
    limit,
    maxRuns,
    maxStallRuns,
    stopOnFailure,
  });
  const record = {
    schemaVersion: 1,
    observedAt: now,
    mode: "execute",
    settings: plan.settings,
    initialSummary: plan.currentSummary,
    iterations: [],
    executionStatus: "blocked",
    stopReason: null,
    finalSummary: plan.currentSummary,
  };

  if (plan.currentSummary.successRemaining <= 0) {
    record.executionStatus = "succeeded";
    record.stopReason = "target_already_reached";
    return record;
  }

  let stalledRuns = 0;
  let currentSummary = plan.currentSummary;
  for (let attempt = 1; attempt <= plan.settings.maxRuns; attempt += 1) {
    const beforeSummary = currentSummary;
    const batch = await runBatch({
      attempt,
      source: plan.settings.source,
      routeKey: plan.settings.routeKey,
      amount: plan.settings.amount,
      limit: plan.settings.limit,
      targetSuccessCount: plan.settings.targetSuccessCount,
    });

    const iteration = {
      attempt,
      ok: Boolean(batch?.ok),
      selectedCount: Array.isArray(batch?.results) ? batch.results.length : null,
      batchSummary: batch?.summary || null,
      command: batch?.command || null,
      error: batch?.error || null,
    };

    if (!batch?.ok) {
      iteration.stopReason = "simulation_batch_failed";
      record.iterations.push(iteration);
      record.executionStatus = "failed";
      record.stopReason = "simulation_batch_failed";
      return record;
    }

    const runsAfterBatch = await loadRuns();
    currentSummary = buildSimulationSummary(runsAfterBatch, {
      targetSuccessCount: plan.settings.targetSuccessCount,
    });
    const successDelta = currentSummary.successCount - beforeSummary.successCount;
    const failureDelta = currentSummary.failureCount - beforeSummary.failureCount;
    const skippedDelta = currentSummary.skippedCount - beforeSummary.skippedCount;

    Object.assign(iteration, {
      successDelta,
      failureDelta,
      skippedDelta,
      cumulativeSummary: currentSummary,
    });
    record.iterations.push(iteration);
    record.finalSummary = currentSummary;

    if ((iteration.selectedCount || 0) <= 0) {
      record.executionStatus = "blocked";
      record.stopReason = "no_simulation_targets_with_latest_quotes";
      return record;
    }

    if (failureDelta > 0 && stopOnFailure) {
      iteration.stopReason = "simulation_failure_recorded";
      record.executionStatus = "blocked";
      record.stopReason = "simulation_failure_recorded";
      return record;
    }

    if (currentSummary.successRemaining <= 0) {
      record.executionStatus = "succeeded";
      record.stopReason = "target_success_count_reached";
      return record;
    }

    if (successDelta <= 0 && failureDelta <= 0) {
      stalledRuns += 1;
      if (stalledRuns >= plan.settings.maxStallRuns) {
        iteration.stopReason = "simulation_progress_stalled";
        record.executionStatus = "blocked";
        record.stopReason = "simulation_progress_stalled";
        return record;
      }
    } else {
      stalledRuns = 0;
    }
  }

  record.executionStatus = "blocked";
  record.stopReason = "max_runs_exhausted";
  return record;
}
