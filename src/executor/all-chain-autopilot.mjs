import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  refillCandidateExecutable,
  refillExecutionCandidates,
} from "./helpers/refill-fallback.mjs";

const execFileAsync = promisify(execFile);

export const OFFICIAL_GATEWAY_DESTINATION_CHAINS = Object.freeze([
  "ethereum",
  "bob",
  "base",
  "bsc",
  "avalanche",
  "unichain",
  "bera",
  "optimism",
  "soneium",
  "sei",
  "sonic",
]);

function jsonFromStdout(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("command_stdout_not_json");
  }
}

export async function defaultRunCommand({ args, cwd = process.cwd(), timeoutMs = 300_000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 24 * 1024 * 1024,
    });
    let parsedJson = null;
    try {
      parsedJson = jsonFromStdout(stdout);
    } catch {
      parsedJson = null;
    }
    return {
      ok: true,
      exitCode: 0,
      stdout,
      stderr,
      json: parsedJson,
    };
  } catch (error) {
    let parsedJson = null;
    if (error.stdout) {
      try {
        parsedJson = jsonFromStdout(error.stdout);
      } catch {
        parsedJson = null;
      }
    }
    return {
      ok: false,
      exitCode: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      json: parsedJson,
      error: {
        name: error.name || "CommandFailed",
        message: error.message,
      },
    };
  }
}

function commandStep(name, args, result) {
  return {
    name,
    args,
    ok: result.ok,
    exitCode: result.exitCode,
    stderrSummary: String(result.stderr || "").split("\n").filter(Boolean).slice(-5),
    json: result.json || null,
    error: result.error || null,
  };
}

function appendFlag(args, flag, enabled) {
  return enabled ? [...args, flag] : args;
}

function refillJobIsAutoExecutable(job = {}) {
  return !job.requiresManualReview && job.fundingSource?.selectionStatus === "ready";
}

function refillPreparationReady(json = null) {
  return json?.preparation?.status === "ready";
}

function refillPreviewBlockedReason(result = {}) {
  return result?.json?.preparation?.blockedReason ||
    result?.json?.event?.blockers?.[0] ||
    result?.json?.blockers?.[0] ||
    classifyRefillRouteError(result) ||
    null;
}

function refillPreviewStatus(result = {}) {
  return result?.json?.preparation?.status || result?.json?.event?.status || result?.json?.status || null;
}

function forcedRefillMethodArgs(job = {}, activeMethod = null) {
  return refillExecutionCandidates(job)
    .filter(refillCandidateExecutable)
    .map((candidate) => candidate.method)
    .filter((method) => method && method !== activeMethod);
}

function commandErrorText(result = {}) {
  return [
    result?.error?.message,
    result?.stderr,
    result?.stdout,
  ].filter(Boolean).join("\n");
}

function classifyRefillRouteError(result = {}) {
  const text = commandErrorText(result).toLowerCase();
  if (!text) return null;
  if (/pair unsupported/u.test(text)) return "bridge_pair_unsupported";
  if (/lifi.*quote.*reject|quote.*reject/u.test(text)) return "lifi_quote_rejected";
  if (/no[_ ]route|route.*unsupported|unsupported.*route/u.test(text)) return "no_route";
  return null;
}

function refillPreviewRetryable(result = {}) {
  if (refillPreparationReady(result.json)) return false;
  const reason = refillPreviewBlockedReason(result);
  return [
    "no_route",
    "bridge_pair_unsupported",
    "lifi_quote_rejected",
    "route_unsupported",
    "quote_unavailable",
  ].includes(reason);
}

function compactRefillExecution(job, preview, execution = null) {
  const active = execution || preview;
  return {
    jobId: job.jobId,
    chain: job.chain,
    asset: job.asset,
    targetAmountDecimal: job.targetAmountDecimal ?? null,
    executionMethod: job.executionMethod,
    selectedExecutionMethod: preview?.json?.preparation?.executionMethod || job.executionMethod,
    previewStatus: refillPreviewStatus(preview),
    previewBlockedReason: refillPreviewBlockedReason(preview),
    executed: Boolean(execution),
    executionStatus: active?.json?.execution?.settlementStatus || active?.json?.outcomeEvent?.status || null,
    executionBlockedReason:
      active?.json?.event?.blockers?.[0] ||
      active?.json?.preparation?.blockedReason ||
      classifyRefillRouteError(active) ||
      active?.json?.error?.message ||
      active?.error?.message ||
      null,
  };
}

function compactInboundWatcher(report = null) {
  return {
    inboundEventCount: report?.summary?.inboundEventCount ?? 0,
    routeReadyCount: report?.summary?.routeReadyCount ?? 0,
    manualReviewCount: report?.summary?.manualReviewCount ?? 0,
    candidateQueueCount: report?.summary?.candidateQueueCount ?? 0,
    appendedEvents: report?.appended?.events ?? null,
    appendedJobs: report?.appended?.jobs ?? null,
    appendedPendingWhitelist: report?.appended?.pendingWhitelist ?? null,
  };
}

function compactMerkl(report = null) {
  return {
    status: report?.status || null,
    blockedReason: report?.blockedReason || null,
    selectedChain: report?.summary?.selectedChain || null,
    selectedProtocolId: report?.summary?.selectedProtocolId || null,
    selectedBindingKind: report?.summary?.selectedBindingKind || null,
    selectedAmountUsd: report?.summary?.selectedAmountUsd ?? null,
    proofStatus: report?.execution?.destinationProof?.status || null,
    txHashes: (report?.execution?.stepResults || [])
      .map((step) => step.signerResult?.broadcast?.txHash)
      .filter(Boolean),
  };
}

function compactPortfolio(report = null) {
  return {
    status: report?.status || null,
    blockedReason: report?.blockedReason || null,
    exit: report?.exit || null,
    allocator: report?.allocator || null,
  };
}

function compactCanarySweep(report = null) {
  return {
    status: report?.status || null,
    blockedReason: report?.blockedReason || null,
    candidateCount: report?.summary?.candidateCount ?? 0,
    previewReadyCount: report?.summary?.previewReadyCount ?? 0,
    executedCount: report?.summary?.executedCount ?? 0,
    deliveredCount: report?.summary?.deliveredCount ?? 0,
    blockedCount: report?.summary?.blockedCount ?? 0,
    chainsTouched: [...new Set((report?.results || [])
      .filter((item) => item.execution?.lastTxHash || item.status === "preview_ready" || item.status === "delivered")
      .map((item) => item.candidate?.chain)
      .filter(Boolean))],
  };
}

function compactStrategyDispatch(report = null) {
  return {
    batchStatus: report?.record?.batchStatus || null,
    selectedCount: report?.record?.selectedCount ?? 0,
    successCount: report?.summary?.successCount ?? null,
    failedCount: report?.summary?.failureCount ?? null,
    liveEligibleCount: report?.executionSurfaces?.summary?.liveEligibleCount ?? null,
    missingExecutorCount: report?.executionSurfaces?.summary?.missingExecutorCount ?? null,
  };
}

function compactPayback(report = null) {
  return {
    status: report?.status || null,
    reason: report?.reason || null,
    plannedPaybackSats: report?.compositePlan?.plannedPaybackSats ?? null,
    pendingCarrySats: report?.decision?.snapshot?.pendingDeferredSats ?? report?.decision?.snapshot?.pendingCarrySats ?? null,
  };
}

function stepStatus(step = {}) {
  return step.json?.status || step.json?.record?.batchStatus || step.json?.decision || step.json?.event?.status || null;
}

function stepIsRecoverable(step, steps) {
  if (step.name === "treasury_refill_plan") {
    return steps.some((item) => item.name === "treasury_refill_plan_stored_snapshot_fallback" && item.ok && item.json);
  }
  if (step.name === "inbound_inventory_watcher") {
    const stderr = step.stderrSummary?.join("\n") || "";
    return /No treasury-inventory snapshots found/u.test(stderr);
  }
  if (step.name?.startsWith("treasury_refill_preview:")) {
    return [
      "no_route",
      "bridge_pair_unsupported",
      "lifi_quote_rejected",
      "route_unsupported",
      "quote_unavailable",
    ].includes(refillPreviewBlockedReason(step));
  }
  const status = stepStatus(step);
  return ["blocked", "carry", "hold", "skipped", "completed", "succeeded"].includes(status);
}

async function runJsonStep({ name, args, runCommandImpl, cwd, timeoutMs, steps }) {
  const result = await runCommandImpl({ args, cwd, timeoutMs });
  steps.push(commandStep(name, args, result));
  return result;
}

export async function runAllChainAutopilot({
  execute = false,
  write = false,
  cwd = process.cwd(),
  timeoutMs = 300_000,
  chains = OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  maxRefillJobs = 4,
  canaryLimit = 11,
  canaryTimeoutMs = 600_000,
  dispatchTimeoutMs = 600_000,
  runCommandImpl = defaultRunCommand,
  dataDir = config.dataDir,
} = {}) {
  const observedAt = new Date().toISOString();
  const steps = [];
  const refillExecutions = [];

  await runJsonStep({
    name: "gas_snapshot_refresh",
    args: ["src/cli/gas-snapshot.mjs"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  let refillPlanResult = await runJsonStep({
    name: "treasury_refill_plan",
    args: ["src/cli/plan-treasury-refill-jobs.mjs", "--json", "--refresh-inventory"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });
  if (!refillPlanResult.json) {
    refillPlanResult = await runJsonStep({
      name: "treasury_refill_plan_stored_snapshot_fallback",
      args: ["src/cli/plan-treasury-refill-jobs.mjs", "--json"],
      runCommandImpl,
      cwd,
      timeoutMs,
      steps,
    });
  }
  const refillPlan = refillPlanResult.json;

  const inboundWatcherResult = await runJsonStep({
    name: "inbound_inventory_watcher",
    args: ["src/cli/run-inbound-inventory-watcher.mjs", "--json", "--write"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const autoRefillJobs = (refillPlan?.jobs || []).filter(refillJobIsAutoExecutable).slice(0, maxRefillJobs);

  for (const job of autoRefillJobs) {
    let preview = await runJsonStep({
      name: `treasury_refill_preview:${job.jobId}`,
      args: ["src/cli/run-refill-job-stub.mjs", `--job-id=${job.jobId}`, "--json"],
      runCommandImpl,
      cwd,
      timeoutMs,
      steps,
    });
    if (refillPreviewRetryable(preview)) {
      for (const method of forcedRefillMethodArgs(job, job.executionMethod)) {
        const alternatePreview = await runJsonStep({
          name: `treasury_refill_preview:${job.jobId}:${method}`,
          args: ["src/cli/run-refill-job-stub.mjs", `--job-id=${job.jobId}`, `--method=${method}`, "--json"],
          runCommandImpl,
          cwd,
          timeoutMs,
          steps,
        });
        preview = alternatePreview;
        if (refillPreparationReady(preview.json) || !refillPreviewRetryable(preview)) break;
      }
    }
    let execution = null;
    if (execute && refillPreparationReady(preview.json)) {
      const method = preview.json?.forcedMethod || null;
      execution = await runJsonStep({
        name: `treasury_refill_execute:${job.jobId}`,
        args: [
          "src/cli/run-refill-job-stub.mjs",
          `--job-id=${job.jobId}`,
          ...(method ? [`--method=${method}`] : []),
          "--json",
          "--execute",
          "--mode=live",
        ],
        runCommandImpl,
        cwd,
        timeoutMs,
        steps,
      });
    }
    refillExecutions.push(compactRefillExecution(job, preview, execution));
  }

  const canarySweepResult = await runJsonStep({
    name: "live_canary_sweep",
    args: appendFlag([
      "src/cli/run-live-canary-sweep.mjs",
      "--json",
      "--write",
      `--chains=${chains.join(",")}`,
      `--limit=${canaryLimit}`,
    ], "--execute", execute),
    runCommandImpl,
    cwd,
    timeoutMs: canaryTimeoutMs,
    steps,
  });

  const merklCanaryResult = await runJsonStep({
    name: "merkl_canary_autopilot",
    args: appendFlag(["src/cli/run-merkl-canary-autopilot.mjs", "--json", "--write"], "--execute", execute),
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const portfolioResult = await runJsonStep({
    name: "merkl_portfolio_orchestrator",
    args: appendFlag(["src/cli/run-merkl-portfolio-orchestrator.mjs", "--json", "--write"], "--execute", execute),
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const strategyDispatchResult = await runJsonStep({
    name: "strategy_catalog_dispatch",
    args: appendFlag([
      "src/cli/run-strategy-catalog-dispatcher.mjs",
      "--json",
      "--write",
      "--continue-on-failure",
      "--mode=auto",
    ], "--execute", execute),
    runCommandImpl,
    cwd,
    timeoutMs: dispatchTimeoutMs,
    steps,
  });

  const paybackArgs = appendFlag(["src/cli/run-payback-scheduler.mjs", "--json", "--write", "--once"], "--execute", execute);
  const paybackResult = await runJsonStep({
    name: "payback_scheduler",
    args: paybackArgs,
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const summary = {
    officialChainCount: chains.length,
    refillJobCount: refillPlan?.summary?.jobCount ?? 0,
    autoRefillJobCount: autoRefillJobs.length,
    refillExecutedCount: refillExecutions.filter((item) => item.executed).length,
    inboundInventory: compactInboundWatcher(inboundWatcherResult.json),
    canarySweep: compactCanarySweep(canarySweepResult.json),
    merklCanary: compactMerkl(merklCanaryResult.json),
    portfolio: compactPortfolio(portfolioResult.json),
    strategyDispatch: compactStrategyDispatch(strategyDispatchResult.json),
    payback: compactPayback(paybackResult.json),
  };

  const hardFailures = steps.filter((step) => !step.ok && !stepIsRecoverable(step, steps));
  const blockedSteps = steps.filter((step) => !step.ok || ["blocked", "carry", "hold", "skipped"].includes(stepStatus(step)));
  const report = {
    schemaVersion: 1,
    observedAt,
    mode: execute ? "execute" : "preview",
    status: hardFailures.length > 0 ? "error" : blockedSteps.length > 0 ? "completed_with_blockers" : "completed",
    blockedReason: hardFailures[0]?.error?.message || null,
    chains,
    summary,
    refillExecutions,
    steps,
  };

  if (write) {
    await writeTextIfChanged(join(dataDir, "all-chain-autopilot-latest.json"), `${safeJsonStringify(report, 2)}\n`);
    await new JsonlStore(dataDir).append("all-chain-autopilot-runs", report);
  }

  return report;
}
