import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { shellQuote } from "../lib/shell-quote.mjs";
import {
  defaultRunCommand,
  parseWhitelistedRefreshCommand,
  runParsedRefreshSteps,
} from "../session/shadow-refresh-runner.mjs";

export const DEFAULT_CURRENT_ROUTE_PRELIVE_ALLOWED_SCRIPTS = new Set([
  "run:connected-refresh-package",
  "run:prelive-simulations",
  "plan:prelive-fork-execution",
  "build:prelive-decision-pack",
  "status:dashboard",
]);

export const DEFAULT_CURRENT_ROUTE_PRELIVE_SYNC_COMMAND =
  "npm run build:prelive-decision-pack && npm run status:dashboard -- --skip-shadow-cycle";
export const DEFAULT_CURRENT_ROUTE_CONNECTED_REFRESH_COMMAND =
  "npm run run:connected-refresh-package -- --execute --continue-on-failure";

function routeFromContext(context = null) {
  const route =
    context?.exactRouteForkPackage?.currentRoute ||
    context?.executionRunbook?.currentRoute ||
    context?.connectedRefreshPackage?.currentRoute ||
    context?.reviewPackage?.manualReviewCandidate ||
    null;
  if (!route) return null;
  return {
    routeKey: route.routeKey || null,
    routeLabel: route.routeLabel || route.label || null,
    amount: route.amount || null,
    tradeReadiness: route.tradeReadiness || null,
  };
}

function connectedRefreshFromContext(context = null) {
  const summary = context?.connectedRefreshPackage?.summary || context?.connectedRefreshPackage || null;
  return {
    status: context?.connectedRefreshPackage?.status || summary?.status || null,
    requiredRefreshCount: summary?.requiredRefreshCount ?? context?.connectedRefreshPackage?.requiredRefreshes?.length ?? 0,
    blockedInputCount: summary?.blockedInputCount ?? context?.connectedRefreshPackage?.blockedInputs?.length ?? 0,
    nextActionCode: summary?.nextActionCode || context?.connectedRefreshPackage?.nextAction?.code || null,
    nextActionCommand: summary?.nextActionCommand || context?.connectedRefreshPackage?.nextAction?.command || null,
    fullCommandChain: summary?.fullCommandChain || null,
  };
}

function exactRouteForkFromContext(context = null) {
  const forkPackage = context?.exactRouteForkPackage || null;
  return {
    status: forkPackage?.status || null,
    planId: forkPackage?.plan?.planId || null,
    technicalStatus: forkPackage?.readiness?.technicalStatus || null,
    economicStatus: forkPackage?.readiness?.economicStatus || null,
    submitCommand: forkPackage?.commands?.submit || null,
    reconcileCommand: forkPackage?.commands?.reconcile || null,
    simulationSuccessCount: forkPackage?.simulation?.successCount ?? 0,
    simulationTargetCount: forkPackage?.simulation?.targetSuccessCount ?? 0,
    simulationSuccessRemaining: forkPackage?.simulation?.successRemaining ?? 0,
    forkConfirmedCount: forkPackage?.forkHistory?.confirmedCount ?? 0,
    forkTargetCount: forkPackage?.forkHistory?.targetConfirmedCount ?? 0,
    forkSuccessRemaining: forkPackage?.forkHistory?.successRemaining ?? 0,
  };
}

function effectiveSimulationLimit(remaining, requested) {
  const safeRemaining = Number.isFinite(remaining) && remaining > 0 ? Math.floor(remaining) : 0;
  if (safeRemaining <= 0) return 0;
  if (!Number.isFinite(requested) || requested <= 0) return safeRemaining;
  return Math.min(safeRemaining, Math.floor(requested));
}

function simulationCommand(route, remaining, requested, targetSuccessCount = 50) {
  const limit = effectiveSimulationLimit(remaining, requested);
  if (!route?.routeKey || !route?.amount || limit <= 0) return null;
  return [
    "npm run run:prelive-simulations --",
    `--route-key=${shellQuote(route.routeKey)}`,
    `--amount=${shellQuote(route.amount)}`,
    "--write",
    `--limit=${shellQuote(limit)}`,
    `--target-success-count=${shellQuote(targetSuccessCount)}`,
  ].join(" ");
}

function exactRouteForkPlanCommand(route) {
  if (!route?.routeKey || !route?.amount) return null;
  return [
    "npm run plan:prelive-fork-execution --",
    `--route-key=${shellQuote(route.routeKey)}`,
    `--amount=${shellQuote(route.amount)}`,
    "--write",
  ].join(" ");
}

function step({ code, label, status, command = null, reason = null }) {
  return { code, label, status, command, reason };
}

function statusForPass({ route = null, connectedRefresh = null, exactRouteFork = null } = {}) {
  if (!route?.routeKey || !route?.amount) return "missing_route_context";
  if ((connectedRefresh?.requiredRefreshCount || 0) > 0) return "connected_refresh_required";
  if ((connectedRefresh?.blockedInputCount || 0) > 0) return connectedRefresh?.status || "blocked_nonrefreshable_input";
  if (exactRouteFork?.economicStatus && exactRouteFork.economicStatus !== "eligible_for_manual_review") {
    return exactRouteFork.economicStatus;
  }
  if ((exactRouteFork?.simulationSuccessRemaining || 0) > 0) return "exact_simulation_required";
  if (exactRouteFork?.technicalStatus !== "submit_ready") return exactRouteFork?.technicalStatus || "exact_route_plan_not_ready";
  if ((exactRouteFork?.forkSuccessRemaining || 0) > 0) return "ready_for_external_signer";
  return "fork_cycle_proven";
}

function nextActionForPass({ route = null, connectedRefresh = null, exactRouteFork = null, simulationLimit = null } = {}) {
  if (!route?.routeKey || !route?.amount) {
    return {
      code: "missing_route_context",
      label: "resolve missing exact-route context",
      command: null,
    };
  }
  if ((connectedRefresh?.requiredRefreshCount || 0) > 0) {
    return {
      code: "execute_connected_refresh",
      label: "execute connected refresh package",
      command: DEFAULT_CURRENT_ROUTE_CONNECTED_REFRESH_COMMAND,
    };
  }
  if ((connectedRefresh?.blockedInputCount || 0) > 0) {
    return {
      code: connectedRefresh?.nextActionCode || "hold_blocked_connected_input",
      label: "hold because a connected input is currently blocked",
      command: null,
    };
  }
  if (exactRouteFork?.economicStatus && exactRouteFork.economicStatus !== "eligible_for_manual_review") {
    return {
      code: "hold_negative_edge",
      label: "stop because current exact route is still economically blocked",
      command: null,
    };
  }
  if ((exactRouteFork?.simulationSuccessRemaining || 0) > 0) {
    return {
      code: "collect_exact_route_simulations",
      label: "collect remaining exact-route simulations",
      command: simulationCommand(
        route,
        exactRouteFork.simulationSuccessRemaining,
        simulationLimit,
        exactRouteFork.simulationTargetCount || 50,
      ),
    };
  }
  if (exactRouteFork?.technicalStatus !== "submit_ready") {
    return {
      code: "refresh_exact_route_fork_plan",
      label: "refresh exact-route fork plan",
      command: exactRouteForkPlanCommand(route),
    };
  }
  if ((exactRouteFork?.forkSuccessRemaining || 0) > 0) {
    return {
      code: "await_external_signer",
      label: "await externally signed fork submission",
      command: exactRouteFork?.submitCommand || null,
    };
  }
  return {
    code: "review_reconciled_fork_cycles",
    label: "review reconciled fork cycles",
    command: exactRouteFork?.reconcileCommand || null,
  };
}

export function buildCurrentRoutePrelivePass({ context = null, simulationLimit = null, now = null } = {}) {
  const generatedAt = now || context?.dashboardStatus?.generatedAt || new Date().toISOString();
  const route = routeFromContext(context);
  const connectedRefresh = connectedRefreshFromContext(context);
  const exactRouteFork = exactRouteForkFromContext(context);
  const recommendedSimulationLimit = effectiveSimulationLimit(
    exactRouteFork.simulationSuccessRemaining,
    simulationLimit,
  );
  const status = statusForPass({ route, connectedRefresh, exactRouteFork });
  const nextAction = nextActionForPass({ route, connectedRefresh, exactRouteFork, simulationLimit });

  return {
    schemaVersion: 1,
    generatedAt,
    status,
    route,
    connectedRefresh,
    exactRouteFork,
    recommendedSimulationLimit,
    runnerCommand: "npm run run:current-route-prelive-pass -- --execute",
    syncCommand: DEFAULT_CURRENT_ROUTE_PRELIVE_SYNC_COMMAND,
    nextAction,
    steps: [
      step({
        code: "execute_connected_refresh",
        label: "execute connected refresh package",
        status:
          (connectedRefresh.requiredRefreshCount || 0) > 0
            ? "ready"
            : (connectedRefresh.blockedInputCount || 0) > 0
              ? "blocked"
              : "done",
        command: DEFAULT_CURRENT_ROUTE_CONNECTED_REFRESH_COMMAND,
        reason:
          (connectedRefresh.requiredRefreshCount || 0) > 0
            ? connectedRefresh.status || "connected_refresh_required"
            : (connectedRefresh.blockedInputCount || 0) > 0
              ? connectedRefresh.status || "blocked_nonrefreshable_input"
              : "fresh_inputs_present",
      }),
      step({
        code: "collect_exact_route_simulations",
        label: "collect exact-route simulations",
        status:
          !route?.routeKey || !route?.amount
            ? "blocked"
            : (connectedRefresh.requiredRefreshCount || 0) > 0
              ? "conditional"
              : (connectedRefresh.blockedInputCount || 0) > 0
                ? "blocked"
              : exactRouteFork.economicStatus && exactRouteFork.economicStatus !== "eligible_for_manual_review"
                ? "blocked"
                : (exactRouteFork.simulationSuccessRemaining || 0) > 0
                  ? "ready"
                  : "done",
        command: simulationCommand(
          route,
          exactRouteFork.simulationSuccessRemaining,
          simulationLimit,
          exactRouteFork.simulationTargetCount || 50,
        ),
        reason:
          (connectedRefresh.requiredRefreshCount || 0) > 0
            ? "refresh_first"
            : (connectedRefresh.blockedInputCount || 0) > 0
              ? connectedRefresh.status || "blocked_nonrefreshable_input"
            : exactRouteFork.economicStatus && exactRouteFork.economicStatus !== "eligible_for_manual_review"
              ? exactRouteFork.economicStatus
              : (exactRouteFork.simulationSuccessRemaining || 0) > 0
                ? "simulation_target_remaining"
                : "simulation_target_reached",
      }),
      step({
        code: "refresh_exact_route_fork_plan",
        label: "refresh exact-route fork plan",
        status:
          !route?.routeKey || !route?.amount
            ? "blocked"
            : (connectedRefresh.blockedInputCount || 0) > 0
                ? "blocked"
                : (connectedRefresh.requiredRefreshCount || 0) > 0 || (exactRouteFork.simulationSuccessRemaining || 0) > 0
                  ? "conditional"
              : exactRouteFork.economicStatus && exactRouteFork.economicStatus !== "eligible_for_manual_review"
                ? "blocked"
                : exactRouteFork.technicalStatus !== "submit_ready"
                  ? "ready"
                  : "done",
        command: exactRouteForkPlanCommand(route),
        reason:
          (connectedRefresh.requiredRefreshCount || 0) > 0
            ? "refresh_first"
            : (connectedRefresh.blockedInputCount || 0) > 0
              ? connectedRefresh.status || "blocked_nonrefreshable_input"
            : (exactRouteFork.simulationSuccessRemaining || 0) > 0
              ? "simulation_first"
              : exactRouteFork.economicStatus && exactRouteFork.economicStatus !== "eligible_for_manual_review"
                ? exactRouteFork.economicStatus
                : exactRouteFork.technicalStatus !== "submit_ready"
                  ? exactRouteFork.technicalStatus || "exact_route_plan_not_ready"
                  : "fork_plan_ready",
      }),
      step({
        code: "sync_decision_pack",
        label: "sync decision pack and status",
        status: "ready",
        command: DEFAULT_CURRENT_ROUTE_PRELIVE_SYNC_COMMAND,
        reason: "operator_surfaces_must_match_latest_state",
      }),
      step({
        code: "await_external_signer",
        label: "await externally signed fork submission",
        status:
          !route?.routeKey || !route?.amount
            ? "blocked"
            : (connectedRefresh.blockedInputCount || 0) > 0
                ? "blocked"
                : (connectedRefresh.requiredRefreshCount || 0) > 0 || (exactRouteFork.simulationSuccessRemaining || 0) > 0
                  ? "conditional"
              : exactRouteFork.economicStatus && exactRouteFork.economicStatus !== "eligible_for_manual_review"
                ? "blocked"
                : exactRouteFork.technicalStatus !== "submit_ready"
                  ? "conditional"
                  : (exactRouteFork.forkSuccessRemaining || 0) > 0
                    ? "manual"
                    : "done",
        command: exactRouteFork.submitCommand || null,
        reason:
          (connectedRefresh.blockedInputCount || 0) > 0
            ? connectedRefresh.status || "blocked_nonrefreshable_input"
            : exactRouteFork.technicalStatus !== "submit_ready"
            ? exactRouteFork.technicalStatus || "exact_route_plan_not_ready"
            : (exactRouteFork.forkSuccessRemaining || 0) > 0
              ? "external_signer_required"
              : "fork_cycle_already_proven",
      }),
    ],
    notes: [
      "This pass stays pre-live: it may refresh connected inputs, collect exact-route evidence, and refresh exact-route fork planning, but it must stop before any external signer submission.",
      "If the exact route remains blocked_no_net_edge after connected refresh, the pass stops there instead of forcing simulations or fork preparation.",
      "The pass uses the exact current route, not the objective-route shortlist, to avoid mixing selection and execution contexts.",
    ],
  };
}

function summarizeExecution(command, result, stage) {
  return {
    code: stage.code || null,
    label: stage.label || null,
    command,
    scripts: result.steps.map((entry) => entry.script),
    executionStatus: result.executionStatus,
    steps: result.steps,
  };
}

function latestPassFromRecord(record) {
  return record?.finalPass || record?.initialPass || null;
}

function statusForRecord(record) {
  return record?.finalStatus || record?.executionStatus || record?.mode || null;
}

async function executeStage(stage, { cwd, env, runCommand, allowedScripts, record, stopOnFailure }) {
  const steps = parseWhitelistedRefreshCommand(stage.command, { allowedScripts });
  const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
  record.stageResults.push(summarizeExecution(stage.command, result, stage));
  if (stopOnFailure && result.executionStatus !== "succeeded") {
    record.executionStatus = "failed";
    record.finalStatus = "failed";
    record.stopReason = `${stage.code || "stage"}_failed`;
    return false;
  }
  return true;
}

export async function executeCurrentRoutePrelivePass({
  pass = null,
  initialContext = null,
  buildContext = null,
  execute = false,
  simulationLimit = null,
  stopOnFailure = true,
  cwd = process.cwd(),
  env = process.env,
  runCommand = defaultRunCommand,
  allowedScripts = DEFAULT_CURRENT_ROUTE_PRELIVE_ALLOWED_SCRIPTS,
  syncCommand = DEFAULT_CURRENT_ROUTE_PRELIVE_SYNC_COMMAND,
  now = new Date().toISOString(),
} = {}) {
  let currentContext = initialContext || null;
  let currentPass = pass || buildCurrentRoutePrelivePass({ context: currentContext, simulationLimit, now });
  const runId = `${new Date(now).toISOString()}-${Math.random().toString(16).slice(2, 10)}`;
  const record = {
    schemaVersion: 1,
    observedAt: now,
    runId,
    mode: execute ? "execute" : "preview",
    stopOnFailure,
    requestedSimulationLimit: Number.isFinite(simulationLimit) ? Math.max(1, Math.floor(simulationLimit)) : null,
    initialPass: currentPass,
    stageResults: [],
    executionStatus: execute ? "succeeded" : "preview",
    finalStatus: currentPass?.status || null,
    stopReason: null,
    finalPass: currentPass,
    submitCommand: currentPass?.exactRouteFork?.submitCommand || null,
  };

  if (!execute) return record;

  const refreshPass = async () => {
    if (!buildContext) return currentPass;
    currentContext = await buildContext();
    currentPass = buildCurrentRoutePrelivePass({ context: currentContext, simulationLimit });
    record.finalPass = currentPass;
    record.finalStatus = currentPass?.status || record.finalStatus;
    record.submitCommand = currentPass?.exactRouteFork?.submitCommand || record.submitCommand;
    return currentPass;
  };

  const syncArtifacts = async () => {
    if (!syncCommand) return true;
    const ok = await executeStage(
      {
        code: "sync_decision_pack",
        label: "sync decision pack and status",
        command: syncCommand,
      },
      { cwd, env, runCommand, allowedScripts, record, stopOnFailure },
    );
    if (ok) await refreshPass();
    return ok;
  };

  if (!currentPass?.route?.routeKey || !currentPass?.route?.amount) {
    record.executionStatus = "blocked";
    record.finalStatus = "missing_route_context";
    record.stopReason = "missing_route_context";
    return record;
  }

  if ((currentPass.connectedRefresh?.requiredRefreshCount || 0) > 0) {
    const ok = await executeStage(
      {
        code: "execute_connected_refresh",
        label: "execute connected refresh package",
        command: DEFAULT_CURRENT_ROUTE_CONNECTED_REFRESH_COMMAND,
      },
      { cwd, env, runCommand, allowedScripts, record, stopOnFailure },
    );
    if (!ok) return record;
    await refreshPass();
  }

  if ((currentPass.connectedRefresh?.requiredRefreshCount || 0) > 0) {
    const ok = await syncArtifacts();
    if (!ok) return record;
    record.executionStatus = "blocked";
    record.finalStatus = "connected_refresh_still_required";
    record.stopReason = "connected_refresh_still_required";
    return record;
  }

  if ((currentPass.connectedRefresh?.blockedInputCount || 0) > 0) {
    const ok = await syncArtifacts();
    if (!ok) return record;
    record.executionStatus = "blocked";
    record.finalStatus = currentPass.connectedRefresh?.status || "blocked_nonrefreshable_input";
    record.stopReason = currentPass.connectedRefresh?.status || "blocked_nonrefreshable_input";
    return record;
  }

  if (currentPass.exactRouteFork?.economicStatus && currentPass.exactRouteFork.economicStatus !== "eligible_for_manual_review") {
    const ok = await syncArtifacts();
    if (!ok) return record;
    record.executionStatus = "blocked";
    record.finalStatus = currentPass.exactRouteFork.economicStatus;
    record.stopReason = currentPass.exactRouteFork.economicStatus;
    return record;
  }

  if ((currentPass.exactRouteFork?.simulationSuccessRemaining || 0) > 0) {
    const command = simulationCommand(
      currentPass.route,
      currentPass.exactRouteFork.simulationSuccessRemaining,
      simulationLimit,
      currentPass.exactRouteFork.simulationTargetCount || 50,
    );
    if (command) {
      const ok = await executeStage(
        {
          code: "collect_exact_route_simulations",
          label: "collect exact-route simulations",
          command,
        },
        { cwd, env, runCommand, allowedScripts, record, stopOnFailure },
      );
      if (!ok) return record;
      await refreshPass();
    }
  }

  if ((currentPass.exactRouteFork?.simulationSuccessRemaining || 0) > 0) {
    const ok = await syncArtifacts();
    if (!ok) return record;
    record.executionStatus = "partial";
    record.finalStatus = "simulation_runway_remaining";
    record.stopReason = "simulation_runway_remaining";
    return record;
  }

  if (currentPass.exactRouteFork?.technicalStatus !== "submit_ready") {
    const command = exactRouteForkPlanCommand(currentPass.route);
    if (command) {
      const ok = await executeStage(
        {
          code: "refresh_exact_route_fork_plan",
          label: "refresh exact-route fork plan",
          command,
        },
        { cwd, env, runCommand, allowedScripts, record, stopOnFailure },
      );
      if (!ok) return record;
      await refreshPass();
    }
  }

  const ok = await syncArtifacts();
  if (!ok) return record;

  if (currentPass.exactRouteFork?.technicalStatus !== "submit_ready") {
    record.executionStatus = "blocked";
    record.finalStatus = currentPass.exactRouteFork?.technicalStatus || "exact_route_plan_not_ready";
    record.stopReason = currentPass.exactRouteFork?.technicalStatus || "exact_route_plan_not_ready";
    return record;
  }

  record.executionStatus = "succeeded";
  record.finalStatus = currentPass?.status || "ready_for_external_signer";
  record.stopReason = null;
  record.submitCommand = currentPass?.exactRouteFork?.submitCommand || record.submitCommand;
  return record;
}

export function buildCurrentRoutePrelivePassSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
  const latest = sorted[0] || null;
  const executeRecords = sorted.filter((item) => item.mode === "execute");
  const previewCount = sorted.filter((item) => item.mode === "preview").length;
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: executeRecords.length,
    previewCount,
    readyForSignerCount: executeRecords.filter((item) => statusForRecord(item) === "ready_for_external_signer").length,
    provenCount: executeRecords.filter((item) => statusForRecord(item) === "fork_cycle_proven").length,
    blockedCount: executeRecords.filter((item) => item.executionStatus === "blocked").length,
    partialCount: executeRecords.filter((item) => item.executionStatus === "partial").length,
    failureCount: executeRecords.filter((item) => item.executionStatus === "failed").length,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: statusForRecord(latest),
    latestMode: latest?.mode || null,
    latestStopReason: latest?.stopReason || null,
    nextAction: latestPassFromRecord(latest)?.nextAction || null,
    submitCommand: latest?.submitCommand || latestPassFromRecord(latest)?.exactRouteFork?.submitCommand || null,
    recentRuns: sorted.slice(0, 5).map((item) => ({
      observedAt: item.observedAt,
      runId: item.runId,
      mode: item.mode,
      executionStatus: item.executionStatus,
      finalStatus: statusForRecord(item),
      stopReason: item.stopReason || null,
      stageResultCount: item.stageResults?.length || 0,
    })),
  };
}

export async function persistCurrentRoutePrelivePassRun({
  dataDir,
  record,
  writeSummary = false,
  summaryPath,
} = {}) {
  if (!dataDir || !record) return null;
  const store = new JsonlStore(dataDir);
  await store.append("current-route-prelive-passes", record);
  const records = await readJsonl(dataDir, "current-route-prelive-passes");
  const summary = buildCurrentRoutePrelivePassSummary(records);
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
