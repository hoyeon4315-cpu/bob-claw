#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";
import {
  buildAllChainAutopilotDashboardSlice,
  resolveAllChainAutopilotReport,
} from "../status/all-chain-autopilot-slice.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

export function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    strict: flags.has("--strict"),
    refresh: flags.has("--refresh"),
  };
}

function runJsonCli(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status ?? 1,
      stdout,
      stderr,
      json: null,
      error: stderr.trim() || stdout.trim() || `exit ${result.status ?? 1}`,
    };
  }
  return {
    ok: true,
    status: 0,
    stdout,
    stderr,
    json: JSON.parse(stdout),
    error: null,
  };
}

function classifyRefillIssue(reason = null) {
  const text = String(reason || "").trim();
  if (!text) return "unknown";
  if (text === "routing_exhausted") return "routing_exhausted";
  if (
    /insufficient source balance|source_inventory_below_target_amount|source_inventory_reserved|source inventory|insufficient_funds|insufficient balance/iu.test(text)
  ) {
    return "inventory_insufficient";
  }
  if (/insufficient_native_balance_for_gas|insufficient_native_gas_balance|native gas|gas bootstrap/iu.test(text)) {
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
      };
    })
    .filter((item) => item.reason)
    .slice(0, 8);
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
  return strategies
    .map((strategy = {}) => ({
      strategyId: strategy.id || null,
      selectedMode: strategy.selectedMode || null,
      status: strategy.status || null,
      reason: strategy.reason || null,
      blockers: Array.isArray(strategy.liveAdmissionBlockers)
        ? strategy.liveAdmissionBlockers.filter(Boolean)
        : [],
    }))
    .filter((strategy) => strategy.strategyId && strategy.blockers.length > 0)
    .slice(0, 8);
}

export function buildFullAutomationReadiness({
  runtime,
  inbound,
  capitalManager,
  strategyDispatch,
  payback,
  autopilot,
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
  const dispatchReady =
    liveEligibleCount > 0 &&
    dispatchBatchStatus !== "failed" &&
    dispatchBatchStatus !== "invalid";
  const paybackStatus = payback?.payback?.scheduler?.status || null;
  const paybackReason = payback?.payback?.scheduler?.reason || null;
  const paybackIsolationReady = ingressIsolationReady;
  const liveAutomationObserved = autopilot?.present === true;
  const refillBlockers = refillBlockerDetails(autopilot?.refill?.blockers || []);
  const refillIssueCounts = countByCategory(refillBlockers);
  const liveAdmissionBlockers = strategyLiveAdmissionBlockers(strategyDispatch);
  const unresolvedRefillRoutes = liveAutomationObserved &&
    (refillBlockers.length > 0
      ? refillBlockers.some((item) => item?.reason !== "routing_exhausted")
      : (autopilot?.refill?.blockedCount ?? 0) > 0);
  const capitalAutomationReady =
    capitalPlanDecision === "BALANCED" ||
    capitalPlanDecision === "READY" ||
    capitalPlanDecision === "WATCH_ONLY" ||
    (capitalPlanDecision === "REFILL_REQUIRED" &&
      (autoRefillJobCount > 0 || (liveAutomationObserved && !unresolvedRefillRoutes)));
  const paybackReserveReady = paybackReason !== "reserve_asset_missing";

  const blockers = [
    ...(runtimeReady ? [] : ["runtime_not_ready"]),
    ...(ingressIsolationReady ? [] : ["operating_capital_not_isolated_from_payback"]),
    ...(capitalAutomationReady ? [] : ["capital_rebalancer_not_ready"]),
    ...(dispatchReady ? [] : ["strategy_dispatch_not_ready"]),
    ...(paybackIsolationReady ? [] : ["payback_isolation_not_ready"]),
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
      selectedCount: strategyDispatch?.record?.selectedCount ?? 0,
      liveAdmissionBlockers,
      ready: dispatchReady,
    },
    liveAutomation: {
      observed: liveAutomationObserved,
      status: autopilot?.status || null,
      nextAction: autopilot?.nextAction || null,
      refillBlockedCount: autopilot?.refill?.blockedCount ?? null,
      refillUnresolvedCount: autopilot?.refill?.unresolvedCount ?? null,
      refillManualBacklogCount: autopilot?.refill?.manualBacklogCount ?? null,
      refillAttemptedCount: autopilot?.refill?.attemptedCount ?? null,
      refillExecutedCount: autopilot?.refill?.executedCount ?? null,
      refillIssueCounts,
      refillBlockers,
      ready: !unresolvedRefillRoutes,
    },
    payback: {
      status: paybackStatus,
      reason: paybackReason,
      isolationReady: paybackIsolationReady,
      ready: paybackIsolationReady && paybackReserveReady,
      nextAction: payback?.payback?.scheduler?.nextAction || null,
    },
    policyNote: "Operating capital ingress must stay isolated from payback; live dispatch still depends on policy/caps/kill-switch.",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtime = await collectExecutorRuntimeReadiness();
  const refreshArgs = args.refresh ? ["--json", "--write"] : ["--json"];
  const inbound = runJsonCli("src/cli/run-inbound-inventory-watcher.mjs", refreshArgs);
  const capitalManager = runJsonCli(
    "src/cli/plan-capital-manager-refill-jobs.mjs",
    args.refresh ? ["--json", "--write", "--refresh-inventory"] : ["--json"],
  );
  const strategyDispatch = runJsonCli(
    "src/cli/run-strategy-catalog-dispatcher.mjs",
    args.refresh ? ["--json", "--write", "--mode=auto"] : ["--json", "--mode=auto"],
  );
  const payback = runJsonCli("src/cli/report-payback-status.mjs", ["--json"]);
  const autopilotLatest = await readJsonIfExists(join(config.dataDir, "all-chain-autopilot-latest.json"));
  const autopilotLatestCompleted = await readJsonIfExists(join(config.dataDir, "all-chain-autopilot-latest-completed.json"));
  const autopilot = buildAllChainAutopilotDashboardSlice(
    resolveAllChainAutopilotReport(autopilotLatest, autopilotLatestCompleted),
  );

  const report = buildFullAutomationReadiness({
    runtime,
    inbound: inbound.json,
    capitalManager: capitalManager.json,
    strategyDispatch: strategyDispatch.json,
    payback: payback.json,
    autopilot,
  });
  report.commandHealth = {
    inbound: { ok: inbound.ok, error: inbound.error },
    capitalManager: { ok: capitalManager.ok, error: capitalManager.error },
    strategyDispatch: { ok: strategyDispatch.ok, error: strategyDispatch.error },
    payback: { ok: payback.ok, error: payback.error },
  };

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
