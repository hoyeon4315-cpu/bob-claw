import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  DEFAULT_ADMISSION_REMEDIATION_ALLOWED_SCRIPTS,
} from "./admission-remediation.mjs";
import {
  defaultRunCommand,
  parseWhitelistedRefreshCommand,
  runParsedRefreshSteps,
} from "../session/shadow-refresh-runner.mjs";

export const DEFAULT_CONNECTED_REFRESH_ALLOWED_SCRIPTS = new Set([
  ...DEFAULT_ADMISSION_REMEDIATION_ALLOWED_SCRIPTS,
  "validate:prelive-readiness",
]);

export const DEFAULT_CONNECTED_REFRESH_FOLLOW_UP_COMMANDS = [
  "npm run status:dashboard",
];

function latestPackageFromRecord(record) {
  return record?.finalPackage || record?.packageSnapshot || null;
}

function summarizeExecution(command, result, entry) {
  return {
    id: entry.id || null,
    sequence: entry.sequence ?? null,
    type: entry.type || null,
    key: entry.key || null,
    label: entry.label || null,
    reason: entry.reason || null,
    command,
    scripts: result.steps.map((step) => step.script),
    executionStatus: result.executionStatus,
    steps: result.steps,
  };
}

function effectiveLimit(limit, fallback) {
  if (!Number.isFinite(limit)) return fallback;
  const normalized = Math.max(0, Math.floor(limit));
  return normalized || 0;
}

export async function executeConnectedRefreshPackage({
  refreshPackage,
  execute = false,
  includeReevaluation = true,
  limit = null,
  stopOnFailure = true,
  cwd = process.cwd(),
  env = process.env,
  runCommand = defaultRunCommand,
  allowedScripts = DEFAULT_CONNECTED_REFRESH_ALLOWED_SCRIPTS,
  followUpCommands = DEFAULT_CONNECTED_REFRESH_FOLLOW_UP_COMMANDS,
  now = new Date().toISOString(),
} = {}) {
  const requiredRefreshes = refreshPackage?.requiredRefreshes || [];
  const reevaluationSteps = refreshPackage?.reevaluationSteps || [];
  const selectedRefreshCount = limit == null ? requiredRefreshes.length : Math.min(requiredRefreshes.length, effectiveLimit(limit, requiredRefreshes.length));
  const selectedRefreshes = requiredRefreshes.slice(0, selectedRefreshCount);
  const canRunReevaluation = includeReevaluation && (selectedRefreshes.length === requiredRefreshes.length);
  const selectedReevaluationSteps = canRunReevaluation ? reevaluationSteps : [];
  const runId = `${new Date(now).toISOString()}-${Math.random().toString(16).slice(2, 10)}`;
  let hadFailure = false;
  let firstFailureReason = null;
  const record = {
    schemaVersion: 1,
    observedAt: now,
    runId,
    mode: execute ? "execute" : "preview",
    stopOnFailure,
    includeReevaluation,
    packageSnapshot: refreshPackage || null,
    selectedRefreshCount: selectedRefreshes.length,
    selectedReevaluationCount: selectedReevaluationSteps.length,
    selectedRefreshes: selectedRefreshes.map((entry) => ({
      id: entry.id || null,
      sequence: entry.sequence ?? null,
      key: entry.key || null,
      label: entry.label || null,
      reason: entry.reason || null,
      command: entry.command || null,
    })),
    selectedReevaluationSteps: selectedReevaluationSteps.map((entry) => ({
      id: entry.id || null,
      sequence: entry.sequence ?? null,
      label: entry.label || null,
      command: entry.command || null,
    })),
    refreshResults: [],
    reevaluationResults: [],
    followUps: [],
    executionStatus: execute ? "succeeded" : "preview",
    stopReason: null,
  };

  if (!execute) {
    if (selectedRefreshes.length < requiredRefreshes.length && includeReevaluation) {
      record.stopReason = "remaining_refresh_steps_before_reevaluation";
    }
    return record;
  }

  if (!selectedRefreshes.length && !selectedReevaluationSteps.length) {
    record.executionStatus = "noop";
    record.stopReason = refreshPackage?.status || "no_refresh_actions";
    return record;
  }

  for (const entry of selectedRefreshes) {
    const steps = parseWhitelistedRefreshCommand(entry.command, { allowedScripts });
    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    record.refreshResults.push(summarizeExecution(entry.command, result, entry));
    if (result.executionStatus !== "succeeded" && !firstFailureReason) {
      hadFailure = true;
      firstFailureReason = `${entry.id || "refresh_step"}_failed`;
    }
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.executionStatus = "failed";
      record.stopReason = firstFailureReason;
      return record;
    }
  }

  if (includeReevaluation && selectedRefreshes.length < requiredRefreshes.length) {
    record.executionStatus = "partial_refresh";
    record.stopReason = "remaining_refresh_steps_before_reevaluation";
    return record;
  }

  for (const entry of selectedReevaluationSteps) {
    const steps = parseWhitelistedRefreshCommand(entry.command, { allowedScripts });
    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    record.reevaluationResults.push(summarizeExecution(entry.command, result, entry));
    if (result.executionStatus !== "succeeded" && !firstFailureReason) {
      hadFailure = true;
      firstFailureReason = `${entry.id || "reevaluation_step"}_failed`;
    }
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.executionStatus = "failed";
      record.stopReason = firstFailureReason;
      return record;
    }
  }

  for (const command of followUpCommands) {
    const steps = parseWhitelistedRefreshCommand(command, { allowedScripts });
    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    record.followUps.push({
      command,
      scripts: result.steps.map((step) => step.script),
      executionStatus: result.executionStatus,
      steps: result.steps,
    });
    if (result.executionStatus !== "succeeded" && !firstFailureReason) {
      hadFailure = true;
      firstFailureReason = "connected_refresh_follow_up_failed";
    }
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.executionStatus = "failed";
      record.stopReason = firstFailureReason;
      return record;
    }
  }

  record.executionStatus = hadFailure ? "failed" : "succeeded";
  record.stopReason = firstFailureReason;
  return record;
}

export function buildConnectedRefreshExecutionSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
  const latest = sorted[0] || null;
  const executeRecords = sorted.filter((item) => item.mode === "execute");
  const previewCount = sorted.filter((item) => item.mode === "preview").length;
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: executeRecords.length,
    previewCount,
    successCount: executeRecords.filter((item) => item.executionStatus === "succeeded").length,
    partialCount: executeRecords.filter((item) => item.executionStatus === "partial_refresh").length,
    noopCount: executeRecords.filter((item) => item.executionStatus === "noop").length,
    failureCount: executeRecords.filter((item) => item.executionStatus === "failed").length,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: latest?.executionStatus || latest?.mode || null,
    latestMode: latest?.mode || null,
    latestStopReason: latest?.stopReason || null,
    nextAction: latestPackageFromRecord(latest)?.nextAction || null,
    remainingRefreshCount: latestPackageFromRecord(latest)?.summary?.requiredRefreshCount ?? null,
    recentRuns: sorted.slice(0, 5).map((item) => ({
      observedAt: item.observedAt,
      runId: item.runId,
      mode: item.mode,
      executionStatus: item.executionStatus,
      stopReason: item.stopReason || null,
      selectedRefreshCount: item.selectedRefreshCount ?? 0,
      selectedReevaluationCount: item.selectedReevaluationCount ?? 0,
    })),
  };
}

export async function persistConnectedRefreshRun({
  dataDir,
  record,
  writeSummary = false,
  summaryPath,
} = {}) {
  if (!dataDir || !record) return null;
  const store = new JsonlStore(dataDir);
  await store.append("connected-refresh-runs", record);
  const records = await readJsonl(dataDir, "connected-refresh-runs");
  const summary = buildConnectedRefreshExecutionSummary(records);
  if (writeSummary && summaryPath) {
    await writeTextIfChanged(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        const value = JSON.parse(contents);
        const { generatedAt, latestObservedAt, ...stable } = value;
        return JSON.stringify(stable);
      },
    });
  }
  return summary;
}
