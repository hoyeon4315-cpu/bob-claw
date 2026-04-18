import { createHash } from "node:crypto";

export function stableSerialize(value) {
  if (value === undefined) {
    return JSON.stringify("__undefined__");
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function deterministicId(payload) {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex").slice(0, 20);
}

export function latestExecutionEvent(events = [], jobId) {
  return [...events]
    .filter((item) => item.jobId === jobId)
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
}

export function canStartExecution(events = [], jobId, { force = false } = {}) {
  const latest = latestExecutionEvent(events, jobId);
  if (!latest) {
    return { ok: true, reason: null, latest: null };
  }
  if (force) {
    return { ok: true, reason: "force_override", latest };
  }
  if (["submitted", "confirmed", "failed", "dry_run_planned", "planned"].includes(latest.status)) {
    return { ok: false, reason: `job_already_${latest.status}`, latest };
  }
  return { ok: true, reason: null, latest };
}

export function buildExecutionAttemptEvent({ job, actor = "stub_executor", mode = "dry_run", guards, riskDecision = null, observedAt }) {
  const eventObservedAt = observedAt || new Date().toISOString();
  return {
    schemaVersion: 1,
    observedAt: eventObservedAt,
    eventType: "execution_attempt_planned",
    status: mode === "dry_run" ? "dry_run_planned" : "planned",
    jobId: job.jobId,
    attemptId: deterministicId({
      type: "attempt",
      jobId: job.jobId,
      mode,
      observedAt: eventObservedAt,
    }),
    actor,
    mode,
    chain: job.chain,
    type: job.type,
    asset: job.asset,
    token: job.token || null,
    targetAmount: job.targetAmount,
    targetAmountDecimal: job.targetAmountDecimal,
    executionMethod: job.executionMethod,
    requiresManualReview: Boolean(job.requiresManualReview),
    reviewReasons: Array.isArray(job.reviewReasons) ? job.reviewReasons : [],
    constraints: job.constraints || {},
    guards,
    riskDecision,
  };
}

export function buildExecutionBlockedEvent({
  job,
  actor = "stub_executor",
  mode = "dry_run",
  blockers = [],
  fundingSource = null,
  riskDecision = null,
  observedAt,
}) {
  const eventObservedAt = observedAt || new Date().toISOString();
  return {
    schemaVersion: 1,
    observedAt: eventObservedAt,
    eventType: "execution_attempt_blocked",
    status: "blocked",
    jobId: job.jobId,
    attemptId: deterministicId({
      type: "blocked",
      jobId: job.jobId,
      mode,
      blockers,
      observedAt: eventObservedAt,
    }),
    actor,
    mode,
    chain: job.chain,
    type: job.type,
    asset: job.asset,
    token: job.token || null,
    targetAmount: job.targetAmount,
    targetAmountDecimal: job.targetAmountDecimal,
    executionMethod: job.executionMethod,
    requiresManualReview: Boolean(job.requiresManualReview),
    reviewReasons: Array.isArray(job.reviewReasons) ? job.reviewReasons : [],
    blockers,
    fundingSource,
    riskDecision,
  };
}

export function buildExecutionSubmissionEvent({ job, txHash, actor = "manual_submit", observedAt }) {
  const eventObservedAt = observedAt || new Date().toISOString();
  return {
    schemaVersion: 1,
    observedAt: eventObservedAt,
    eventType: "execution_submitted",
    status: "submitted",
    jobId: job.jobId,
    attemptId: deterministicId({
      type: "submitted",
      jobId: job.jobId,
      txHash,
      observedAt: eventObservedAt,
    }),
    actor,
    chain: job.chain,
    txHash,
    executionMethod: job.executionMethod,
    resourceKey: job.resourceKey,
  };
}

export function buildExecutionReconciliationEvent({ job, txHash, receiptRecord, actor = "receipt_reconciler", observedAt }) {
  const eventObservedAt = observedAt || new Date().toISOString();
  const status = receiptRecord.reconciliationStatus === "failed" ? "failed" : receiptRecord.reconciliationStatus === "reconciled" ? "confirmed" : "pending_output";
  return {
    schemaVersion: 1,
    observedAt: eventObservedAt,
    eventType: "execution_reconciled",
    status,
    jobId: job.jobId,
    attemptId: deterministicId({
      type: "reconciled",
      jobId: job.jobId,
      txHash,
      observedAt: eventObservedAt,
    }),
    actor,
    chain: job.chain,
    txHash,
    executionMethod: job.executionMethod,
    reconciliationStatus: receiptRecord.reconciliationStatus,
    realized: receiptRecord.realized,
    flags: receiptRecord.flags,
  };
}
