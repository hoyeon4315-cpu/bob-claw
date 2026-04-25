#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";

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

export function buildFullAutomationReadiness({
  runtime,
  inbound,
  capitalManager,
  strategyDispatch,
  payback,
} = {}) {
  const runtimeReady = runtime?.summary?.ready === true;
  const operatingCapitalIngressCount = inbound?.summary?.operatingCapitalIngressCount ?? 0;
  const paybackExcludedCount = inbound?.summary?.paybackExcludedCount ?? 0;
  const ingressIsolationReady = operatingCapitalIngressCount === paybackExcludedCount;
  const capitalPlanDecision = capitalManager?.capitalPlan?.decision || null;
  const capitalJobs = capitalManager?.jobs?.summary?.jobCount ?? 0;
  const autoRefillJobCount = capitalManager?.jobs?.jobs?.filter((job) => !job.requiresManualReview).length ?? 0;
  const capitalAutomationReady =
    capitalPlanDecision === "BALANCED" ||
    capitalPlanDecision === "READY" ||
    capitalPlanDecision === "WATCH_ONLY" ||
    (capitalPlanDecision === "REFILL_REQUIRED" && autoRefillJobCount > 0);
  const dispatchBatchStatus = strategyDispatch?.record?.batchStatus || null;
  const liveEligibleCount = strategyDispatch?.executionSurfaces?.summary?.liveEligibleCount ?? 0;
  const dispatchReady =
    liveEligibleCount > 0 &&
    dispatchBatchStatus !== "failed" &&
    dispatchBatchStatus !== "invalid";
  const paybackStatus = payback?.payback?.scheduler?.status || null;
  const paybackReason = payback?.payback?.scheduler?.reason || null;
  const paybackIsolationReady = ingressIsolationReady;

  const blockers = [
    ...(runtimeReady ? [] : ["runtime_not_ready"]),
    ...(ingressIsolationReady ? [] : ["operating_capital_not_isolated_from_payback"]),
    ...(capitalAutomationReady ? [] : ["capital_rebalancer_not_ready"]),
    ...(dispatchReady ? [] : ["strategy_dispatch_not_ready"]),
    ...(paybackIsolationReady ? [] : ["payback_isolation_not_ready"]),
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
      ready: dispatchReady,
    },
    payback: {
      status: paybackStatus,
      reason: paybackReason,
      isolationReady: paybackIsolationReady,
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

  const report = buildFullAutomationReadiness({
    runtime,
    inbound: inbound.json,
    capitalManager: capitalManager.json,
    strategyDispatch: strategyDispatch.json,
    payback: payback.json,
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
