import { randomUUID } from "node:crypto";
import { config } from "../config/env.mjs";
import { readExecutionGuards } from "../execution/guards.mjs";
import {
  defaultRunCommand,
  parseWhitelistedRefreshCommand,
  runParsedRefreshSteps,
} from "./shadow-refresh-runner.mjs";

export const DEFAULT_ALLOWED_STRATEGY_DISPATCH_SCRIPTS = new Set([
  "analyze:ethereum-routes",
  "analyze:triangular-spreads",
  "audit:eth-family-overfit",
  "collect:triangular-spreads",
  "flash:dryrun",
  "report:btc-proxy-spreads",
  "report:strategy-execution-surfaces",
  "report:strategy-snapshot",
  "score:gateway",
  "status:dashboard",
  "trigger:arb",
]);

export const DEFAULT_STRATEGY_DISPATCH_FOLLOW_UP_COMMANDS = [
  "npm run status:dashboard",
  "npm run report:strategy-snapshot -- --write",
  "npm run report:strategy-execution-surfaces -- --write",
];

function normalizeRequestedMode(mode = null) {
  const value = String(mode || "auto").trim().toLowerCase();
  if (value === "dry-run") return "dry_run";
  return value;
}

function scriptsForCommands(commands = []) {
  return (commands || []).map((command) => command.script).filter(Boolean);
}

function requestedCommandsForStrategy(strategy, requestedMode) {
  const mode = normalizeRequestedMode(requestedMode);
  if (mode === "auto") {
    return {
      mode: strategy.selectedMode,
      commands: strategy.selectedCommands || [],
      blockedReason: null,
    };
  }

  if (mode === strategy.selectedMode) {
    return {
      mode,
      commands: strategy.selectedCommands || [],
      blockedReason: null,
    };
  }

  const commandMap = {
    analysis: strategy.selectedCommands || [],
    shadow: strategy.selectedMode === "shadow" ? strategy.selectedCommands || [] : [],
    dry_run: strategy.selectedMode === "dry_run" ? strategy.selectedCommands || [] : [],
    live: strategy.currentLiveEligible ? strategy.selectedCommands || [] : [],
  };
  const commands = commandMap[mode] || [];
  if (commands.length === 0) {
    return {
      mode,
      commands,
      blockedReason: "requested_mode_not_supported",
    };
  }
  return {
    mode,
    commands,
    blockedReason: null,
  };
}

function previewSteps(steps = []) {
  return steps.map((step) => ({
    script: step.script,
    ok: null,
    exitCode: null,
    signal: null,
    durationMs: null,
    stdoutSummary: null,
    stderrSummary: null,
  }));
}

async function executeStrategyItem(
  strategy,
  {
    execute = false,
    requestedMode = "auto",
    cwd = process.cwd(),
    env = process.env,
    runCommand = defaultRunCommand,
    allowedScripts = DEFAULT_ALLOWED_STRATEGY_DISPATCH_SCRIPTS,
    readGuards = readExecutionGuards,
  } = {},
) {
  const selection = requestedCommandsForStrategy(strategy, requestedMode);
  const base = {
    strategyId: strategy.id,
    label: strategy.label,
    lane: strategy.lane,
    status: strategy.status,
    capabilityBucket: strategy.capabilityBucket,
    requestedMode: normalizeRequestedMode(requestedMode),
    selectedMode: selection.mode,
    liveCapable: Boolean(strategy.liveCapable),
    currentLiveEligible: Boolean(strategy.currentLiveEligible),
    blockedReason: selection.blockedReason || null,
    fallbackReason: strategy.fallbackReason || null,
    scripts: scriptsForCommands(selection.commands),
  };

  if (selection.blockedReason) {
    return {
      ...base,
      executionStatus: "blocked",
      stepCount: 0,
      steps: [],
    };
  }

  let steps;
  try {
    steps = selection.commands.flatMap((command) => parseWhitelistedRefreshCommand(command.command, { allowedScripts }));
  } catch (error) {
    return {
      ...base,
      executionStatus: "invalid",
      blockedReason: error.message,
      stepCount: 0,
      steps: [],
    };
  }

  if (steps.length === 0) {
    return {
      ...base,
      executionStatus: "blocked",
      blockedReason: base.blockedReason || "no_commands_selected",
      stepCount: 0,
      steps: [],
    };
  }

  const guardMode = selection.mode === "live" ? "live" : "dry_run";
  const guards = await readGuards({
    emergencyStopPath: config.emergencyStopFlagPath,
    liveModePath: config.liveModeFlagPath,
    mode: guardMode,
  });
  if (guards.blocked) {
    return {
      ...base,
      executionStatus: "blocked",
      blockedReason: guards.reasons[0] || "execution_guard_blocked",
      guardReasons: guards.reasons || [],
      stepCount: steps.length,
      steps: previewSteps(steps),
    };
  }

  if (!execute) {
    return {
      ...base,
      executionStatus: "preview",
      guardReasons: guards.reasons || [],
      stepCount: steps.length,
      steps: previewSteps(steps),
    };
  }

  const executed = await runParsedRefreshSteps(steps, {
    cwd,
    env,
    runCommand: async (details) => runCommand({ ...details, strategy }),
  });
  return {
    ...base,
    executionStatus: executed.executionStatus,
    guardReasons: guards.reasons || [],
    stepCount: steps.length,
    steps: executed.steps,
  };
}

async function executeFollowUpCommands(
  commands,
  {
    execute = false,
    cwd = process.cwd(),
    env = process.env,
    runCommand = defaultRunCommand,
    allowedScripts = DEFAULT_ALLOWED_STRATEGY_DISPATCH_SCRIPTS,
  } = {},
) {
  const results = [];
  for (const command of commands || []) {
    let steps;
    try {
      steps = parseWhitelistedRefreshCommand(command, { allowedScripts });
    } catch (error) {
      results.push({
        command,
        executionStatus: "invalid",
        invalidReason: error.message,
        scripts: [],
        steps: [],
      });
      continue;
    }
    if (!execute) {
      results.push({
        command,
        executionStatus: "preview",
        invalidReason: null,
        scripts: steps.map((step) => step.script),
        steps: previewSteps(steps),
      });
      continue;
    }
    const executed = await runParsedRefreshSteps(steps, {
      cwd,
      env,
      runCommand: async (details) => runCommand({ ...details, followUpCommand: command }),
    });
    results.push({
      command,
      executionStatus: executed.executionStatus,
      invalidReason: null,
      scripts: steps.map((step) => step.script),
      steps: executed.steps,
    });
    if (executed.executionStatus !== "succeeded") break;
  }
  return results;
}

export async function executeStrategyDispatch({
  strategies = [],
  execute = false,
  requestedMode = "auto",
  stopOnFailure = true,
  followUpCommands = DEFAULT_STRATEGY_DISPATCH_FOLLOW_UP_COMMANDS,
  cwd = process.cwd(),
  env = process.env,
  now = new Date().toISOString(),
  runCommand = defaultRunCommand,
  allowedScripts = DEFAULT_ALLOWED_STRATEGY_DISPATCH_SCRIPTS,
  readGuards = readExecutionGuards,
} = {}) {
  const results = [];
  let stopReason = null;
  for (const strategy of strategies) {
    const result = await executeStrategyItem(strategy, {
      execute,
      requestedMode,
      cwd,
      env,
      runCommand,
      allowedScripts,
      readGuards,
    });
    results.push(result);
    if (execute && stopOnFailure && (result.executionStatus === "failed" || result.executionStatus === "invalid")) {
      stopReason = "strategy_failed";
      break;
    }
  }

  const ranAny = results.some((result) => result.executionStatus === "succeeded");
  const followUps =
    stopReason || !(execute ? ranAny : strategies.length > 0)
      ? []
      : await executeFollowUpCommands(followUpCommands, {
          execute,
          cwd,
          env,
          runCommand,
          allowedScripts,
        });

  const hasStrategyFailure = results.some((result) => result.executionStatus === "failed");
  const hasStrategyInvalid = results.some((result) => result.executionStatus === "invalid");
  const hasFollowUpFailure = followUps.some((result) => result.executionStatus === "failed");
  const hasFollowUpInvalid = followUps.some((result) => result.executionStatus === "invalid");
  const batchStatus = !execute
    ? "preview"
    : stopReason || hasStrategyFailure || hasFollowUpFailure
      ? "failed"
      : hasStrategyInvalid || hasFollowUpInvalid
        ? "invalid"
        : "succeeded";

  return {
    schemaVersion: 1,
    observedAt: now,
    dispatchId: randomUUID(),
    mode: execute ? "execute" : "preview",
    requestedMode: normalizeRequestedMode(requestedMode),
    selectedCount: strategies.length,
    batchStatus,
    stopReason,
    strategyResults: results,
    followUps,
  };
}

export function buildStrategyDispatchSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
  const latest = sorted[0] || null;
  const executedRecords = sorted.filter((record) => record.mode === "execute");
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: executedRecords.length,
    successCount: executedRecords.filter((record) => record.batchStatus === "succeeded").length,
    failureCount: executedRecords.filter((record) => record.batchStatus === "failed").length,
    previewCount: sorted.filter((record) => record.mode === "preview").length,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: latest?.batchStatus || null,
    latestMode: latest?.mode || null,
    latestStopReason: latest?.stopReason || null,
    recentBatches: sorted.slice(0, 5).map((record) => ({
      observedAt: record.observedAt,
      dispatchId: record.dispatchId,
      mode: record.mode,
      batchStatus: record.batchStatus,
      selectedCount: record.selectedCount,
      succeededCount: (record.strategyResults || []).filter((result) => result.executionStatus === "succeeded").length,
      blockedCount: (record.strategyResults || []).filter((result) => result.executionStatus === "blocked").length,
      previewCount: (record.strategyResults || []).filter((result) => result.executionStatus === "preview").length,
      failedCount: (record.strategyResults || []).filter((result) => result.executionStatus === "failed").length,
      invalidCount: (record.strategyResults || []).filter((result) => result.executionStatus === "invalid").length,
    })),
  };
}
