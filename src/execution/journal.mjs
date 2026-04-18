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

function deriveFundingSnapshotJobId(plan = {}, explicitJobId = null) {
  if (explicitJobId) return explicitJobId;
  return `funding:${deterministicId({
    type: "funding_snapshot_job",
    strategyId: plan.strategyId || null,
    chain: plan.chain || null,
    inputToken: plan.inputToken || null,
    outputToken: plan.outputToken || null,
    amount: plan.amount || null,
    quoteObservedAt: plan.quote?.observedAt || null,
    pathId: plan.quote?.pathId || null,
  })}`;
}

function compactQuoteSnapshot(quote = null) {
  if (!quote) return null;
  return {
    observedAt: quote.observedAt || null,
    provider: quote.provider || null,
    source: quote.source || null,
    quoteType: quote.quoteType || null,
    chain: quote.chain || null,
    pathId: quote.pathId || null,
    latencyMs: quote.latencyMs ?? null,
    assembleLatencyMs: quote.assembleLatencyMs ?? null,
    inputToken: quote.inputToken || null,
    outputToken: quote.outputToken || null,
    inputAmount: quote.inputAmount || null,
    outputAmount: quote.outputAmount || null,
    inputValueUsd: quote.inputValueUsd ?? null,
    outputValueUsd: quote.outputValueUsd ?? null,
    netOutputValueUsd: quote.netOutputValueUsd ?? null,
    gasEstimate: quote.gasEstimate ?? null,
    gasEstimateValueUsd: quote.gasEstimateValueUsd ?? null,
    priceImpactPct: quote.priceImpactPct ?? null,
    percentDiff: quote.percentDiff ?? null,
    gweiPerGas: quote.gweiPerGas ?? null,
    txTo: quote.txTo || null,
    txGasLimit: quote.txGasLimit ?? null,
    txValueWei: quote.txValueWei ?? null,
    executionTrust: quote.executionTrust || null,
  };
}

function compactGasSnapshot(snapshot = null) {
  if (!snapshot) return null;
  return {
    observedAt: snapshot.observedAt || null,
    chain: snapshot.chain || null,
    rpcUrl: snapshot.rpcUrl || null,
    blockNumber: snapshot.blockNumber ?? null,
    latencyMs: snapshot.latencyMs ?? null,
    gasPriceWei: snapshot.gasPriceWei ?? null,
    baseFeeWei: snapshot.baseFeeWei ?? null,
    priorityFeeWei: snapshot.priorityFeeWei ?? null,
  };
}

function compactBalanceSnapshot(snapshot = null) {
  if (!snapshot) return null;
  return {
    proofSource: snapshot.proofSource || null,
    rpcUrl: snapshot.rpcUrl || null,
    balance: snapshot.balance != null ? String(snapshot.balance) : null,
    ticker: snapshot.ticker || null,
    token: snapshot.token || null,
    chain: snapshot.chain || null,
  };
}

function computeQuoteFreshness(plan = null, eventObservedAt = null) {
  const quoteObservedAt = plan?.quote?.observedAt || null;
  const ttlMs = Number(plan?.quoteTtlMs);
  if (!quoteObservedAt || !eventObservedAt) {
    return {
      quoteObservedAt,
      quoteAgeMs: null,
      quoteTtlMs: Number.isFinite(ttlMs) ? ttlMs : null,
      quoteFresh: null,
    };
  }
  const quoteAgeMs = new Date(eventObservedAt).getTime() - new Date(quoteObservedAt).getTime();
  const quoteTtlMs = Number.isFinite(ttlMs) ? ttlMs : null;
  return {
    quoteObservedAt,
    quoteAgeMs: Number.isFinite(quoteAgeMs) ? quoteAgeMs : null,
    quoteTtlMs,
    quoteFresh: quoteTtlMs == null || !Number.isFinite(quoteAgeMs) ? null : quoteAgeMs <= quoteTtlMs,
  };
}

export function buildExecutionFundingSnapshotEvent({
  plan,
  actor = "funding_snapshot",
  observedAt,
  job = null,
  mode = "live_quote_snapshot",
  fundingSource = null,
  routeKey = null,
} = {}) {
  if (!plan) {
    throw new Error("funding snapshot plan is required");
  }
  const eventObservedAt = observedAt || new Date().toISOString();
  const jobId = deriveFundingSnapshotJobId(plan, job?.jobId || null);
  const quoteFreshness = computeQuoteFreshness(plan, eventObservedAt);
  return {
    schemaVersion: 1,
    observedAt: eventObservedAt,
    eventType: "execution_funding_snapshot",
    status: "context_captured",
    jobId,
    attemptId: deterministicId({
      type: "funding_snapshot",
      jobId,
      observedAt: eventObservedAt,
      planObservedAt: plan.observedAt || null,
      pathId: plan.quote?.pathId || null,
    }),
    actor,
    mode,
    chain: job?.chain || plan.chain || null,
    type: job?.type || "funding_snapshot",
    asset: job?.asset || plan.outputAsset?.ticker || plan.inputAsset?.ticker || null,
    token: job?.token || plan.outputToken || plan.inputToken || null,
    executionMethod: job?.executionMethod || "live_funding_snapshot",
    strategyId: plan.strategyId || null,
    resourceKey: job?.resourceKey || null,
    routeKey: routeKey || job?.systemEconomics?.routeKey || null,
    planStatus: plan.planStatus || null,
    blockedReason: plan.blockedReason || null,
    fundingSource: fundingSource || job?.fundingSource || null,
    quote: compactQuoteSnapshot(plan.quote),
    gas: compactGasSnapshot(plan.gasSnapshot),
    gasSnapshotError: plan.gasSnapshotError || null,
    quoteObservedAt: quoteFreshness.quoteObservedAt,
    quoteAgeMs: quoteFreshness.quoteAgeMs,
    quoteTtlMs: quoteFreshness.quoteTtlMs,
    quoteFresh: quoteFreshness.quoteFresh,
    sourceBalanceBefore: compactBalanceSnapshot(plan.sourceBalanceBefore),
    destinationBalanceBefore: compactBalanceSnapshot(plan.destinationBalanceBefore),
    slippageBps: plan.slippageBps ?? null,
    gasBufferBps: plan.gasBufferBps ?? null,
    minimumOutputAmount: plan.minimumOutputAmount || null,
    amount: plan.amount || null,
    amountUsd: plan.amountUsd ?? null,
    stepIds: Array.isArray(plan.steps) ? plan.steps.map((step) => step.id) : [],
  };
}

export function buildExecutionFundingOutcomeEvent({
  plan,
  execution,
  actor = "funding_execution",
  observedAt,
  job = null,
  mode = "live_execution",
  routeKey = null,
} = {}) {
  if (!plan || !execution) {
    throw new Error("funding outcome requires plan and execution");
  }
  const eventObservedAt = observedAt || execution.observedAt || new Date().toISOString();
  const jobId = deriveFundingSnapshotJobId(plan, job?.jobId || null);
  const stepResults = Array.isArray(execution.stepResults) ? execution.stepResults : [];
  return {
    schemaVersion: 1,
    observedAt: eventObservedAt,
    eventType: "execution_funding_outcome",
    status: execution.settlementStatus || "executed",
    jobId,
    attemptId: deterministicId({
      type: "funding_outcome",
      jobId,
      observedAt: eventObservedAt,
      txHashes: stepResults.map((step) => step?.signerResult?.broadcast?.txHash || null),
    }),
    actor,
    mode,
    chain: job?.chain || plan.chain || null,
    type: job?.type || "funding_execution",
    asset: job?.asset || plan.outputAsset?.ticker || plan.inputAsset?.ticker || null,
    token: job?.token || plan.outputToken || plan.inputToken || null,
    executionMethod: job?.executionMethod || "live_funding_execution",
    strategyId: plan.strategyId || null,
    resourceKey: job?.resourceKey || null,
    routeKey: routeKey || job?.systemEconomics?.routeKey || null,
    settlementStatus: execution.settlementStatus || null,
    stepIds: stepResults.map((step) => step.id),
    txHashes: stepResults.map((step) => step?.signerResult?.broadcast?.txHash || null).filter(Boolean),
    quoteOutputAmount: plan.quote?.outputAmount || null,
    minimumOutputAmount: plan.minimumOutputAmount || null,
    destinationObservedDelta: execution.destinationProof?.observedDelta || null,
    sourceBalanceBefore: compactBalanceSnapshot(execution.sourceBalanceBefore),
    sourceBalanceAfter: compactBalanceSnapshot(execution.sourceBalanceAfter),
    destinationBalanceBefore: compactBalanceSnapshot(execution.destinationBalanceBefore),
    destinationBalanceAfter: compactBalanceSnapshot(execution.destinationBalanceAfter),
    destinationProof: execution.destinationProof || null,
    receiptIngest: execution.receiptIngest || null,
  };
}
