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
  "executor:gateway-btc-consolidation",
  "executor:gateway-btc-offramp",
  "executor:gateway-btc-onramp",
  "executor:live-canary-sweep",
  "executor:merkl-canary-autopilot",
  "executor:wrapped-btc-loop",
  "executor:native-dex-experiment",
  "executor:payback-scheduler",
  "executor:token-dex-experiment",
  "flash:dryrun",
  "report:btc-proxy-spreads",
  "report:merkl-canary-queue",
  "report:lane-reclassification",
  "report:secondary-strategy-scaffolds",
  "report:stable-loop-executor",
  "report:wrapped-btc-loop",
  "report:wrapped-btc-loop-dry-run",
  "report:strategy-execution-surfaces",
  "report:strategy-snapshot",
  "score:gateway",
  "status:dashboard",
  "status:dashboard:light",
  "trigger:arb",
]);

export const DEFAULT_STRATEGY_DISPATCH_FOLLOW_UP_COMMANDS = [
  "npm run status:dashboard:light",
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

function advisoryMetadata(strategy = {}) {
  return {
    surfaceLiveEligible: Boolean(strategy.currentLiveEligible),
    adviceCode: strategy.adviceCode || strategy.liveAdmissionBlockers?.[0] || strategy.fallbackReason || null,
    adviceFields: strategy.adviceFields || ["liveAdmissionBlockers", "fallbackReason", "currentLiveEligible"],
  };
}

function uniqueStrings(items = []) {
  return Array.from(new Set(
    items
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  ));
}

function buildBroadcastReadiness(strategy = {}, selection = {}, {
  blockedReason = null,
  guardReasons = [],
  selectedStepCount = null,
} = {}) {
  const policyDispatchBlockers = uniqueStrings([
    blockedReason,
    ...guardReasons,
  ]);
  const selectedMode = normalizeRequestedMode(selection.mode || null);
  const readyForPolicyDispatch = policyDispatchBlockers.length === 0 && selectedStepCount !== 0;
  const liveSelectionHasRuntimeAuthority =
    selectedMode === "live" && (strategy.currentLiveEligible === true || selection.runtimeEmitDecision === true);
  return {
    schemaVersion: 1,
    readyForPolicyDispatch,
    readyForLiveBroadcast: readyForPolicyDispatch && liveSelectionHasRuntimeAuthority,
    policyDispatchBlockers,
    requestedMode: normalizeRequestedMode(selection.requestedMode || null),
    selectedMode,
    selectedStepCount,
    runtimeGateAuthority: strategy.runtimeGateAuthority || "policy_engine_only",
    policyAuthority: "policy_engine_only",
    signerAuthority: "signer_daemon_after_policy_approval",
    advisoryEvidence: {
      currentLiveEligible: Boolean(strategy.currentLiveEligible),
      liveAdmissionBlockers: Array.isArray(strategy.liveAdmissionBlockers)
        ? strategy.liveAdmissionBlockers
        : [],
      fallbackReason: strategy.fallbackReason || null,
      adviceCode: strategy.adviceCode || strategy.liveAdmissionBlockers?.[0] || strategy.fallbackReason || null,
      runtimeBlocking: false,
    },
  };
}

function policyOk(policyResult = null, runtime = {}) {
  if (typeof runtime.policyOk === "boolean") return runtime.policyOk;
  if (!policyResult || typeof policyResult !== "object") return false;
  if (typeof policyResult.ok === "boolean") return policyResult.ok;
  return policyResult.decision === "ALLOW";
}

function runtimeEmitDecision(strategy = {}) {
  const runtime = strategy.runtime || {};
  const hasRuntimeInputs =
    "autoExecute" in runtime ||
    "capsConfigured" in runtime ||
    "policyOk" in runtime ||
    "policyResult" in runtime ||
    "killSwitchSet" in runtime ||
    "consecutiveFailureLock" in runtime;
  if (!hasRuntimeInputs) {
    return {
      hasRuntimeInputs: false,
      ok: false,
      blocker: null,
    };
  }
  const autoExecute = runtime.autoExecute === true;
  const capsConfigured = runtime.capsConfigured === true;
  const ok = policyOk(runtime.policyResult || strategy.policyResult || null, runtime);
  const killSwitchSet = runtime.killSwitchSet === true;
  const consecutiveFailureLock = runtime.consecutiveFailureLock === true;
  let blocker = null;
  if (!autoExecute) blocker = "auto_execute_off";
  else if (!capsConfigured) blocker = "missing_caps";
  else if (!ok) blocker = "policy_reject";
  else if (killSwitchSet) blocker = "kill_switch";
  else if (consecutiveFailureLock) blocker = "consecutive_failure_lock";
  return {
    hasRuntimeInputs,
    ok: blocker === null,
    blocker,
    autoExecute,
    capsConfigured,
    policyOk: ok,
    killSwitchSet,
    consecutiveFailureLock,
  };
}

function requestedCommandsForStrategy(strategy, requestedMode, { execute = false } = {}) {
  const mode = normalizeRequestedMode(requestedMode);
  if (mode === "auto") {
    return {
      mode: strategy.selectedMode,
      commands: strategy.selectedCommands || [],
      blockedReason: null,
      runtimeEmitDecision: null,
    };
  }

  if (mode === "live") {
    const runtime = runtimeEmitDecision(strategy);
    if (runtime.hasRuntimeInputs && runtime.ok) {
      return {
        mode,
        commands: strategy.liveCommands || strategy.selectedCommands || [],
        blockedReason: null,
        runtimeEmitDecision: true,
        runtimeDecisionDetail: runtime,
      };
    }
    if (runtime.hasRuntimeInputs) {
      return {
        mode,
        commands: [],
        blockedReason: runtime.blocker || "policy_reject",
        runtimeEmitDecision: false,
        runtimeDecisionDetail: runtime,
      };
    }
    if (!execute && strategy.reportingOnly === true && strategy.runtimeGateAuthority === "policy_engine_only") {
      return {
        mode,
        commands: strategy.selectedCommands || [],
        blockedReason: null,
        runtimeEmitDecision: null,
        runtimeDecisionDetail: null,
      };
    }
  }

  if (mode === strategy.selectedMode) {
    return {
      mode,
      commands: strategy.selectedCommands || [],
      blockedReason: null,
      runtimeEmitDecision: null,
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
      blockedReason:
        mode === "live" && Array.isArray(strategy.liveAdmissionBlockers) && strategy.liveAdmissionBlockers.length
          ? strategy.liveAdmissionBlockers[0]
          : "requested_mode_not_supported",
    };
  }
  return {
    mode,
    commands,
    blockedReason: null,
    runtimeEmitDecision: null,
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

function normalizeOrchestration(orchestration = null) {
  if (!orchestration || typeof orchestration !== "object") return null;
  return {
    source: orchestration.source || "strategy_catalog_dispatcher",
    runId: orchestration.runId || null,
  };
}

function shouldUseLightDashboardStatus({ execute = false, orchestration = null } = {}) {
  return execute && normalizeOrchestration(orchestration)?.source === "all_chain_autopilot";
}

function normalizeDashboardStatusSteps(steps = [], { mode = "preserve" } = {}) {
  if (mode === "omit") return (steps || []).filter((step) => step.script !== "status:dashboard");
  if (mode !== "light") return steps;
  return (steps || []).map((step) => {
    if (step.script !== "status:dashboard") return step;
    return {
      ...step,
      segment: "npm run status:dashboard:light",
      script: "status:dashboard:light",
      args: ["run", "status:dashboard:light"],
      tokens: ["npm", "run", "status:dashboard:light"],
    };
  });
}

function buildDispatchCommandEnv({
  env = process.env,
  dispatchId,
  requestedMode,
  selectedMode,
  execute = false,
  orchestration = null,
  strategy = null,
  phase = "strategy",
} = {}) {
  const normalizedOrchestration = normalizeOrchestration(orchestration);
  const nextEnv = {
    ...env,
    BOB_DISPATCH_ID: dispatchId,
    BOB_DISPATCH_EXECUTION_MODE: execute ? "execute" : "preview",
    BOB_DISPATCH_REQUESTED_MODE: normalizeRequestedMode(requestedMode),
    BOB_DISPATCH_SELECTED_MODE: normalizeRequestedMode(selectedMode),
    BOB_DISPATCH_PHASE: phase,
  };
  if (normalizedOrchestration?.source) nextEnv.BOB_ORCHESTRATION_SOURCE = normalizedOrchestration.source;
  if (normalizedOrchestration?.runId) nextEnv.BOB_ORCHESTRATION_RUN_ID = normalizedOrchestration.runId;
  if (strategy?.id) nextEnv.BOB_STRATEGY_ID = strategy.id;
  if (strategy?.lane) nextEnv.BOB_STRATEGY_LANE = strategy.lane;
  return nextEnv;
}

async function executeStrategyItem(
  strategy,
  {
    execute = false,
    requestedMode = "auto",
    dispatchId,
    orchestration = null,
    cwd = process.cwd(),
    env = process.env,
    runCommand = defaultRunCommand,
    allowedScripts = DEFAULT_ALLOWED_STRATEGY_DISPATCH_SCRIPTS,
    readGuards = readExecutionGuards,
  } = {},
) {
  const selection = requestedCommandsForStrategy(strategy, requestedMode, { execute });
  selection.requestedMode = requestedMode;
  const normalizedOrchestration = normalizeOrchestration(orchestration);
  const base = {
    dispatchId,
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
    liveAdmissionBlockers: Array.isArray(strategy.liveAdmissionBlockers) ? strategy.liveAdmissionBlockers : [],
    fallbackReason: strategy.fallbackReason || null,
    scripts: scriptsForCommands(selection.commands),
    orchestration: normalizedOrchestration,
    runtimeEmitDecision: selection.runtimeEmitDecision,
    runtimeDecisionDetail: selection.runtimeDecisionDetail || null,
    metadata: {
      advisory: advisoryMetadata(strategy),
    },
  };

  if (selection.blockedReason) {
    return {
      ...base,
      executionStatus: "blocked",
      broadcastReadiness: buildBroadcastReadiness(strategy, selection, {
        blockedReason: selection.blockedReason,
        selectedStepCount: 0,
      }),
      stepCount: 0,
      steps: [],
    };
  }

  let steps;
  try {
    steps = selection.commands.flatMap((command) => parseWhitelistedRefreshCommand(command.command, { allowedScripts }));
    steps = normalizeDashboardStatusSteps(steps, {
      mode: shouldUseLightDashboardStatus({ execute, orchestration: normalizedOrchestration }) ? "omit" : "preserve",
    });
  } catch (error) {
    return {
      ...base,
      executionStatus: "invalid",
      blockedReason: error.message,
      broadcastReadiness: buildBroadcastReadiness(strategy, selection, {
        blockedReason: error.message,
        selectedStepCount: 0,
      }),
      stepCount: 0,
      steps: [],
    };
  }

  if (steps.length === 0) {
    return {
      ...base,
      executionStatus: "blocked",
      blockedReason: base.blockedReason || "no_commands_selected",
      broadcastReadiness: buildBroadcastReadiness(strategy, selection, {
        blockedReason: base.blockedReason || "no_commands_selected",
        selectedStepCount: 0,
      }),
      stepCount: 0,
      steps: [],
    };
  }

  if (!execute) {
    return {
      ...base,
      executionStatus: "preview",
      guardReasons: [],
      broadcastReadiness: buildBroadcastReadiness(strategy, selection, {
        selectedStepCount: steps.length,
      }),
      stepCount: steps.length,
      steps: previewSteps(steps),
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
      broadcastReadiness: buildBroadcastReadiness(strategy, selection, {
        blockedReason: guards.reasons[0] || "execution_guard_blocked",
        guardReasons: guards.reasons || [],
        selectedStepCount: steps.length,
      }),
      stepCount: steps.length,
      steps: previewSteps(steps),
    };
  }

  const executed = await runParsedRefreshSteps(steps, {
    cwd,
    env: buildDispatchCommandEnv({
      env,
      dispatchId,
      requestedMode,
      selectedMode: selection.mode,
      execute,
      orchestration: normalizedOrchestration,
      strategy,
    }),
    runCommand: async (details) => runCommand({ ...details, strategy }),
  });
  return {
    ...base,
    executionStatus: executed.executionStatus,
    guardReasons: guards.reasons || [],
    broadcastReadiness: buildBroadcastReadiness(strategy, selection, {
      selectedStepCount: steps.length,
    }),
    stepCount: steps.length,
    steps: executed.steps,
  };
}

async function executeFollowUpCommands(
  commands,
  {
    execute = false,
    dispatchId,
    requestedMode = "auto",
    orchestration = null,
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
      steps = normalizeDashboardStatusSteps(steps, {
        mode: shouldUseLightDashboardStatus({ execute, orchestration }) ? "light" : "preserve",
      });
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
      env: buildDispatchCommandEnv({
        env,
        dispatchId,
        requestedMode,
        selectedMode: "follow_up",
        execute,
        orchestration,
        phase: "follow_up",
      }),
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
  dispatchId = randomUUID(),
  orchestration = null,
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
  const normalizedOrchestration = normalizeOrchestration(orchestration);
  for (const strategy of strategies) {
    const result = await executeStrategyItem(strategy, {
      execute,
      requestedMode,
      dispatchId,
      orchestration: normalizedOrchestration,
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
          dispatchId,
          requestedMode,
          orchestration: normalizedOrchestration,
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
    dispatchId,
    orchestration: normalizedOrchestration,
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
