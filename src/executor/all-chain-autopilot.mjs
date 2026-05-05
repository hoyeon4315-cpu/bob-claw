import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { config, getEnv } from "../config/env.mjs";
export { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../config/gateway-destinations.mjs";
import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../config/gateway-destinations.mjs";
import { getStrategyCaps } from "../config/strategy-caps.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { evaluateDiscretionaryBudget } from "./policy/cap-check.mjs";
import {
  refillCandidateExecutable,
  refillExecutionCandidates,
  jobWithCandidate,
} from "./helpers/refill-fallback.mjs";

const WRAPPED_BTC_LOOP_STRATEGY_ID = "wrapped-btc-loop-base-moonwell";
const BASE_WBTC_OFT_TOKEN = "0x0555e30da8f98308edb960aa94c0db47230d2b9c";
const MIN_WRAPPED_BTC_HANDOFF_USD = 5;
const DISCRETIONARY_RECEIPT_KIND_TO_CATEGORY = Object.freeze({
  token_dex_experiment: "probe",
  native_dex_experiment: "probe",
  gas_zip_native_refuel: "refuel",
  lifi_bridge: "bridge",
  across_bridge: "bridge",
  gateway_btc_consolidation: "consolidation",
});
const DISCRETIONARY_REFILL_EXECUTOR_TO_CATEGORY = Object.freeze({
  token_dex_experiment: "probe",
  native_dex_experiment: "probe",
  gas_zip_native_refuel: "refuel",
  across_bridge: "bridge",
  lifi_bridge: "bridge",
  gateway_btc_consolidation: "consolidation",
  cross_chain_btc_intermediate: "consolidation",
});
const DISCRETIONARY_REFILL_METHOD_TO_CATEGORY = Object.freeze({
  same_chain_token_to_native_swap: "probe",
  same_chain_native_to_token_swap: "probe",
  gas_refuel_bridge_gas_zip: "refuel",
  cross_chain_bridge_across: "bridge",
  cross_chain_bridge_lifi: "bridge",
  cross_chain_swap_via_btc_intermediate: "consolidation",
});
const SOURCE_NATIVE_GAS_BLOCKERS = new Set([
  "insufficient_funds",
  "insufficient_native_gas_balance",
]);
const SOURCE_NATIVE_GAS_CONSUMING_METHODS = new Set([
  "cross_chain_bridge_or_swap",
  "cross_chain_swap_via_btc_intermediate",
  "cross_chain_bridge_across",
  "cross_chain_bridge_lifi",
  "cross_chain_bridge_stargate",
]);

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

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
  const maxBuffer = 24 * 1024 * 1024;
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  function parseJson(stdoutText) {
    try {
      return jsonFromStdout(stdoutText);
    } catch {
      return null;
    }
  }

  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT";
    return {
      ok: false,
      exitCode: Number.isInteger(result.status) ? result.status : 1,
      stdout,
      stderr: stderr || result.error.message,
      json: parseJson(stdout),
      error: {
        name: result.error.name || "CommandFailed",
        message: timedOut ? `Command timed out after ${timeoutMs}ms` : result.error.message,
      },
    };
  }

  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  if (exitCode === 0) {
    return {
      ok: true,
      exitCode,
      stdout,
      stderr,
      json: parseJson(stdout),
    };
  }

  return {
    ok: false,
    exitCode,
    stdout,
    stderr: stderr || (result.signal ? `Command terminated by signal ${result.signal}` : `Command exited with code ${exitCode}`),
    json: parseJson(stdout),
    error: {
      name: "CommandFailed",
      message: stderr || (result.signal ? `Command terminated by signal ${result.signal}` : `Command exited with code ${exitCode}`),
    },
  };
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

function fundingSourceAutoExecutable(fundingSource) {
  if (!fundingSource) return false;
  if (fundingSource.selectionStatus === "ready") return true;
  return (
    fundingSource.selectionStatus === "conditional" &&
    (fundingSource.missingInputs || []).length === 0 &&
    (fundingSource.settlementRequirements || []).length > 0 &&
    !fundingSource.requiresManualFunding
  );
}

function refillJobIsAutoExecutable(job = {}) {
  return !job.requiresManualReview && fundingSourceAutoExecutable(job.fundingSource);
}

function inventoryFreshnessBlocker(plan = null, source = "inventory") {
  if (!plan) return null;
  if (plan.inventorySource && plan.inventorySource !== "live_scan") {
    return `${source}_inventory_not_live`;
  }
  const scanErrorCount = Number(plan.inventoryScanErrorCount ?? 0);
  if (Number.isFinite(scanErrorCount) && scanErrorCount > 0) {
    return `${source}_inventory_refresh_error`;
  }
  if (plan.inventoryRefreshError) {
    return `${source}_inventory_refresh_error`;
  }
  return null;
}

function suppressAutoRefillJobsForInventoryBlocker(jobs = [], blocker = null) {
  if (!blocker) return jobs || [];
  return (jobs || []).map((job) => ({
    ...job,
    requiresManualReview: true,
    autopilotBlockedReason: blocker,
    blockers: [...new Set([...(Array.isArray(job.blockers) ? job.blockers : []), blocker])],
  }));
}

function refillPreparationReady(json = null) {
  return json?.preparation?.status === "ready";
}

function refillPreviewBlockedReason(result = {}) {
  return normalizeRefillBlockedReason(
    result?.json?.preparation?.blockedReason ||
    result?.json?.event?.blockers?.[0] ||
    result?.json?.blockers?.[0] ||
    classifyRefillRouteError(result) ||
    null,
  );
}

function refillRouteAttemptReason(result = {}, { method = null } = {}) {
  const blockedReason = refillPreviewBlockedReason(result);
  if (!blockedReason) return null;
  return {
    method: method || refillSelectedMethod(result) || null,
    blockedReason,
    planBlockedReason: result?.json?.preparation?.plan?.blockedReason || null,
  };
}

function routeExhaustionDeferral(routeAttemptReasons = []) {
  const reasons = new Set((routeAttemptReasons || []).map((item) => item?.blockedReason).filter(Boolean));
  const methods = new Set((routeAttemptReasons || []).map((item) => item?.method).filter(Boolean));
  if (reasons.has("dex_quote_failed") && reasons.has("no_route")) {
    return {
      routeDeferralReason: "native_bootstrap_unavailable_dex_quote_failed_gateway_no_route",
      routeDeferralAction: "defer_until_dex_quote_or_gateway_route_available",
    };
  }
  if (reasons.has("no_route") && reasons.has("lifi_quote_rejected")) {
    return {
      routeDeferralReason: "bridge_route_unavailable_gateway_no_route_lifi_quote_rejected",
      routeDeferralAction: "defer_until_bridge_provider_supports_pair",
    };
  }
  if (reasons.size === 1 && reasons.has("no_route") && methods.size <= 1) {
    return {
      routeDeferralReason: "bridge_route_unavailable_gateway_no_route_no_alternate_provider",
      routeDeferralAction: "defer_until_gateway_route_available_or_add_alternate_provider",
    };
  }
  if (reasons.has("quote_unavailable") || reasons.has("lifi_quote_rejected")) {
    return {
      routeDeferralReason: "bridge_route_quote_unavailable_after_alternates",
      routeDeferralAction: "defer_until_bridge_quote_provider_recovers",
    };
  }
  return {
    routeDeferralReason: "route_exhausted_retryable_provider_blockers",
    routeDeferralAction: "defer_until_route_provider_or_inventory_state_changes",
  };
}

function routingExhaustedPreparation(preview = {}, routeAttemptReasons = []) {
  const deferral = routeExhaustionDeferral(routeAttemptReasons);
  return {
    ...preview,
    json: {
      ...(preview.json || {}),
      preparation: {
        ...(preview.json?.preparation || {}),
        status: "blocked",
        blockedReason: "routing_exhausted",
        routeAttemptReasons,
        ...deferral,
      },
    },
  };
}

function refillPreviewStatus(result = {}) {
  return result?.json?.preparation?.status || result?.json?.event?.status || result?.json?.status || null;
}

function refillExecutionStatus(result = {}) {
  return result?.json?.execution?.settlementStatus || result?.json?.outcomeEvent?.status || result?.json?.status || null;
}

function refillDeliveredStatus(status = null) {
  return ["confirmed", "delivered", "succeeded"].includes(status);
}

function refillSelectedMethod(result = {}, fallback = null) {
  return result?.json?.forcedMethod || result?.json?.preparation?.executionMethod || fallback;
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
  if (/insufficient_native_balance_for_gas|insufficient_native_gas_balance/u.test(text)) return "insufficient_native_gas_balance";
  if (/pair unsupported/u.test(text)) return "bridge_pair_unsupported";
  if (/lifi.*quote.*reject|quote.*reject/u.test(text)) return "lifi_quote_rejected";
  if (/no[_ ]route|route.*unsupported|unsupported.*route/u.test(text)) return "no_route";
  return null;
}

function normalizeRefillBlockedReason(reason = null) {
  if (!reason) return null;
  if (/Signer did not complete/iu.test(String(reason))) {
    return "signer_execution_failed";
  }
  if (/insufficient_native_balance_for_gas|insufficient_native_gas_balance/iu.test(String(reason))) {
    return "insufficient_native_gas_balance";
  }
  return reason;
}

function blocksRefillFallbackForSourceNativeGas({ reason, activeMethod } = {}) {
  return SOURCE_NATIVE_GAS_BLOCKERS.has(reason) && SOURCE_NATIVE_GAS_CONSUMING_METHODS.has(activeMethod);
}

function refillPreviewRetryable(result = {}, { activeMethod = null } = {}) {
  if (refillPreparationReady(result.json)) return false;
  const reason = refillPreviewBlockedReason(result);
  if (blocksRefillFallbackForSourceNativeGas({ reason, activeMethod })) return false;
  return [
    "no_route",
    "bridge_pair_unsupported",
    "lifi_quote_rejected",
    "route_unsupported",
    "quote_unavailable",
    "routing_unavailable",
    "dex_quote_failed",
    "across_ticker_unsupported",
    "execution_reverted",
    "insufficient_funds",
    "insufficient_native_gas_balance",
    "executor_output_below_refill_target",
  ].includes(reason);
}

function refillExecutionBlockedReason(result = {}) {
  const status = refillExecutionStatus(result);
  return normalizeRefillBlockedReason(
    result?.json?.outcomeEvent?.blockers?.[0] ||
    result?.json?.event?.blockers?.[0] ||
    result?.json?.blockers?.[0] ||
    result?.json?.execution?.error?.message ||
    result?.json?.error?.message ||
    classifyRefillRouteError(result) ||
    (!refillDeliveredStatus(status) ? status : null) ||
    result?.error?.message ||
    null,
  );
}

function refillExecutionRetryable(result = {}, { activeMethod = null } = {}) {
  const reason = refillExecutionBlockedReason(result);
  const status = refillExecutionStatus(result);
  if (!reason && !status) return false;
  if (["source_confirmed_only", "confirmed", "delivered", "succeeded"].includes(status)) return false;
  if (refillExecutionHasSourceDebitBroadcast(result)) return false;
  if (blocksRefillFallbackForSourceNativeGas({ reason, activeMethod })) return false;
  return [
    "no_route",
    "bridge_pair_unsupported",
    "lifi_quote_rejected",
    "route_unsupported",
    "quote_unavailable",
    "routing_unavailable",
    "dex_quote_failed",
    "across_ticker_unsupported",
    "execution_reverted",
    "insufficient_funds",
    "insufficient_native_gas_balance",
    "executor_output_below_refill_target",
    "signer_execution_failed",
  ].includes(reason);
}

function compactRefillExecution(job, preview, execution = null) {
  const executionStatus = execution ? refillExecutionStatus(execution) : null;
  const delivered = refillDeliveredStatus(executionStatus);
  return {
    jobId: job.jobId,
    refillSource: job.autopilotRefillSource || job.jobSourceStore || null,
    chain: job.chain,
    asset: job.asset,
    targetAmountDecimal: job.targetAmountDecimal ?? null,
    executionMethod: job.executionMethod,
    selectedExecutionMethod: refillSelectedMethod(execution || preview, job.executionMethod),
    previewStatus: execution ? null : refillPreviewStatus(preview),
    previewBlockedReason: refillPreparationReady(preview?.json) ? null : refillPreviewBlockedReason(preview),
    routeAttemptReasons: preview?.json?.preparation?.routeAttemptReasons || [],
    routeDeferralReason: preview?.json?.preparation?.routeDeferralReason || null,
    routeDeferralAction: preview?.json?.preparation?.routeDeferralAction || null,
    attempted: Boolean(execution),
    executed: delivered,
    executionStatus,
    executionBlockedReason: execution ? refillExecutionBlockedReason(execution) : null,
  };
}

function compactInboundWatcher(report = null) {
  return {
    inboundEventCount: report?.summary?.inboundEventCount ?? 0,
    operatingCapitalIngressCount: report?.summary?.operatingCapitalIngressCount ?? 0,
    paybackExcludedCount: report?.summary?.paybackExcludedCount ?? 0,
    routeReadyCount: report?.summary?.routeReadyCount ?? 0,
    manualReviewCount: report?.summary?.manualReviewCount ?? 0,
    candidateQueueCount: report?.summary?.candidateQueueCount ?? 0,
    appendedEvents: report?.appended?.events ?? null,
    appendedJobs: report?.appended?.jobs ?? null,
    appendedPendingWhitelist: report?.appended?.pendingWhitelist ?? null,
  };
}

function compactCapitalManager(report = null) {
  return {
    rebalanceDecision: report?.rebalancePlan?.decision || null,
    capitalPlanDecision: report?.capitalPlan?.decision || null,
    rebalanceActionCount: report?.rebalancePlan?.actions?.length ?? 0,
    capitalActionCount: report?.capitalPlan?.summary?.actionCount ?? 0,
    capitalBlockerCount: report?.capitalPlan?.summary?.blockerCount ?? 0,
    refillJobCount: report?.jobs?.summary?.jobCount ?? 0,
    autoRefillJobCount: (report?.jobs?.jobs || []).filter(refillJobIsAutoExecutable).length,
    estimatedAssetValueUsd: report?.jobs?.summary?.estimatedAssetValueUsd ?? 0,
  };
}

function compactMerkl(report = null) {
  return {
    status: report?.status || null,
    blockedReason: report?.blockedReason || null,
    readyCount: report?.summary?.readyCount ?? 0,
    selectedCount: report?.summary?.selectedCount ?? (report?.summary?.selectedChain ? 1 : 0),
    selectedChains: report?.summary?.selectedChains || (report?.summary?.selectedChain ? [report.summary.selectedChain] : []),
    previewReadyCount: report?.summary?.previewReadyCount ?? null,
    deliveredCount: report?.summary?.deliveredCount ?? null,
    blockedCount: report?.summary?.blockedCount ?? null,
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

function compactRepresentativeExecutionCoverage({ merklQueue = null, destinationAllocator = null, destinationRepresentative = null } = {}) {
  const merklQueuedChains = new Set(Object.keys(merklQueue?.summary?.byChain || {}));
  const merklMissingChains = merklQueue?.summary?.representativeCoverage?.missingChains || [];
  const representativeCoveredChains = new Set(
    (destinationRepresentative?.candidates || [])
      .filter((candidate) => candidate.status === "covered" || candidate.status === "ready" || candidate.status === "queued")
      .map((candidate) => candidate.chain)
      .filter(Boolean),
  );
  const allocatorReadyChains = destinationAllocator?.summary?.tier1ActiveReadyChains || [];
  const allocatorReviewOnlyChains = destinationAllocator?.summary?.tier2ReviewOnlyChains || [];
  const allocatorReadyButNotQueuedChains = allocatorReadyChains.filter(
    (chain) => !merklQueuedChains.has(chain) && !representativeCoveredChains.has(chain),
  );
  return {
    merklQueuedChains: [...merklQueuedChains],
    merklMissingChains,
    representativeCoveredChains: [...representativeCoveredChains],
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
    executedCandidateCount: report?.summary?.executedCandidateCount ?? 0,
    broadcastStepCount: report?.summary?.broadcastStepCount ?? 0,
    executionBudget: report?.summary?.executionBudget || null,
    deliveredCount: report?.summary?.deliveredCount ?? 0,
    blockedCount: report?.summary?.blockedCount ?? 0,
    chainsTouched: [...new Set((report?.results || [])
      .filter((item) => item.execution?.lastTxHash || item.status === "preview_ready" || item.status === "delivered")
      .map((item) => item.candidate?.chain)
      .filter(Boolean))],
  };
}

function compactRadarSync(report = null) {
  return {
    status: report?.status || null,
    observedCount: report?.observedCount ?? 0,
    candidateCount: report?.candidateCount ?? 0,
    observationsWritten: report?.observationsWritten ?? 0,
    candidatesWritten: report?.candidatesWritten ?? 0,
    skippedCandidateCount: report?.skippedCandidates?.length ?? 0,
  };
}

function compactRadarBoard(report = null) {
  return {
    observedCount: report?.summary?.observedCount ?? 0,
    strategyEpisodeCount: report?.summary?.strategyEpisodeCount ?? 0,
    portablePacketCount: report?.summary?.portablePacketCount ?? 0,
    executableCount: report?.summary?.executableCount ?? 0,
    blockerCounts: report?.blockerCounts || {},
  };
}

function receiptDiscretionaryCategory(entry = {}) {
  const kind = String(entry?.kind || entry?.receiptKind || entry?.routeKind || "").trim().toLowerCase();
  return DISCRETIONARY_RECEIPT_KIND_TO_CATEGORY[kind] || null;
}

function normalizeDiscretionarySliceEntry(entry = {}) {
  const category = receiptDiscretionaryCategory(entry);
  if (!category) return null;
  return {
    ...entry,
    category,
    discretionaryBudgetCategory: category,
  };
}

function refillDiscretionaryCategory({ job = {}, preview = null } = {}) {
  if (job.type === "refill_native" && job.executionMethod === "same_chain_token_to_native_swap") {
    return "refuel";
  }
  const executor = String(preview?.json?.preparation?.executor || "").trim();
  if (executor && DISCRETIONARY_REFILL_EXECUTOR_TO_CATEGORY[executor]) {
    return DISCRETIONARY_REFILL_EXECUTOR_TO_CATEGORY[executor];
  }
  const method = String(refillSelectedMethod(preview || {}, job.executionMethod) || job.executionMethod || "").trim();
  return DISCRETIONARY_REFILL_METHOD_TO_CATEGORY[method] || null;
}

function refillDiscretionaryIntent({ job = {}, preview = null, category = null, now } = {}) {
  const preparation = preview?.json?.preparation || {};
  const discretionaryBudget = preparation.discretionaryBudget || {};
  const plan = preparation.plan || {};
  const classification =
    job?.movementBudget?.classification ||
    job?.classification ||
    job?.strategyPolicy?.classification ||
    null;
  const discretionaryBudgetUsd = [
    discretionaryBudget.quoteCostUsd,
    discretionaryBudget.bridgeQuoteCostUsd,
    job?.movementBudget?.bridgeQuoteCostUsd,
    job?.fundingSource?.expectedExecutionRefillCostUsd,
    category === "refuel" ? plan?.amountUsd : null,
  ].map(finiteNumber).find(Number.isFinite) ?? null;
  return {
    discretionaryBudgetCategory: category,
    discretionaryBudgetUsd,
    classification,
    observedAt: now,
    now,
    metadata: {
      classification,
      liveInventoryDependencyOverride: job?.movementBudget?.liveInventoryDependencyOverride === true,
    },
  };
}

function applyDiscretionaryBudgetBlock(preview, verdict, category) {
  return {
    ...preview,
    json: {
      ...(preview?.json || {}),
      preparation: {
        ...(preview?.json?.preparation || {}),
        status: "blocked",
        blockedReason: verdict.blockers?.[0] || "discretionary_budget_24h_category_exhausted",
        discretionaryBudget: {
          ...(preview?.json?.preparation?.discretionaryBudget || {}),
          category,
          allowed: false,
          blockers: verdict.blockers || [],
          runningTotalUsd: verdict.runningTotalUsd ?? 0,
        },
      },
    },
  };
}

function compactStrategyDispatch(report = null, { capitalDispatchReadiness = null } = {}) {
  const currentResults = report?.record?.strategyResults || [];
  const currentSucceeded = currentResults.filter((item) => item.executionStatus === "succeeded").length;
  const currentFailed = currentResults.filter((item) => item.executionStatus === "failed").length;
  return {
    dispatchId: report?.record?.dispatchId || null,
    batchStatus: report?.record?.batchStatus || null,
    selectedCount: report?.record?.selectedCount ?? 0,
    successCount: currentResults.length ? currentSucceeded : report?.summary?.successCount ?? null,
    failedCount: currentResults.length ? currentFailed : report?.summary?.failureCount ?? null,
    liveEligibleCount: report?.executionSurfaces?.summary?.liveEligibleCount ?? null,
    missingExecutorCount: report?.executionSurfaces?.summary?.missingExecutorCount ?? null,
    orchestrationSource: report?.record?.orchestration?.source || null,
    orchestratorRunId: report?.record?.orchestration?.runId || null,
    capitalDispatchReadiness,
    planningBridge: report?.planningBridge
      ? {
          authority: report.planningBridge.authority || null,
          candidateCount: report.planningBridge.candidateCount ?? 0,
          topCandidateId: report.planningBridge.topCandidateId || null,
        }
      : null,
  };
}

function compactWrappedBtcHandoff(preview = null, execution = null) {
  const active = execution?.json || preview?.json || null;
  const executionStatus = execution?.json?.execution?.handoffStatus || execution?.json?.execution?.conversionExecution?.settlementStatus || null;
  return {
    previewStatus: preview?.json?.plan?.handoffStatus || null,
    amountSats: preview?.json?.plan?.amountSats || null,
    conversionOutputAmount: preview?.json?.plan?.conversionPlan?.quote?.outputAmount || null,
    attempted: Boolean(execution),
    executionStatus,
    blockedReason:
      active?.plan?.blockedReason ||
      active?.execution?.blockedReason ||
      active?.error?.message ||
      preview?.error?.message ||
      execution?.error?.message ||
      null,
  };
}

function compactPayback(report = null) {
  return {
    status: report?.status || null,
    reason: report?.reason || null,
    plannedPaybackSats: report?.compositePlan?.plannedPaybackSats ?? null,
    pendingCarrySats: report?.decision?.snapshot?.pendingDeferredSats ?? report?.decision?.snapshot?.pendingCarrySats ?? null,
    nextAction: report?.nextAction || null,
  };
}

function compactAutoKill(report = null) {
  if (!report) return null;
  return {
    triggered: report.triggered === true,
    killSwitchActive: report.killSwitchActive === true || report.alreadyArmed === true,
    alreadyArmed: report.alreadyArmed === true,
    killSwitchWritten: report.killSwitchWritten === true,
    killSwitchPath: report.killSwitchPath ?? null,
    triggers: Array.isArray(report.triggers) ? report.triggers.map((trigger) => trigger.trigger).filter(Boolean) : [],
  };
}

function buildLiveExecutionGate({ execute = false, autoKillStep = null } = {}) {
  if (!execute) {
    return {
      requestedExecute: false,
      liveCapableStepExecution: false,
      blockedReason: "preview_only",
    };
  }
  if (!autoKillStep?.ok || !autoKillStep?.json) {
    return {
      requestedExecute: true,
      liveCapableStepExecution: false,
      blockedReason: "auto_kill_check_unavailable",
    };
  }
  if (autoKillStep.json.triggered === true) {
    return {
      requestedExecute: true,
      liveCapableStepExecution: false,
      blockedReason: "auto_kill_triggered",
    };
  }
  if (autoKillStep.json.killSwitchActive === true || autoKillStep.json.alreadyArmed === true) {
    return {
      requestedExecute: true,
      liveCapableStepExecution: false,
      blockedReason: "kill_switch_armed",
    };
  }
  return {
    requestedExecute: true,
    liveCapableStepExecution: true,
    blockedReason: null,
  };
}

function stepStatus(step = {}) {
  return step.json?.status || step.json?.record?.batchStatus || step.json?.decision || step.json?.event?.status || null;
}

function stepIsRecoverable(step, steps) {
  if (step.name === "treasury_refill_plan") {
    return steps.some((item) => item.name === "treasury_refill_plan_stored_snapshot_fallback" && item.ok && item.json);
  }
  if (step.name === "capital_manager_refill_plan") {
    return steps.some((item) => item.name === "capital_manager_refill_plan_stored_snapshot_fallback" && item.ok && item.json);
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
  if (step.name === "merkl_canary_autopilot" || step.name === "merkl_portfolio_orchestrator") {
    return true;
  }
  if (step.name === "wrapped_btc_loop_handoff_preview" || step.name === "wrapped_btc_loop_handoff_execute") {
    return true;
  }
  if (step.name === "treasury_inventory_refresh_pre_dispatch") {
    return true;
  }
  if (step.name === "treasury_inventory_refresh_after_wrapped_btc_handoff") {
    return true;
  }
  if (step.name === "auto_kill_check") {
    return step.json?.triggered === true;
  }
  if (step.name === "btc_oracle_snapshot") {
    return Array.isArray(step.json?.samples);
  }
  const status = stepStatus(step);
  return ["blocked", "carry", "hold", "skipped", "completed", "succeeded"].includes(status);
}

function wrappedBtcLoopSurface(report = null) {
  return (report?.strategies || []).find((strategy) => strategy.id === WRAPPED_BTC_LOOP_STRATEGY_ID) || null;
}

function tokenInventoryItem(inventory = null, { chain, token } = {}) {
  const normalizedToken = String(token || "").toLowerCase();
  return (inventory?.tokens || []).find(
    (item) => String(item?.chain || "").toLowerCase() === chain && String(item?.token || "").toLowerCase() === normalizedToken,
  ) || null;
}

function wrappedBtcHandoffAmountSats(executionSurfaces = null, inventory = null) {
  const strategy = wrappedBtcLoopSurface(executionSurfaces);
  const source = tokenInventoryItem(inventory, { chain: "base", token: BASE_WBTC_OFT_TOKEN });
  const availableSourceUnits = BigInt(source?.actual || "0");
  if (availableSourceUnits <= 0n) return null;
  const blockers = new Set(strategy?.liveAdmissionBlockers || []);
  const sourceUsd = Number(source?.estimatedUsd || 0);
  const proactiveEligible =
    sourceUsd >= MIN_WRAPPED_BTC_HANDOFF_USD &&
    strategy &&
    strategy.autoExecute !== false &&
    !blockers.has("strategy_disabled");
  if (!blockers.has("base_cbbtc_collateral_unavailable") && !proactiveEligible) return null;
  const evidence = strategy?.evidence || {};
  const requiredUnits = evidence.baseCbBtcRequiredUnits ? BigInt(evidence.baseCbBtcRequiredUnits) : null;
  const actualUnits = BigInt(evidence.baseCbBtcCollateralUnits || "0");
  const tinyCapUsd = Number(evidence.livePerTradeCapUsd || getStrategyCaps(WRAPPED_BTC_LOOP_STRATEGY_ID)?.caps?.tinyLivePerTxUsd || 25);
  const priceUsd = Number(evidence.baseCbBtcPriceUsd || source?.priceUsd || 0);
  const fallbackRequiredUnits = priceUsd > 0 ? BigInt(Math.ceil((tinyCapUsd / priceUsd) * 100_000_000)) : 34_000n;
  const resolvedRequiredUnits = requiredUnits || fallbackRequiredUnits;
  if (actualUnits >= resolvedRequiredUnits) return null;
  const deficit = resolvedRequiredUnits - actualUnits;
  const slippageBuffer = (resolvedRequiredUnits + 99n) / 100n;
  const minHandoffUnits = priceUsd > 0 ? BigInt(Math.ceil((MIN_WRAPPED_BTC_HANDOFF_USD / priceUsd) * 100_000_000)) : 7_000n;
  const amount = [deficit + slippageBuffer, availableSourceUnits].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0];
  if (amount < minHandoffUnits) return null;
  return amount > 0n ? amount.toString() : null;
}

function refillSourcePriority(source) {
  if (source === "capital_manager") return 0;
  if (source === "treasury") return 1;
  if (source === "inbound_routing") return 2;
  return 99;
}

function refillPriorityRank(job = {}) {
  if (job.priority === "high") return 0;
  if (job.priority === "medium") return 1;
  if (job.priority === "low") return 2;
  return 3;
}

function refillMergeKey(job = {}) {
  if (job.sourceEventId) return `event:${job.sourceEventId}`;
  if (job.resourceKey) return `resource:${job.resourceKey}`;
  if (job.type && job.chain && (job.token || job.asset)) {
    return `asset:${job.type}:${job.chain}:${job.token || job.asset}`;
  }
  return `job:${job.jobId}`;
}

function positiveBigIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function sourceIsNative(source = {}) {
  return source?.isNative === true || normalizedToken(source?.token) === "0x0000000000000000000000000000000000000000";
}

function signerResultTxHash(result = {}) {
  return result?.broadcast?.txHash || result?.txHash || result?.receipt?.transactionHash || null;
}

function refillStepTxHash(step = {}) {
  return signerResultTxHash(step?.signerResult) || signerResultTxHash(step) || null;
}

function refillStepLikelyDebitsSource(step = {}) {
  if (!refillStepTxHash(step)) return false;
  const id = String(step?.id || step?.stepId || "").trim();
  if (!id) return true;
  if (/^approve_/iu.test(id)) return false;
  if (/^reset_.*allowance$/iu.test(id)) return false;
  return true;
}

function refillExecutionStepResults(execution = null) {
  if (!execution || typeof execution !== "object") return [];
  const stepResults = [];
  const stack = [execution];
  const seen = new Set();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item.stepResults)) stepResults.push(...item.stepResults);
    for (const key of ["step1Result", "step2Result", "step3Result", "sourceExecution", "bridgeExecution", "destinationExecution"]) {
      if (item[key] && typeof item[key] === "object") stack.push(item[key]);
    }
  }
  return stepResults;
}

function refillExecutionHasSourceDebitBroadcast(result = {}) {
  return refillExecutionStepResults(result?.json?.execution || result).some(refillStepLikelyDebitsSource);
}

function refillSourceReservationKey(job = {}) {
  const source = job?.fundingSource?.source || null;
  if (!source?.chain || !source?.token) return null;
  return `${String(source.chain).toLowerCase()}:${normalizedToken(source.token)}`;
}

function estimatedSourceReservationAmount(job = {}) {
  const source = job?.fundingSource?.source || null;
  const sourceActual = positiveBigIntOrNull(source?.actual);
  const sourceActualDecimal = Number(source?.actualDecimal);
  const sourceEstimatedUsd = Number(source?.estimatedUsd);
  const targetEstimatedUsd = Number(job?.estimatedAssetValueUsd);
  if (
    !sourceActual ||
    !Number.isFinite(sourceActualDecimal) ||
    !(sourceActualDecimal > 0) ||
    !Number.isFinite(sourceEstimatedUsd) ||
    !(sourceEstimatedUsd > 0) ||
    !Number.isFinite(targetEstimatedUsd) ||
    !(targetEstimatedUsd > 0)
  ) {
    return null;
  }
  const unitsPerWhole = Number(sourceActual) / sourceActualDecimal;
  if (!Number.isFinite(unitsPerWhole) || !(unitsPerWhole > 0)) return null;
  const sourceUnitUsd = sourceEstimatedUsd / sourceActualDecimal;
  const estimatedSourceDecimal = Math.min(sourceActualDecimal, (targetEstimatedUsd * 1.1) / sourceUnitUsd);
  const estimated = BigInt(Math.max(1, Math.ceil(estimatedSourceDecimal * unitsPerWhole)));
  return estimated > sourceActual ? sourceActual : estimated;
}

function refillSourceReservationAmount(job = {}) {
  const source = job?.fundingSource?.source || null;
  const targetAmount = positiveBigIntOrNull(job?.targetAmount);
  const sourceActual = positiveBigIntOrNull(source?.actual);
  if (!sourceActual) return null;
  if (
    job.type === "refill_token" &&
    targetAmount &&
    normalizedToken(source?.token) === normalizedToken(job?.token)
  ) {
    return targetAmount;
  }
  if (
    job.type === "refill_native" &&
    targetAmount &&
    String(source?.chain || "").toLowerCase() === String(job?.chain || "").toLowerCase() &&
    sourceIsNative(source)
  ) {
    return targetAmount;
  }
  return estimatedSourceReservationAmount(job) || targetAmount || null;
}

function refillSourceReservation(job = {}, reservations = new Map()) {
  const key = refillSourceReservationKey(job);
  const sourceActual = positiveBigIntOrNull(job?.fundingSource?.source?.actual);
  const amount = refillSourceReservationAmount(job);
  if (!key || !sourceActual || !amount) {
    return {
      accepted: true,
      key,
      amount,
      sourceActual,
      reservedBefore: reservations.get(key) || 0n,
      remaining: null,
    };
  }
  const reservedBefore = reservations.get(key) || 0n;
  const remaining = sourceActual > reservedBefore ? sourceActual - reservedBefore : 0n;
  return {
    accepted: amount <= remaining,
    key,
    amount,
    sourceActual,
    reservedBefore,
    remaining,
  };
}

function reserveRefillSource(reservations, reservation) {
  if (!reservation?.key || !reservation?.amount) return;
  reservations.set(reservation.key, (reservations.get(reservation.key) || 0n) + reservation.amount);
}

function refillSourceDebitLikely(execution = null) {
  const status = refillExecutionStatus(execution);
  return refillDeliveredStatus(status) || status === "source_confirmed_only" || refillExecutionHasSourceDebitBroadcast(execution);
}

function refillJobForSelectedMethod(job = {}, method = null) {
  if (!method) return job;
  const candidate = refillExecutionCandidates(job).find((item) => item.method === method) || null;
  if (!candidate || !refillCandidateExecutable(candidate)) return job;
  return jobWithCandidate(job, candidate);
}

function blockedRefillPreview(job = {}, blockedReason) {
  return {
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    json: {
      preparation: {
        status: "blocked",
        executionMethod: job.executionMethod || null,
        blockedReason,
      },
    },
  };
}

function annotateRefillJobs(jobs = [], source = null) {
  return (jobs || []).map((job) => ({
    ...job,
    autopilotRefillSource: source,
  }));
}

function mergeAutopilotRefillJobs(jobGroups = []) {
  const merged = new Map();
  for (const { source, jobs = [] } of jobGroups) {
    for (const job of annotateRefillJobs(jobs, source)) {
      const key = refillMergeKey(job);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, job);
        continue;
      }
      if (refillSourcePriority(job.autopilotRefillSource) < refillSourcePriority(existing.autopilotRefillSource)) {
        merged.set(key, job);
      }
    }
  }
  return [...merged.values()].sort((left, right) =>
    refillPriorityRank(left) - refillPriorityRank(right) ||
    refillSourcePriority(left.autopilotRefillSource) - refillSourcePriority(right.autopilotRefillSource) ||
    String(left.chain || "").localeCompare(String(right.chain || "")) ||
    String(left.asset || "").localeCompare(String(right.asset || "")) ||
    String(left.jobId || "").localeCompare(String(right.jobId || "")),
  );
}

function buildAutopilotProgressReport({
  execute = false,
  observedAt = new Date().toISOString(),
  autopilotRunId = null,
  chains = [],
  phase = "running",
  summary = {},
  refillExecutions = [],
  steps = [],
} = {}) {
  return {
    schemaVersion: 1,
    observedAt,
    autopilotRunId,
    mode: execute ? "execute" : "preview",
    status: "running",
    phase,
    blockedReason: null,
    chains,
    summary,
    refillExecutions,
    steps,
  };
}

async function writeAutopilotLatest(dataDir, report) {
  await writeTextIfChanged(join(dataDir, "all-chain-autopilot-latest.json"), `${safeJsonStringify(report, 2)}\n`);
}

async function writeAutopilotLatestCompleted(dataDir, report) {
  await writeTextIfChanged(join(dataDir, "all-chain-autopilot-latest-completed.json"), `${safeJsonStringify(report, 2)}\n`);
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
  maxRefillJobs = 24,
  canaryLimit = 11,
  canaryMaxExecutedCandidates = 1,
  canaryMaxBroadcastSteps = 4,
  canaryMaxRecentBroadcasts = 1,
  canaryRecentBroadcastWindowMs = 10 * 60_000,
  enableDexProbeExecution = false,
  canaryTimeoutMs = 600_000,
  dispatchTimeoutMs = 600_000,
  runCommandImpl = defaultRunCommand,
  readJsonlImpl = readJsonl,
  dataDir = config.dataDir,
  bootstrapBtcSats = null,
  bootstrapBtcPriceUsd = null,
  bootstrapTotalCapitalUsd = null,
} = {}) {
  const observedAt = new Date().toISOString();
  const autopilotRunId = randomUUID();
  const steps = [];
  const refillExecutions = [];
  let discretionary24hSlicePromise = null;

  async function discretionary24hSlice() {
    if (!discretionary24hSlicePromise) {
      discretionary24hSlicePromise = readJsonlImpl(dataDir, "receipt-reconciliations").then((entries) => {
        const cutoffMs = timestampMs(observedAt) - 24 * 60 * 60 * 1000;
        return entries
          .filter((entry) => {
            const observedEntryMs = timestampMs(entry?.observedAt || entry?.timestamp);
            return Number.isFinite(observedEntryMs) && observedEntryMs > cutoffMs;
          })
          .map(normalizeDiscretionarySliceEntry)
          .filter(Boolean);
      });
    }
    return discretionary24hSlicePromise;
  }

  async function evaluateAutopilotDiscretionaryBudget(category, intent = {}) {
    if (!category) {
      return {
        allowed: true,
        blockers: [],
        runningTotalUsd: 0,
      };
    }
    return evaluateDiscretionaryBudget(category, intent, await discretionary24hSlice());
  }

  await runJsonStep({
    name: "gas_snapshot_refresh",
    args: ["src/cli/gas-snapshot.mjs"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const hasBootstrapInput =
    Number.isFinite(bootstrapTotalCapitalUsd) ||
    (Number.isFinite(bootstrapBtcSats) && Number.isFinite(bootstrapBtcPriceUsd));
  if (hasBootstrapInput) {
    const bootstrapArgs = ["src/cli/run-bootstrap-from-btc.mjs", "--json", "--write"];
    if (Number.isFinite(bootstrapTotalCapitalUsd)) {
      bootstrapArgs.push(`--total-capital-usd=${bootstrapTotalCapitalUsd}`);
    }
    if (Number.isFinite(bootstrapBtcSats)) {
      bootstrapArgs.push(`--btc-balance-sats=${bootstrapBtcSats}`);
    }
    if (Number.isFinite(bootstrapBtcPriceUsd)) {
      bootstrapArgs.push(`--btc-price-usd=${bootstrapBtcPriceUsd}`);
    }
    await runJsonStep({
      name: "bootstrap_from_btc",
      args: bootstrapArgs,
      runCommandImpl,
      cwd,
      timeoutMs,
      steps,
    });
  }

  const heartbeatPathArg = getEnv("EXECUTOR_HEARTBEAT_PATH", null);
  const oraclesPathArg = getEnv("AUTO_KILL_ORACLES_PATH", join("data", "oracles", "btc-latest.json"));
  await runJsonStep({
    name: "btc_oracle_snapshot",
    args: ["src/cli/snapshot-btc-oracles.mjs", "--json", "--write", `--path=${oraclesPathArg}`],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  await runJsonStep({
    name: "price_snapshot_refresh",
    args: ["src/cli/price-snapshot.mjs"],
    runCommandImpl,
    cwd,
    timeoutMs: Math.min(30_000, timeoutMs),
    steps,
  });

  await runJsonStep({
    name: "campaign_aware_opportunities",
    args: ["src/cli/report-campaign-aware-opportunities.mjs", "--json"],
    runCommandImpl,
    cwd,
    timeoutMs: Math.min(30_000, timeoutMs),
    steps,
  });

  await runJsonStep({
    name: "anchor_position_health",
    args: ["src/cli/report-anchor-position-health.mjs", "--json"],
    runCommandImpl,
    cwd,
    timeoutMs: Math.min(30_000, timeoutMs),
    steps,
  });

  await runJsonStep({
    name: "aggregate_auto_kill_inputs",
    args: ["src/cli/aggregate-auto-kill-inputs.mjs"],
    runCommandImpl,
    cwd,
    timeoutMs: Math.min(15_000, timeoutMs),
    steps,
  });

  const autoKillArgs = [
    "src/cli/run-auto-kill-check.mjs",
    "--json",
    `--oracles-path=${oraclesPathArg}`,
    `--price-samples-path=data/price-samples.json`,
    `--cl-status-path=data/anchor-position-health.json`,
    `--active-protocols-path=data/active-protocols.json`,
    `--campaign-status-path=data/campaign-status.json`,
  ];
  if (heartbeatPathArg) autoKillArgs.push(`--heartbeat-path=${heartbeatPathArg}`);
  const autoKillResult = await runJsonStep({
    name: "auto_kill_check",
    args: autoKillArgs,
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });
  const liveExecutionGate = buildLiveExecutionGate({
    execute,
    autoKillStep: autoKillResult,
  });
  const allowLiveCapableExecution = liveExecutionGate.liveCapableStepExecution === true;

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

  let capitalManagerRefillPlanResult = await runJsonStep({
    name: "capital_manager_refill_plan",
    args: ["src/cli/plan-capital-manager-refill-jobs.mjs", "--json", "--write", "--refresh-inventory"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });
  if (!capitalManagerRefillPlanResult.json) {
    capitalManagerRefillPlanResult = await runJsonStep({
      name: "capital_manager_refill_plan_stored_snapshot_fallback",
      args: ["src/cli/plan-capital-manager-refill-jobs.mjs", "--json", "--write"],
      runCommandImpl,
      cwd,
      timeoutMs,
      steps,
    });
  }
  const capitalManagerRefillPlan = capitalManagerRefillPlanResult.json;

  const inboundWatcherResult = await runJsonStep({
    name: "inbound_inventory_watcher",
    args: ["src/cli/run-inbound-inventory-watcher.mjs", "--json", "--write"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const treasuryInventoryBlocker = inventoryFreshnessBlocker(refillPlan, "treasury");
  const capitalManagerInventoryBlocker = inventoryFreshnessBlocker(capitalManagerRefillPlan, "capital_manager");
  const treasuryRefillJobs = suppressAutoRefillJobsForInventoryBlocker(refillPlan?.jobs || [], treasuryInventoryBlocker);
  const capitalManagerRefillJobs = suppressAutoRefillJobsForInventoryBlocker(
    capitalManagerRefillPlan?.jobs?.jobs || [],
    capitalManagerInventoryBlocker,
  );

  const mergedRefillJobs = mergeAutopilotRefillJobs([
    { source: "treasury", jobs: treasuryRefillJobs },
    { source: "capital_manager", jobs: capitalManagerRefillJobs },
    { source: "inbound_routing", jobs: inboundWatcherResult.json?.routingPlan?.jobs || [] },
  ]);
  const autoRefillJobs = mergedRefillJobs.filter(refillJobIsAutoExecutable).slice(0, maxRefillJobs);
  const sourceReservations = new Map();

  for (const job of autoRefillJobs) {
    const sourceReservation = allowLiveCapableExecution
      ? refillSourceReservation(job, sourceReservations)
      : { accepted: true };
    if (!sourceReservation.accepted) {
      const preview = blockedRefillPreview(job, "source_inventory_reserved");
      steps.push(commandStep(`treasury_refill_preview:${job.jobId}:source_inventory_reserved`, [], preview));
      refillExecutions.push(compactRefillExecution(job, preview, null));
      continue;
    }
    let preview = await runJsonStep({
      name: `treasury_refill_preview:${job.jobId}`,
      args: ["src/cli/run-refill-job-stub.mjs", `--job-id=${job.jobId}`, "--json"],
      runCommandImpl,
      cwd,
      timeoutMs,
      steps,
    });
    const routeAttemptReasons = [];
    const firstAttemptReason = refillRouteAttemptReason(preview, { method: job.executionMethod });
    if (firstAttemptReason) routeAttemptReasons.push(firstAttemptReason);
    if (refillPreviewRetryable(preview, { activeMethod: job.executionMethod })) {
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
        const attemptReason = refillRouteAttemptReason(alternatePreview, { method });
        if (attemptReason) routeAttemptReasons.push(attemptReason);
        if (refillPreparationReady(preview.json) || !refillPreviewRetryable(preview, { activeMethod: method })) break;
      }
      if (refillPreviewRetryable(preview, { activeMethod: refillSelectedMethod(preview, job.executionMethod) })) {
        preview = routingExhaustedPreparation(preview, routeAttemptReasons);
        steps[steps.length - 1] = commandStep(steps[steps.length - 1]?.name || `treasury_refill_preview:${job.jobId}`, steps[steps.length - 1]?.args || [], preview);
      }
    }
    let execution = null;
    let debitSourceReservation = null;
    if (allowLiveCapableExecution && refillPreparationReady(preview.json)) {
      while (refillPreparationReady(preview.json)) {
        const discretionaryCategory = refillDiscretionaryCategory({ job, preview });
        if (discretionaryCategory) {
          const discretionaryVerdict = await evaluateAutopilotDiscretionaryBudget(
            discretionaryCategory,
            refillDiscretionaryIntent({
              job,
              preview,
              category: discretionaryCategory,
              now: observedAt,
            }),
          );
          if (!discretionaryVerdict.allowed) {
            preview = applyDiscretionaryBudgetBlock(preview, discretionaryVerdict, discretionaryCategory);
            break;
          }
        }
        const method = refillSelectedMethod(preview, job.executionMethod);
        const activeJob = refillJobForSelectedMethod(job, method);
        const activeSourceReservation = refillSourceReservation(activeJob, sourceReservations);
        if (!activeSourceReservation.accepted) {
          preview = blockedRefillPreview(activeJob, "source_inventory_reserved");
          steps.push(commandStep(`treasury_refill_preview:${job.jobId}:${method}:source_inventory_reserved`, [], preview));
          break;
        }
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
        if (refillSourceDebitLikely(execution)) {
          debitSourceReservation = activeSourceReservation;
        }
        if (!refillExecutionRetryable(execution, { activeMethod: method })) break;
        const retryMethods = forcedRefillMethodArgs(job, method);
        let nextPreview = null;
        for (const retryMethod of retryMethods) {
          nextPreview = await runJsonStep({
            name: `treasury_refill_preview:${job.jobId}:${retryMethod}`,
            args: ["src/cli/run-refill-job-stub.mjs", `--job-id=${job.jobId}`, `--method=${retryMethod}`, "--json"],
            runCommandImpl,
            cwd,
            timeoutMs,
            steps,
          });
          const attemptReason = refillRouteAttemptReason(nextPreview, { method: retryMethod });
          if (attemptReason) routeAttemptReasons.push(attemptReason);
          if (refillPreparationReady(nextPreview.json) || !refillPreviewRetryable(nextPreview, { activeMethod: retryMethod })) break;
        }
        if (!nextPreview) break;
        preview = nextPreview;
        if (refillPreviewRetryable(preview, { activeMethod: refillSelectedMethod(preview, job.executionMethod) })) {
          preview = routingExhaustedPreparation(preview, routeAttemptReasons);
          steps[steps.length - 1] = commandStep(
            steps[steps.length - 1]?.name || `treasury_refill_preview:${job.jobId}`,
            steps[steps.length - 1]?.args || [],
            preview,
          );
        }
        if (!refillPreparationReady(preview.json)) break;
      }
    }
    if (debitSourceReservation) {
      reserveRefillSource(sourceReservations, debitSourceReservation);
    }
    refillExecutions.push(compactRefillExecution(job, preview, execution));
  }

  const capitalManagerExecutedCount = refillExecutions.filter(
    (item) => item.refillSource === "capital_manager" && item.executed,
  ).length;
  const capitalDispatchReadiness =
    capitalManagerRefillPlan?.capitalPlan?.decision === "REFILL_REQUIRED" && capitalManagerExecutedCount === 0
      ? "refill_pending_individual_strategy_gates_enforced"
      : "ready";
  const allowLiveStrategyDispatch = allowLiveCapableExecution;

  if (write) {
    await writeAutopilotLatest(dataDir, buildAutopilotProgressReport({
      execute,
      observedAt: new Date().toISOString(),
      autopilotRunId,
      chains,
      phase: "refill_complete",
      summary: {
        officialChainCount: chains.length,
        refillJobCount: mergedRefillJobs.length,
        treasuryRefillJobCount: refillPlan?.summary?.jobCount ?? 0,
        capitalManagerRefillJobCount: capitalManagerRefillPlan?.jobs?.summary?.jobCount ?? 0,
        inboundRouteJobCount: inboundWatcherResult.json?.routingPlan?.jobs?.length ?? 0,
        autoRefillJobCount: autoRefillJobs.length,
        refillAttemptedCount: refillExecutions.filter((item) => item.attempted).length,
        refillExecutedCount: refillExecutions.filter((item) => item.executed).length,
        autoRefillSourceCounts: autoRefillJobs.reduce((counts, job) => {
          const key = job.autopilotRefillSource || "unknown";
          counts[key] = (counts[key] || 0) + 1;
          return counts;
        }, {}),
        inboundInventory: compactInboundWatcher(inboundWatcherResult.json),
        inventoryFreshness: {
          treasuryBlocker: treasuryInventoryBlocker,
          capitalManagerBlocker: capitalManagerInventoryBlocker,
        },
        capitalManager: compactCapitalManager(capitalManagerRefillPlan),
        executionGate: {
          ...liveExecutionGate,
          autopilotRunId,
          autoKillTriggered: autoKillResult.json?.triggered === true,
          killSwitchActive: autoKillResult.json?.killSwitchActive === true || autoKillResult.json?.alreadyArmed === true,
          killSwitchAlreadyArmed: autoKillResult.json?.alreadyArmed === true,
        },
        strategyDispatch: {
          capitalDispatchReadiness,
        },
      },
      refillExecutions,
      steps,
    }));
  }

  const canaryBudgetVerdict = allowLiveCapableExecution
    ? await evaluateAutopilotDiscretionaryBudget("probe", {
      discretionaryBudgetCategory: "probe",
      observedAt,
      now: observedAt,
    })
    : { allowed: false, blockers: [], runningTotalUsd: 0 };
  const allowProbeExecution = allowLiveCapableExecution && canaryBudgetVerdict.allowed && enableDexProbeExecution;
  const canarySweepResult = await runJsonStep({
    name: "live_canary_sweep",
    args: appendFlag([
      "src/cli/run-live-canary-sweep.mjs",
      "--json",
      "--write",
      `--chains=${chains.join(",")}`,
      `--limit=${canaryLimit}`,
      `--max-executed-candidates=${canaryMaxExecutedCandidates}`,
      `--max-broadcast-steps=${canaryMaxBroadcastSteps}`,
      `--max-recent-broadcasts=${canaryMaxRecentBroadcasts}`,
      `--recent-broadcast-window-ms=${canaryRecentBroadcastWindowMs}`,
      `--timeout-ms=${canaryTimeoutMs}`,
    ], "--execute", allowProbeExecution),
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

  const radarMerklSyncResult = await runJsonStep({
    name: "radar_merkl_queue_sync",
    args: ["src/cli/sync-radar-from-merkl-queue.mjs", "--json"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const radarBoardResult = await runJsonStep({
    name: "radar_board_refresh",
    args: ["src/cli/report-radar-board.mjs", "--json", "--write=data/radar-board.json"],
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
    ], "--execute", allowLiveCapableExecution),
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const merklCanaryResult = await runJsonStep({
    name: "merkl_canary_autopilot",
    args: appendFlag([
      "src/cli/run-merkl-canary-autopilot.mjs",
      "--json",
      "--write",
      `--timeout-ms=${timeoutMs}`,
    ], "--execute", allowLiveCapableExecution),
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const portfolioResult = await runJsonStep({
    name: "merkl_portfolio_orchestrator",
    args: appendFlag([
      "src/cli/run-merkl-portfolio-orchestrator.mjs",
      "--json",
      "--write",
      `--timeout-ms=${timeoutMs}`,
    ], "--execute", allowLiveCapableExecution),
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const preDispatchInventoryResult = await runJsonStep({
    name: "treasury_inventory_refresh_pre_dispatch",
    args: ["src/cli/inventory-treasury.mjs", "--json"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const preDispatchSurfacesResult = await runJsonStep({
    name: "strategy_execution_surfaces_pre_dispatch",
    args: ["src/cli/report-strategy-execution-surfaces.mjs", "--json", "--write"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });
  const handoffAmountSats = wrappedBtcHandoffAmountSats(preDispatchSurfacesResult.json, preDispatchInventoryResult.json);
  let wrappedBtcHandoffPreview = null;
  let wrappedBtcHandoffExecution = null;
  if (handoffAmountSats) {
    wrappedBtcHandoffPreview = await runJsonStep({
      name: "wrapped_btc_loop_handoff_preview",
      args: ["src/cli/run-wrapped-btc-loop-handoff.mjs", `--amount-sats=${handoffAmountSats}`, "--json", "--write"],
      runCommandImpl,
      cwd,
      timeoutMs,
      steps,
    });
    if (allowLiveCapableExecution && wrappedBtcHandoffPreview.json?.plan?.handoffStatus === "conversion_ready") {
      wrappedBtcHandoffExecution = await runJsonStep({
        name: "wrapped_btc_loop_handoff_execute",
        args: [
          "src/cli/run-wrapped-btc-loop-handoff.mjs",
          `--amount-sats=${handoffAmountSats}`,
          "--json",
          "--write",
          "--execute",
          `--timeout-ms=${timeoutMs}`,
          `--confirmation-timeout-ms=${timeoutMs}`,
        ],
        runCommandImpl,
        cwd,
        timeoutMs,
        steps,
      });
      if (wrappedBtcHandoffExecution.ok) {
        await runJsonStep({
          name: "treasury_inventory_refresh_after_wrapped_btc_handoff",
          args: ["src/cli/inventory-treasury.mjs", "--json"],
          runCommandImpl,
          cwd,
          timeoutMs,
          steps,
        });
      }
    }
  }

  const strategyDispatchResult = await runJsonStep({
    name: "strategy_catalog_dispatch",
    args: appendFlag([
        "src/cli/run-strategy-catalog-dispatcher.mjs",
        "--json",
        "--compact",
        "--write",
        "--continue-on-failure",
        "--mode=auto",
        ...(allowLiveStrategyDispatch ? ["--bucket=executable_now"] : []),
        "--orchestrator-source=all_chain_autopilot",
        `--orchestrator-run-id=${autopilotRunId}`,
        `--command-timeout-ms=${dispatchTimeoutMs}`,
      ], "--execute", allowLiveStrategyDispatch),
    runCommandImpl,
    cwd,
    timeoutMs: dispatchTimeoutMs,
    steps,
  });

  const paybackArgs = appendFlag(["src/cli/run-payback-scheduler.mjs", "--json", "--write", "--once"], "--execute", allowLiveCapableExecution);
  const paybackResult = await runJsonStep({
    name: "payback_scheduler",
    args: paybackArgs,
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  await runJsonStep({
    name: "auto_kill_dashboard_slice",
    args: ["src/cli/report-auto-kill-events.mjs", "--json", "--write"],
    runCommandImpl,
    cwd,
    timeoutMs,
    steps,
  });

  const summary = {
    officialChainCount: chains.length,
    refillJobCount: mergedRefillJobs.length,
    treasuryRefillJobCount: refillPlan?.summary?.jobCount ?? 0,
    capitalManagerRefillJobCount: capitalManagerRefillPlan?.jobs?.summary?.jobCount ?? 0,
    inboundRouteJobCount: inboundWatcherResult.json?.routingPlan?.jobs?.length ?? 0,
    autoRefillJobCount: autoRefillJobs.length,
    refillAttemptedCount: refillExecutions.filter((item) => item.attempted).length,
    refillExecutedCount: refillExecutions.filter((item) => item.executed).length,
    autoRefillSourceCounts: autoRefillJobs.reduce((counts, job) => {
      const key = job.autopilotRefillSource || "unknown";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    inboundInventory: compactInboundWatcher(inboundWatcherResult.json),
    inventoryFreshness: {
      treasuryBlocker: treasuryInventoryBlocker,
      capitalManagerBlocker: capitalManagerInventoryBlocker,
    },
    capitalManager: compactCapitalManager(capitalManagerRefillPlan),
    canarySweep: compactCanarySweep(canarySweepResult.json),
    merklQueue: compactMerklQueue(merklQueueResult.json),
    radarSync: compactRadarSync(radarMerklSyncResult.json),
    radarBoard: compactRadarBoard(radarBoardResult.json),
    destinationPromotionGate: {
      allocationReadyCount: destinationPromotionGateResult.json?.summary?.allocationReadyCount ?? null,
      promotableCount: destinationPromotionGateResult.json?.summary?.promotableCount ?? null,
    },
    destinationAllocator: compactDestinationAllocator(destinationAllocatorResult.json),
    representativeExecutionCoverage: compactRepresentativeExecutionCoverage({
      merklQueue: merklQueueResult.json,
      destinationAllocator: destinationAllocatorResult.json,
      destinationRepresentative: destinationRepresentativeResult.json,
    }),
    destinationRepresentative: compactDestinationRepresentative(destinationRepresentativeResult.json),
    merklCanary: compactMerkl(merklCanaryResult.json),
    portfolio: compactPortfolio(portfolioResult.json),
    wrappedBtcHandoff: compactWrappedBtcHandoff(wrappedBtcHandoffPreview, wrappedBtcHandoffExecution),
    strategyDispatch: compactStrategyDispatch(strategyDispatchResult.json, { capitalDispatchReadiness }),
    payback: compactPayback(paybackResult.json),
    autoKill: compactAutoKill(autoKillResult.json),
    executionGate: {
      ...liveExecutionGate,
      autopilotRunId,
      autoKillTriggered: autoKillResult.json?.triggered === true,
      killSwitchActive: autoKillResult.json?.killSwitchActive === true || autoKillResult.json?.alreadyArmed === true,
      killSwitchAlreadyArmed: autoKillResult.json?.alreadyArmed === true,
    },
  };

  const hardFailures = steps.filter((step) => !step.ok && !stepIsRecoverable(step, steps));
  const blockedSteps = steps.filter((step) => !step.ok || ["blocked", "carry", "hold", "skipped"].includes(stepStatus(step)));
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    autopilotRunId,
    mode: execute ? "execute" : "preview",
    status: hardFailures.length > 0
      ? "error"
      : blockedSteps.length > 0 || liveExecutionGate.blockedReason
        ? "completed_with_blockers"
        : "completed",
    phase: "completed",
    blockedReason: hardFailures[0]?.error?.message || null,
    chains,
    summary,
    refillExecutions,
    steps,
  };

  if (write) {
    await writeAutopilotLatest(dataDir, report);
    await writeAutopilotLatestCompleted(dataDir, report);
    await new JsonlStore(dataDir).append("all-chain-autopilot-runs", report);
  }

  return report;
}
