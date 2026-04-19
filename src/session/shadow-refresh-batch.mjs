import { config } from "../config/env.mjs";
import { readExecutionGuards as defaultReadExecutionGuards } from "../execution/guards.mjs";
import {
  DEFAULT_ALLOWED_QUEUE_SCRIPTS,
  defaultRunCommand,
  executeRefreshQueueItem,
  inferRefreshItemOutcome,
  parseWhitelistedRefreshCommand,
  runParsedRefreshSteps,
} from "./shadow-refresh-runner.mjs";

export const DEFAULT_REFRESH_BATCH_FOLLOW_UP_COMMANDS = [
  "npm run status:dashboard",
  "npm run plan:shadow-refreshes -- --write",
  "npm run plan:prelive-fork-execution -- --source=objective --write",
  "npm run report:prelive-readiness -- --write",
  "npm run build:prelive-review-package -- --write",
  "npm run write:session-handoff",
];

const DEFAULT_BATCH_ALLOWED_SCRIPTS = new Set([
  ...DEFAULT_ALLOWED_QUEUE_SCRIPTS,
  "build:prelive-review-package",
  "plan:shadow-refreshes",
  "write:session-handoff",
]);

function firstFailedQueueResult(record) {
  return (record?.queueResults || []).find((result) => result.executionStatus === "failed") || null;
}

function normalizedFailedQueueResult(record) {
  const failedQueue = firstFailedQueueResult(record);
  if (!failedQueue) return null;
  const inferred = inferRefreshItemOutcome(failedQueue);
  return {
    ...failedQueue,
    outcomeCategory: failedQueue.outcomeCategory || inferred.outcomeCategory || null,
    readinessStatus: failedQueue.readinessStatus || inferred.readinessStatus || null,
    readinessGaps: failedQueue.readinessGaps || inferred.readinessGaps || [],
    transientFailure: failedQueue.transientFailure ?? inferred.transientFailure ?? false,
  };
}

function summarizeFollowUp(command, result) {
  return {
    command,
    scripts: result.steps.map((step) => step.script),
    executionStatus: result.executionStatus,
    steps: result.steps,
  };
}

export async function executeShadowRefreshBatch({
  queueItems = [],
  execute = false,
  stopOnFailure = true,
  cwd = process.cwd(),
  env = process.env,
  runCommand = defaultRunCommand,
  readGuards = defaultReadExecutionGuards,
  followUpCommands = DEFAULT_REFRESH_BATCH_FOLLOW_UP_COMMANDS,
  allowedScripts = DEFAULT_BATCH_ALLOWED_SCRIPTS,
  now = new Date().toISOString(),
} = {}) {
  const batchId = `${new Date(now).toISOString()}-${Math.random().toString(16).slice(2, 10)}`;
  const record = {
    schemaVersion: 1,
    observedAt: now,
    batchId,
    mode: execute ? "execute" : "preview",
    stopOnFailure,
    selectedCount: queueItems.length,
    queueResults: [],
    followUps: [],
    circuitBreaker: {
      emergencyStopActive: false,
      blocked: false,
      reasons: [],
    },
    batchStatus: execute ? "succeeded" : "preview",
    stopReason: null,
  };

  if (execute) {
    const guards = await readGuards({
      emergencyStopPath: config.emergencyStopFlagPath,
      liveModePath: config.liveModeFlagPath,
      mode: "dry_run",
    });
    record.circuitBreaker = {
      emergencyStopActive: guards.emergencyStopActive,
      blocked: guards.blocked,
      reasons: guards.reasons,
    };
    if (guards.blocked) {
      record.batchStatus = "blocked";
      record.stopReason = guards.reasons[0] || "refresh_batch_blocked";
      return record;
    }
  }

  for (const item of queueItems) {
    const result = await executeRefreshQueueItem(item, {
      cwd,
      env,
      execute,
      runCommand,
      allowedScripts,
      now,
    });
    record.queueResults.push(result);
    if (execute && stopOnFailure && result.executionStatus !== "succeeded") {
      record.batchStatus = result.executionStatus === "invalid" ? "invalid" : "failed";
      record.stopReason = `queue_item_${result.executionStatus}`;
      return record;
    }
  }

  if (!execute) {
    return record;
  }

  for (const command of followUpCommands) {
    let steps;
    try {
      steps = parseWhitelistedRefreshCommand(command, { allowedScripts });
    } catch (error) {
      record.followUps.push({
        command,
        scripts: [],
        executionStatus: "invalid",
        steps: [],
        invalidReason: error.message,
      });
      record.batchStatus = "invalid";
      record.stopReason = "follow_up_invalid";
      if (stopOnFailure) return record;
      continue;
    }

    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    record.followUps.push(summarizeFollowUp(command, result));
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.batchStatus = "failed";
      record.stopReason = "follow_up_failed";
      return record;
    }
  }

  return record;
}

export function buildShadowRefreshBatchSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
  const executeRecords = sorted.filter((item) => item.mode === "execute");
  const successCount = executeRecords.filter((item) => item.batchStatus === "succeeded").length;
  const failureCount = executeRecords.filter((item) => item.batchStatus === "failed").length;
  const blockedCount = executeRecords.filter((item) => item.batchStatus === "blocked").length;
  const invalidCount = executeRecords.filter((item) => item.batchStatus === "invalid").length;
  const latest = sorted[0] || null;
  const latestFailedQueue = normalizedFailedQueueResult(latest);
  const latestExecuteFailure = executeRecords.find((item) => item.batchStatus === "failed") || null;
  const latestExecuteFailedQueue = normalizedFailedQueueResult(latestExecuteFailure);
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: executeRecords.length,
    successCount,
    failureCount,
    blockedCount,
    invalidCount,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: latest?.batchStatus || null,
    latestMode: latest?.mode || null,
    latestStopReason: latest?.stopReason || null,
    latestFailureCategory: latestFailedQueue?.outcomeCategory || null,
    latestFailureRouteLabel: latestFailedQueue?.routeLabel || latestFailedQueue?.routeKey || null,
    recentFailureObservedAt: latestExecuteFailure?.observedAt || null,
    recentFailureCategory: latestExecuteFailedQueue?.outcomeCategory || null,
    recentFailureRouteLabel: latestExecuteFailedQueue?.routeLabel || latestExecuteFailedQueue?.routeKey || null,
    recentFailureTransient: Boolean(latestExecuteFailedQueue?.transientFailure),
    recentBatches: sorted.slice(0, 5).map((item) => {
      const failedQueue = normalizedFailedQueueResult(item);
      return {
        observedAt: item.observedAt,
        batchId: item.batchId,
        mode: item.mode,
        batchStatus: item.batchStatus,
        stopReason: item.stopReason,
        selectedCount: item.selectedCount,
        queueSuccessCount: (item.queueResults || []).filter((result) => result.executionStatus === "succeeded").length,
        queueFailureCount: (item.queueResults || []).filter((result) => result.executionStatus === "failed").length,
        queueFailureCategory: failedQueue?.outcomeCategory || null,
        queueFailureRouteLabel: failedQueue?.routeLabel || failedQueue?.routeKey || null,
        queueFailureTransient: Boolean(failedQueue?.transientFailure),
        followUpFailureCount: (item.followUps || []).filter((result) => result.executionStatus === "failed").length,
        circuitBreakerBlocked: Boolean(item.circuitBreaker?.blocked),
      };
    }),
  };
}
