import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { config, getEnv } from "../config/env.mjs";
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
  const order = new Map([
    ["cross_chain_bridge_or_swap", 0],
    ["cross_chain_swap_via_btc_intermediate", 0],
    ["cross_chain_bridge_across", 1],
    ["cross_chain_bridge_lifi", 2],
    ["cross_chain_bridge_stargate", 3],
    ["gas_refuel_bridge_gas_zip", 4],
  ]);
  return refillExecutionCandidates(job)
    .filter(refillCandidateExecutable)
    .sort((left, right) => (order.get(left.method) ?? 99) - (order.get(right.method) ?? 99) || left.index - right.index)
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
  const executionStatus = active?.json?.execution?.settlementStatus || active?.json?.outcomeEvent?.status || active?.json?.status || null;
  const delivered = ["confirmed", "delivered", "succeeded"].includes(executionStatus);
  return {
    jobId: job.jobId,
    chain: job.chain,
    asset: job.asset,
    targetAmountDecimal: job.targetAmountDecimal ?? null,
    executionMethod: job.executionMethod,
    selectedExecutionMethod: preview?.json?.preparation?.executionMethod || job.executionMethod,
    previewStatus: refillPreviewStatus(preview),
    previewBlockedReason: refillPreviewBlockedReason(preview),
    attempted: Boolean(execution),
    executed: delivered,
    executionStatus,
    executionBlockedReason:
      active?.json?.event?.blockers?.[0] ||
      active?.json?.blockers?.[0] ||
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
    representativeCoverage: report?.summary?.representativeCoverage || null,
    proofStatus: report?.execution?.destinationProof?.status || null,
    txHashes: (report?.execution?.stepResults || [])
      .map((step) => step.signerResult?.broadcast?.txHash)
      .filter(Boolean),
  };
}

function compactMerklQueue(report = null) {
  return {
    queueCount: report?.summary?.queueCount ?? 0,
    chainCount: report?.summary?.chainCount ?? 0,
    byChain: report?.summary?.byChain || {},
    executableNowCount: report?.summary?.executableNowCount ?? 0,
    autoExecutableNowCount: report?.summary?.autoExecutableNowCount ?? 0,
    representativeCoverage: report?.summary?.representativeCoverage || null,
  };
}

function compactDestinationAllocator(report = null) {
  return {
    candidateCount: report?.summary?.candidateCount ?? 0,
    activeReadyCandidateCount: report?.summary?.activeReadyCandidateCount ?? 0,
    planningCandidateCount: report?.summary?.planningCandidateCount ?? 0,
    topActiveReadyCandidateId: report?.summary?.topActiveReadyCandidateId || null,
    tier1ActiveReadyChains: report?.summary?.tier1ActiveReadyChains || [],
    tier2ReviewOnlyChains: report?.summary?.tier2ReviewOnlyChains || [],
    tier3BlockedOnlyChains: report?.summary?.tier3BlockedOnlyChains || [],
    activeDraft: (report?.diversifiedPortfolioDraft?.activeDraft || []).map((item) => ({
      id: item.id,
      chain: item.chain,
      protocols: item.protocols || [],
      assetFamily: item.assetFamily || null,
      planningEligibility: item.planningEligibility || null,
    })),
    reviewQueue: (report?.diversifiedPortfolioDraft?.reviewQueue || []).map((item) => ({
      id: item.id,
      chain: item.chain,
      protocols: item.protocols || [],
      blockers: item.blockers || [],
    })),
  };
}

function compactRepresentativeExecutionCoverage({ merklQueue = null, destinationAllocator = null } = {}) {
  const merklQueuedChains = new Set(Object.keys(merklQueue?.summary?.byChain || {}));
  const merklMissingChains = merklQueue?.summary?.representativeCoverage?.missingChains || [];
  const allocatorReadyChains = destinationAllocator?.summary?.tier1ActiveReadyChains || [];
  const allocatorReviewOnlyChains = destinationAllocator?.summary?.tier2ReviewOnlyChains || [];
  const allocatorReadyButNotQueuedChains = allocatorReadyChains.filter((chain) => !merklQueuedChains.has(chain));
  return {
    merklQueuedChains: [...merklQueuedChains],
    merklMissingChains,
    allocatorReadyChains,
    allocatorReviewOnlyChains,
    allocatorReadyButNotQueuedChains,
    topAllocatorReadyButNotQueuedChain: allocatorReadyButNotQueuedChains[0] || null,
    topAction: allocatorReadyButNotQueuedChains.length > 0
      ? "wire_destination_allocator_candidate_to_protocol_canary_or_direct_executor"
      : merklMissingChains.length > 0
        ? "source_or_build_representative_opportunity"
        : "monitor_active_representative_receipts",
  };
}

function compactDestinationRepresentative(report = null) {
  return {
    status: report?.status || null,
    blockedReason: report?.blockedReason || null,
    candidateCount: report?.summary?.candidateCount ?? 0,
    readyCount: report?.summary?.readyCount ?? 0,
    coveredCount: report?.summary?.coveredCount ?? 0,
    selectedTemplateId: report?.summary?.selected?.templateId || null,
    selectedChain: report?.summary?.selected?.chain || null,
    selectedProtocolId: report?.summary?.selected?.protocolId || null,
    proofStatus: report?.summary?.proofStatus || report?.execution?.destinationProof?.status || null,
    txHashes: report?.summary?.txHashes || (report?.execution?.stepResults || [])
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

function compactAutoKill(report = null) {
  if (!report) return null;
  return {
    triggered: report.triggered === true,
    alreadyArmed: report.alreadyArmed === true,
    killSwitchWritten: report.killSwitchWritten === true,
    killSwitchPath: report.killSwitchPath ?? null,
    triggers: Array.isArray(report.triggers) ? report.triggers.map((trigger) => trigger.trigger).filter(Boolean) : [],
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
  if (step.name?.startsWith("treasury_refill_execute:")) {
    const executionStatus = step.json?.outcomeEvent?.status || step.json?.execution?.settlementStatus || step.json?.status || null;
    return ["blocked", "failed", "unproven_timeout", "near_match_timeout"].includes(executionStatus);
  }
  if (step.name === "live_canary_sweep") {
    return true;
  }
  if (step.name === "auto_kill_check") {
    return step.json?.triggered === true;
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
      if (refillPreviewRetryable(preview)) {
        preview = {
          ...preview,
          json: {
            ...(preview.json || {}),
            preparation: {
              ...(preview.json?.preparation || {}),
              status: "blocked",
              blockedReason: "routing_exhausted",
            },
          },
        };
        steps[steps.length - 1] = commandStep(steps[steps.length - 1]?.name || `treasury_refill_preview:${job.jobId}`, steps[steps.length - 1]?.args || [], preview);
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
          `--timeout-ms=${timeoutMs}`,
          `--confirmation-timeout-ms=${timeoutMs}`,
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

  const merklQueueResult = await runJsonStep({
    name: "merkl_canary_queue_refresh",
    args: ["src/cli/report-merkl-canary-queue.mjs", "--json", "--write"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const destinationPromotionGateResult = await runJsonStep({
    name: "destination_promotion_gate_refresh",
    args: ["src/cli/report-destination-promotion-gate.mjs", "--json", "--write"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const destinationAllocatorResult = await runJsonStep({
    name: "destination_allocator_refresh",
    args: ["src/cli/report-allocator-core.mjs", "--json", "--write"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const destinationRepresentativeResult = await runJsonStep({
    name: "destination_representative_autopilot",
    args: appendFlag([
      "src/cli/run-destination-representative-autopilot.mjs",
      "--json",
      "--write",
      `--timeout-ms=${timeoutMs}`,
    ], "--execute", execute),
    runCommandImpl,
    cwd,
    timeoutMs,
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

  const heartbeatPathArg = getEnv("EXECUTOR_HEARTBEAT_PATH", null);
  const oraclesPathArg = getEnv("AUTO_KILL_ORACLES_PATH", null);
  const autoKillArgs = ["src/cli/run-auto-kill-check.mjs", "--json"];
  if (heartbeatPathArg) autoKillArgs.push(`--heartbeat-path=${heartbeatPathArg}`);
  if (oraclesPathArg) autoKillArgs.push(`--oracles-path=${oraclesPathArg}`);
  const autoKillResult = await runJsonStep({
    name: "auto_kill_check",
    args: autoKillArgs,
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const summary = {
    officialChainCount: chains.length,
    refillJobCount: refillPlan?.summary?.jobCount ?? 0,
    autoRefillJobCount: autoRefillJobs.length,
    refillAttemptedCount: refillExecutions.filter((item) => item.attempted).length,
    refillExecutedCount: refillExecutions.filter((item) => item.executed).length,
    inboundInventory: compactInboundWatcher(inboundWatcherResult.json),
    canarySweep: compactCanarySweep(canarySweepResult.json),
    merklQueue: compactMerklQueue(merklQueueResult.json),
    destinationPromotionGate: {
      allocationReadyCount: destinationPromotionGateResult.json?.summary?.allocationReadyCount ?? null,
      promotableCount: destinationPromotionGateResult.json?.summary?.promotableCount ?? null,
    },
    destinationAllocator: compactDestinationAllocator(destinationAllocatorResult.json),
    representativeExecutionCoverage: compactRepresentativeExecutionCoverage({
      merklQueue: merklQueueResult.json,
      destinationAllocator: destinationAllocatorResult.json,
    }),
    destinationRepresentative: compactDestinationRepresentative(destinationRepresentativeResult.json),
    merklCanary: compactMerkl(merklCanaryResult.json),
    portfolio: compactPortfolio(portfolioResult.json),
    strategyDispatch: compactStrategyDispatch(strategyDispatchResult.json),
    payback: compactPayback(paybackResult.json),
    autoKill: compactAutoKill(autoKillResult.json),
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
