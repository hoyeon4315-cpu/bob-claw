import { buildBridgeFallbackTriggeredEvent } from "../../execution/journal.mjs";

export const DEFAULT_REFILL_BRIDGE_FALLBACK_FAILURE_THRESHOLD = 3;

const EXECUTABLE_BRIDGE_METHODS = new Set([
  "cross_chain_bridge_or_swap",
  "cross_chain_swap_via_btc_intermediate",
  "cross_chain_bridge_across",
]);

const EXECUTABLE_REFILL_METHODS = new Set([
  ...EXECUTABLE_BRIDGE_METHODS,
  "cross_chain_bridge_lifi",
  "gas_refuel_bridge_gas_zip",
  "same_chain_token_to_native_swap",
  "same_chain_native_to_token_swap",
]);

const FAILURE_STATUSES = new Set([
  "failed",
  "execution_failed",
  "source_failed",
  "settlement_failed",
]);
const SOURCE_NATIVE_GAS_BLOCKERS = new Set([
  "insufficient_funds",
  "insufficient_native_gas_balance",
]);

function sameAction(event = {}, job = {}) {
  if (!event || !job) return false;
  if (event.jobId && event.jobId === job.jobId) return true;
  return Boolean(event.resourceKey && job.resourceKey && event.resourceKey === job.resourceKey);
}

function eventText(event = {}) {
  return [
    event.error?.message,
    event.error,
    event.blockedReason,
    ...(Array.isArray(event.blockers) ? event.blockers : []),
  ].filter(Boolean).join("\n").toLowerCase();
}

function isSourceNativeGasFailure(event = {}) {
  const blockers = new Set([
    event.blockedReason,
    ...(Array.isArray(event.blockers) ? event.blockers : []),
  ].filter(Boolean));
  if ([...blockers].some((blocker) => SOURCE_NATIVE_GAS_BLOCKERS.has(blocker))) return true;
  return /insufficient_native_balance_for_gas|insufficient_native_gas_balance|insufficient funds for gas \* price \+ value/u.test(
    eventText(event),
  );
}

function isFailureOutcome(event = {}, method) {
  if (isSourceNativeGasFailure(event)) return false;
  return (
    event.eventType === "execution_funding_outcome" &&
    event.executionMethod === method &&
    (FAILURE_STATUSES.has(event.status) || Boolean(event.error))
  );
}

function isTerminalOutcome(event = {}, method) {
  return event.eventType === "execution_funding_outcome" && event.executionMethod === method;
}

function normalizedCandidate(candidate = {}, index) {
  const method = candidate.method || candidate.executionMethod || null;
  if (!method) return null;
  return {
    ...candidate,
    method,
    index,
    missingInputs: Array.isArray(candidate.missingInputs) ? candidate.missingInputs : [],
    settlementRequirements: Array.isArray(candidate.settlementRequirements) ? candidate.settlementRequirements : [],
  };
}

function selectedCandidateFromJob(job = {}) {
  if (!job.executionMethod) return null;
  return normalizedCandidate(
    {
      method: job.executionMethod,
      availability: job.fundingSource?.selectionStatus || "ready",
      source: job.fundingSource?.source || null,
      expectedExecutionRefillCostUsd: job.fundingSource?.expectedExecutionRefillCostUsd ?? null,
      expectedReserveReplenishmentCostUsd: job.fundingSource?.expectedReserveReplenishmentCostUsd ?? null,
      requiresManualFunding: job.fundingSource?.requiresManualFunding || false,
      missingInputs: job.fundingSource?.missingInputs || [],
      settlementRequirements: job.fundingSource?.settlementRequirements || [],
    },
    -1,
  );
}

export function refillBridgeCandidates(job = {}) {
  return refillExecutionCandidates(job).filter((candidate) => EXECUTABLE_BRIDGE_METHODS.has(candidate.method));
}

export function refillExecutionCandidates(job = {}) {
  const seen = new Set();
  const candidates = [];
  for (const candidate of [
    selectedCandidateFromJob(job),
    ...(Array.isArray(job.candidateMethods) ? job.candidateMethods.map(normalizedCandidate) : []),
  ]) {
    if (!candidate || seen.has(candidate.method)) continue;
    seen.add(candidate.method);
    if (EXECUTABLE_REFILL_METHODS.has(candidate.method)) candidates.push(candidate);
  }
  return candidates;
}

export function consecutiveBridgeFailureCount({ events = [], job, method } = {}) {
  let count = 0;
  const newestFirst = [...events]
    .filter((event) => sameAction(event, job))
    .sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0));
  for (const event of newestFirst) {
    if (!isTerminalOutcome(event, method)) continue;
    if (!isFailureOutcome(event, method)) break;
    count += 1;
  }
  return count;
}

function latestFallbackEvent({ events = [], job } = {}) {
  return [...events]
    .filter((event) => sameAction(event, job) && event.eventType === "bridge_fallback_triggered")
    .sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0))[0] || null;
}

export function refillCandidateExecutable(candidate = {}) {
  if (!EXECUTABLE_REFILL_METHODS.has(candidate.method)) return false;
  if (candidate.requiresManualFunding || candidate.manualFundingDependency) return false;
  if ((candidate.missingInputs || []).length > 0) return false;
  if (!candidate.source?.chain || !candidate.source?.token) return false;
  return candidate.availability === "ready" || candidate.availability === "conditional";
}

export function jobWithCandidate(job, candidate) {
  const executable = refillCandidateExecutable(candidate);
  const fundingReviewReasons = new Set([
    "funding_source_conditional",
    "source_inventory_below_target_amount",
    "conditional_funding_source",
  ]);
  const retainedReviewReasons = executable
    ? (job.reviewReasons || []).filter((reason) => !fundingReviewReasons.has(reason))
    : (job.reviewReasons || []);
  return {
    ...job,
    requiresManualReview: retainedReviewReasons.length > 0,
    reviewReasons: retainedReviewReasons,
    executionMethod: candidate.method,
    fundingSource: {
      ...(job.fundingSource || {}),
      selectionStatus: executable
        ? "ready"
        : candidate.availability || job.fundingSource?.selectionStatus || "ready",
      method: candidate.method,
      source: candidate.source,
      expectedExecutionRefillCostUsd:
        candidate.expectedExecutionRefillCostUsd ?? job.fundingSource?.expectedExecutionRefillCostUsd ?? null,
      expectedReserveReplenishmentCostUsd:
        candidate.expectedReserveReplenishmentCostUsd ?? job.fundingSource?.expectedReserveReplenishmentCostUsd ?? null,
      requiresManualFunding: Boolean(candidate.requiresManualFunding || candidate.manualFundingDependency),
      requiresReserveState: Boolean(candidate.requiresReserveState),
      missingInputs: candidate.missingInputs || [],
      settlementRequirements: candidate.settlementRequirements || [],
    },
  };
}

export function forceRefillExecutionMethod({ job, method } = {}) {
  if (!job) return { job, candidate: null, error: "job_missing" };
  const candidate = refillExecutionCandidates(job).find((item) => item.method === method) || null;
  if (!candidate) return { job, candidate: null, error: `candidate_method_missing:${method || "missing"}` };
  if (!refillCandidateExecutable(candidate)) {
    return { job, candidate, error: `candidate_method_not_executable:${method}` };
  }
  return {
    job: jobWithCandidate(job, candidate),
    candidate,
    error: null,
  };
}

export function resolveRefillBridgeFallback({
  job,
  events = [],
  mode = "live_execution",
  failureThreshold = DEFAULT_REFILL_BRIDGE_FALLBACK_FAILURE_THRESHOLD,
  observedAt,
} = {}) {
  const candidates = refillBridgeCandidates(job);
  if (!job || candidates.length < 2) {
    return { job, activeMethod: job?.executionMethod || null, fallbackEvent: null, failureCount: 0, candidates };
  }

  const lastFallback = latestFallbackEvent({ events, job });
  const activeMethod = lastFallback?.toExecutionMethod || job.executionMethod;
  const activeIndex = candidates.findIndex((candidate) => candidate.method === activeMethod);
  const activeCandidate = activeIndex >= 0 ? candidates[activeIndex] : null;
  const activeJob = activeCandidate && activeMethod !== job.executionMethod ? jobWithCandidate(job, activeCandidate) : job;
  const failureCount = consecutiveBridgeFailureCount({ events, job: activeJob, method: activeMethod });

  if (failureCount < failureThreshold) {
    return { job: activeJob, activeMethod, fallbackEvent: null, failureCount, candidates };
  }

  const nextCandidate = candidates.slice(activeIndex + 1).find(refillCandidateExecutable) || null;
  if (!nextCandidate) {
    return { job: activeJob, activeMethod, fallbackEvent: null, failureCount, candidates };
  }

  const fallbackJob = jobWithCandidate(job, nextCandidate);
  const fallbackEvent = buildBridgeFallbackTriggeredEvent({
    job,
    fromExecutionMethod: activeMethod,
    toExecutionMethod: nextCandidate.method,
    failureCount,
    failureThreshold,
    candidateIndex: nextCandidate.index,
    mode,
    observedAt,
  });

  return {
    job: fallbackJob,
    activeMethod: nextCandidate.method,
    fallbackEvent,
    failureCount,
    candidates,
  };
}
