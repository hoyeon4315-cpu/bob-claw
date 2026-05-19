#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";
import { buildAggressiveVelocityStatus } from "./report-aggressive-velocity-status.mjs";
import { overlayAggressiveVelocityExecutionSurface } from "./report-strategy-execution-surfaces.mjs";
import {
  buildAllChainAutopilotDashboardSlice,
  refillNeedsLiveRemediation,
  resolveAllChainAutopilotReport,
} from "../status/all-chain-autopilot-slice.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
const DEFAULT_CHILD_TIMEOUT_MS = 45_000;

export function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    strict: flags.has("--strict"),
    refresh: flags.has("--refresh"),
  };
}

function readinessChildTimeoutMs(env = process.env) {
  const parsed = Number(env.BOB_CLAW_READINESS_CHILD_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHILD_TIMEOUT_MS;
}

export function runJsonCli(scriptPath, args = [], { timeoutMs = readinessChildTimeoutMs() } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.error) {
    const timeout = result.error.code === "ETIMEDOUT";
    return {
      ok: false,
      status: result.status ?? null,
      signal: result.signal || null,
      stdout,
      stderr,
      json: null,
      error: timeout ? `timeout_after_${timeoutMs}ms` : result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status ?? 1,
      signal: result.signal || null,
      stdout,
      stderr,
      json: null,
      error: stderr.trim() || stdout.trim() || `exit ${result.status ?? 1}`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      signal: null,
      stdout,
      stderr,
      json: null,
      error: `invalid_json:${error.message}`,
    };
  }
  return {
    ok: true,
    status: 0,
    signal: null,
    stdout,
    stderr,
    json: parsed,
    error: null,
  };
}

export function runJsonCliAsync(scriptPath, args = [], { timeoutMs = readinessChildTimeoutMs() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      finish({
        ok: false,
        status: null,
        signal: "SIGTERM",
        stdout,
        stderr,
        json: null,
        error: `timeout_after_${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        stdout,
        stderr,
        json: null,
        error: error.message,
      });
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      if (status !== 0) {
        finish({
          ok: false,
          status: status ?? 1,
          signal: signal || null,
          stdout,
          stderr,
          json: null,
          error: stderr.trim() || stdout.trim() || `exit ${status ?? 1}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        finish({
          ok: true,
          status: 0,
          signal: signal || null,
          stdout,
          stderr,
          json: parsed,
          error: null,
        });
      } catch (error) {
        finish({
          ok: false,
          status: 0,
          signal: signal || null,
          stdout,
          stderr,
          json: null,
          error: `invalid_json:${error.message}`,
        });
      }
    });
  });
}

export async function collectReadinessDependencies({ refresh = false, runJsonCliImpl = runJsonCliAsync } = {}) {
  const refreshArgs = refresh ? ["--json", "--write"] : ["--json"];
  const [inbound, capitalManager, strategyDispatch, payback] = await Promise.all([
    runJsonCliImpl("src/cli/run-inbound-inventory-watcher.mjs", refreshArgs),
    runJsonCliImpl(
      "src/cli/plan-capital-manager-refill-jobs.mjs",
      refresh ? ["--json", "--write", "--refresh-inventory"] : ["--json"],
    ),
    runJsonCliImpl(
      "src/cli/run-strategy-catalog-dispatcher.mjs",
      refresh ? ["--json", "--write", "--mode=auto"] : ["--json", "--mode=auto"],
    ),
    runJsonCliImpl("src/cli/report-payback-status.mjs", ["--json"]),
  ]);
  return { inbound, capitalManager, strategyDispatch, payback };
}

function classifyRefillIssue(reason = null) {
  const text = String(reason || "").trim();
  if (!text) return "unknown";
  if (text === "routing_exhausted") return "routing_exhausted";
  if (
    /insufficient source balance|source_inventory_below_target_amount|source_inventory_reserved|source inventory|insufficient_funds|insufficient balance/iu.test(
      text,
    )
  ) {
    return "inventory_insufficient";
  }
  if (
    /insufficient_native_balance_for_lifi_gas|insufficient_native_balance_for_gas|insufficient_native_gas_balance|native gas|gas bootstrap/iu.test(
      text,
    )
  ) {
    return "native_gas";
  }
  if (/signer_execution_failed|Signer did not complete/iu.test(text)) {
    return "signer_execution_failed";
  }
  if (/no_route|bridge_pair_unsupported|route|router|routing/iu.test(text)) {
    return "route_unresolved";
  }
  return "execution_unresolved";
}

function refillBlockerDetails(blockers = []) {
  if (!Array.isArray(blockers)) return [];
  return blockers
    .map((item = {}) => {
      const reason = item.reason || null;
      return {
        chain: item.chain || null,
        asset: item.asset || null,
        reason,
        category: classifyRefillIssue(reason),
        selectedMethod: item.selectedMethod || null,
        stalePlannerMethod:
          item.stalePlannerMethod === true || item.stalePlannerMethod === false ? item.stalePlannerMethod : null,
      };
    })
    .filter((item) => item.reason)
    .slice(0, 8);
}

function liveAutomationRefillCounts(autopilot = null) {
  const refill = autopilot?.refill || {};
  return {
    refillBlockedCount: refill.blockedCount ?? null,
    refillUnresolvedCount: refill.unresolvedCount ?? null,
    refillManualBacklogCount: refill.manualBacklogCount ?? null,
    refillStaleSnapshotMethodCount: refill.staleSnapshotMethodCount ?? null,
    refillCurrentMethodBlockedCount: refill.currentMethodBlockedCount ?? null,
    refillAttemptedCount: refill.attemptedCount ?? null,
    refillExecutedCount: refill.executedCount ?? null,
  };
}

function countByCategory(items = []) {
  return items.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
}

function strategyLiveAdmissionBlockers(strategyDispatch = {}) {
  const strategies = strategyDispatch?.executionSurfaces?.strategies || [];
  if (!Array.isArray(strategies)) return [];
  const hasConcreteWrappedBtcLoop = strategies.some(
    (strategy) => String(strategy?.id || "") === "wrapped-btc-loop-base-moonwell",
  );
  const modeRank = new Map([
    ["live", 0],
    ["dry_run", 1],
    ["shadow", 2],
    ["analysis", 3],
  ]);
  return strategies
    .map((strategy = {}) => ({
      strategyId: strategy.id || null,
      selectedMode: strategy.selectedMode || null,
      status: strategy.status || null,
      reason: strategy.reason || null,
      blockers: Array.isArray(strategy.liveAdmissionBlockers) ? strategy.liveAdmissionBlockers.filter(Boolean) : [],
    }))
    .filter(
      (strategy) =>
        !(
          hasConcreteWrappedBtcLoop &&
          strategy.strategyId === "gateway_wrapped_btc_loops" &&
          strategy.blockers.includes("route_specific_executor_inputs_required")
        ),
    )
    .filter((strategy) => strategy.strategyId && strategy.blockers.length > 0)
    .sort((left, right) => {
      const leftWrapped = left.strategyId === "wrapped-btc-loop-base-moonwell" ? 0 : 1;
      const rightWrapped = right.strategyId === "wrapped-btc-loop-base-moonwell" ? 0 : 1;
      if (leftWrapped !== rightWrapped) return leftWrapped - rightWrapped;
      const leftMode = modeRank.get(left.selectedMode) ?? 99;
      const rightMode = modeRank.get(right.selectedMode) ?? 99;
      if (leftMode !== rightMode) return leftMode - rightMode;
      return String(left.strategyId || "").localeCompare(String(right.strategyId || ""));
    })
    .slice(0, 8);
}

export function buildFullAutomationReadiness({
  runtime,
  inbound,
  capitalManager,
  strategyDispatch,
  payback,
  autopilot,
  commandHealth = {},
} = {}) {
  const runtimeReady = runtime?.summary?.ready === true;
  const operatingCapitalIngressCount = inbound?.summary?.operatingCapitalIngressCount ?? 0;
  const paybackExcludedCount = inbound?.summary?.paybackExcludedCount ?? 0;
  const ingressIsolationReady = operatingCapitalIngressCount === paybackExcludedCount;
  const capitalPlanDecision = capitalManager?.capitalPlan?.decision || null;
  const capitalJobs = capitalManager?.jobs?.summary?.jobCount ?? 0;
  const autoRefillJobCount = capitalManager?.jobs?.jobs?.filter((job) => !job.requiresManualReview).length ?? 0;
  const dispatchBatchStatus = strategyDispatch?.record?.batchStatus || null;
  const liveEligibleCount = strategyDispatch?.executionSurfaces?.summary?.liveEligibleCount ?? 0;
  const merklCanaryReadyCount = autopilot?.merklCanary?.readyCount ?? autopilot?.execution?.merklCanaryReadyCount ?? 0;
  const merklCanarySelectedCount =
    autopilot?.merklCanary?.selectedCount ?? autopilot?.execution?.merklCanarySelectedCount ?? 0;
  const merklCanaryBlockedReason =
    autopilot?.merklCanary?.blockedReason || autopilot?.execution?.merklCanaryBlockedReason || null;
  const merklCanaryStatus = autopilot?.merklCanary?.status || null;
  const merklCanaryLiveLaneReady =
    merklCanaryReadyCount > 0 && !["failed", "invalid", "error"].includes(String(merklCanaryStatus || ""));
  const liveAutomationObserved = autopilot?.present === true;
  const activeLiveAutomationRun = autopilot?.activeRun === true;
  const refillBlockers = refillBlockerDetails(autopilot?.refill?.blockers || []);
  const refillIssueCounts = countByCategory(refillBlockers);
  const unresolvedRefillRoutes =
    liveAutomationObserved &&
    !activeLiveAutomationRun &&
    (refillBlockers.length > 0
      ? refillBlockers.some((item) => refillNeedsLiveRemediation(item))
      : (autopilot?.refill?.blockedCount ?? 0) > 0);
  const liveWatchReady =
    liveAutomationObserved &&
    !activeLiveAutomationRun &&
    !unresolvedRefillRoutes &&
    autopilot?.nextAction === "continue_live_watch" &&
    !["failed", "invalid", "error"].includes(String(autopilot?.status || ""));
  const paybackStatus = payback?.payback?.scheduler?.status || null;
  const paybackReason = payback?.payback?.scheduler?.reason || null;
  const paybackIsolationReady = ingressIsolationReady;
  const liveAdmissionBlockers = strategyLiveAdmissionBlockers(strategyDispatch);
  const dispatchReady =
    liveAdmissionBlockers.length === 0 &&
    (liveEligibleCount > 0 || merklCanaryLiveLaneReady || liveWatchReady) &&
    dispatchBatchStatus !== "failed" &&
    dispatchBatchStatus !== "invalid";
  const capitalAutomationReady =
    capitalPlanDecision === "BALANCED" ||
    capitalPlanDecision === "READY" ||
    capitalPlanDecision === "WATCH_ONLY" ||
    (capitalPlanDecision === "REFILL_REQUIRED" &&
      (autoRefillJobCount > 0 || (liveAutomationObserved && !unresolvedRefillRoutes)));
  const paybackReserveReady = paybackReason !== "reserve_asset_missing";
  const failedDependencyCommands = Object.entries(commandHealth)
    .filter(([, health]) => health?.ok === false)
    .map(([name]) => `dependency_command_failed:${name}`);

  const blockers = [
    ...failedDependencyCommands,
    ...(runtimeReady ? [] : ["runtime_not_ready"]),
    ...(ingressIsolationReady ? [] : ["operating_capital_not_isolated_from_payback"]),
    ...(capitalAutomationReady ? [] : ["capital_rebalancer_not_ready"]),
    ...(dispatchReady ? [] : ["strategy_dispatch_not_ready"]),
    ...(paybackIsolationReady ? [] : ["payback_isolation_not_ready"]),
    ...(activeLiveAutomationRun ? ["all_chain_autopilot_running"] : []),
    ...(unresolvedRefillRoutes ? ["refill_routes_unresolved"] : []),
    ...(paybackReserveReady ? [] : ["payback_reserve_missing"]),
  ];

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    status: blockers.length === 0 ? "ready" : "attention_required",
    ready: blockers.length === 0,
    blockers,
    runtime: {
      ready: runtimeReady,
      nextActionCode: runtime?.summary?.nextActionCode || null,
    },
    dependencyCommands: {
      failed: failedDependencyCommands,
      ready: failedDependencyCommands.length === 0,
    },
    ingress: {
      inboundEventCount: inbound?.summary?.inboundEventCount ?? 0,
      operatingCapitalIngressCount,
      paybackExcludedCount,
      ready: ingressIsolationReady,
    },
    capitalManager: {
      rebalanceDecision: capitalManager?.rebalancePlan?.decision || null,
      capitalPlanDecision,
      refillJobCount: capitalJobs,
      autoRefillJobCount,
      ready: capitalAutomationReady,
    },
    strategyDispatch: {
      batchStatus: dispatchBatchStatus,
      liveEligibleCount,
      merklCanaryReadyCount,
      merklCanarySelectedCount,
      merklCanaryBlockedReason,
      selectedCount: strategyDispatch?.record?.selectedCount ?? 0,
      liveAdmissionBlockers,
      ready: dispatchReady,
    },
    liveAutomation: {
      observed: liveAutomationObserved,
      activeRun: activeLiveAutomationRun,
      status: autopilot?.status || null,
      phase: autopilot?.phase || null,
      nextAction: autopilot?.nextAction || null,
      ...liveAutomationRefillCounts(autopilot),
      refillIssueCounts,
      refillBlockers,
      ready: !activeLiveAutomationRun && !unresolvedRefillRoutes,
    },
    payback: {
      status: paybackStatus,
      reason: paybackReason,
      isolationReady: paybackIsolationReady,
      ready: paybackIsolationReady && paybackReserveReady,
      nextAction: payback?.payback?.scheduler?.nextAction || null,
    },
    policyNote:
      "Operating capital ingress must stay isolated from payback; live dispatch still depends on policy/caps/kill-switch.",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [runtime, dependencyReports, aggressiveStatus] = await Promise.all([
    collectExecutorRuntimeReadiness(),
    collectReadinessDependencies({ refresh: args.refresh }),
    buildAggressiveVelocityStatus(),
  ]);
  const { inbound, capitalManager, strategyDispatch, payback } = dependencyReports;
  if (strategyDispatch.ok && strategyDispatch.json?.executionSurfaces) {
    strategyDispatch.json = {
      ...strategyDispatch.json,
      executionSurfaces: overlayAggressiveVelocityExecutionSurface(
        strategyDispatch.json.executionSurfaces,
        aggressiveStatus,
      ),
    };
  }
  const commandHealth = {
    inbound: { ok: inbound.ok, error: inbound.error },
    capitalManager: { ok: capitalManager.ok, error: capitalManager.error },
    strategyDispatch: { ok: strategyDispatch.ok, error: strategyDispatch.error },
    payback: { ok: payback.ok, error: payback.error },
  };
  const autopilotLatest = await readJsonIfExists(join(config.dataDir, "all-chain-autopilot-latest.json"));
  const autopilotLatestCompleted = await readJsonIfExists(
    join(config.dataDir, "all-chain-autopilot-latest-completed.json"),
  );
  const autopilot = buildAllChainAutopilotDashboardSlice(
    resolveAllChainAutopilotReport(autopilotLatest, autopilotLatestCompleted),
    { capitalManagerRefillJobsLatest: capitalManager.json },
  );

  const report = buildFullAutomationReadiness({
    runtime,
    inbound: inbound.json,
    capitalManager: capitalManager.json,
    strategyDispatch: strategyDispatch.json,
    payback: payback.json,
    autopilot,
    commandHealth,
  });
  report.commandHealth = commandHealth;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`status=${report.status}`);
    console.log(`ready=${report.ready}`);
    console.log(`runtimeReady=${report.runtime.ready}`);
    console.log(`ingressReady=${report.ingress.ready}`);
    console.log(`capitalManagerReady=${report.capitalManager.ready}`);
    console.log(`strategyDispatchReady=${report.strategyDispatch.ready}`);
    console.log(`paybackIsolationReady=${report.payback.isolationReady}`);
    console.log(`liveEligibleCount=${report.strategyDispatch.liveEligibleCount}`);
    console.log(`capitalPlanDecision=${report.capitalManager.capitalPlanDecision || "n/a"}`);
    console.log(`paybackStatus=${report.payback.status || "n/a"}`);
    console.log(`blockers=${report.blockers.join(",") || "none"}`);
  }

  if (args.strict && !report.ready) {
    process.exitCode = 1;
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
