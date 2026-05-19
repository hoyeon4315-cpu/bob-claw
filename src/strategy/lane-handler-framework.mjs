// Common report-only lane handler framework for actionLaneQueue items.
// It produces dry-run intent plans only; it never signs, enqueues, writes
// runtime state, changes autoExecute, or relaxes policy/cost/cap gates.

export const HANDLER_STATUSES = Object.freeze([
  "READY_FOR_DRY_RUN",
  "BLOCKED_MISSING_INPUT",
  "BLOCKED_MISSING_PRODUCER",
  "BLOCKED_POLICY_REVIEW",
  "WAITLIST",
  "DIAGNOSTIC_FAILURE",
]);

const PILOT_LANE_PRIORITY = Object.freeze(["capital_refill", "receipt_reconciliation", "producer_backlog"]);

const REPORT_ONLY_SAFETY = Object.freeze({
  reportOnly: true,
  runtimeAuthority: "none",
  allowedToExecuteLive: false,
  liveExecutionAuthority: "none",
  signerCalled: false,
  runtimeStateMutated: false,
  liveQueueEnqueued: false,
  autoExecuteChanged: false,
  policyRelaxed: false,
  evCostRelaxed: false,
  capRelaxed: false,
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function queueItems(selectorReport = {}) {
  return array(selectorReport.actionLaneQueue);
}

function refillJobs(refillPlannerReport = {}) {
  return array(refillPlannerReport.jobs?.jobs);
}

function familyMatchesJob(item, job) {
  if (!item?.family || !job) return false;
  if (job.family === item.family) return true;
  return !job.family;
}

function refillJobForItem(item, refillPlannerReport) {
  return refillJobs(refillPlannerReport).find((job) => familyMatchesJob(item, job)) || null;
}

function hasCapitalRefillInput(item, refillPlannerReport = {}) {
  return item?.lane === "capital_refill" && refillJobForItem(item, refillPlannerReport) !== null;
}

function receiptTargetsForItem(item, receiptReport = {}) {
  const family = item?.family || null;
  return array(receiptReport.unreconciled)
    .filter((target) => !family || !target.family || target.family === family)
    .map((target) => ({
      family: target.family || family,
      txHash: target.txHash || target.hash || null,
      status: target.status || target.reconciliationStatus || null,
    }));
}

function hasReceiptInput(item, receiptReport = {}) {
  return item?.lane === "receipt_reconciliation" && receiptTargetsForItem(item, receiptReport).length > 0;
}

function firstByPriority(items, predicate) {
  return [...items].sort((left, right) => (left.priority || 0) - (right.priority || 0)).find(predicate) || null;
}

function selectPilot({ selectorReport = {}, refillPlannerReport = {}, receiptReport = {} } = {}) {
  const items = queueItems(selectorReport);
  const capital = firstByPriority(items, (item) => hasCapitalRefillInput(item, refillPlannerReport));
  if (capital) return { lane: "capital_refill", item: capital };
  const receipt = firstByPriority(items, (item) => hasReceiptInput(item, receiptReport));
  if (receipt) return { lane: "receipt_reconciliation", item: receipt };
  const backlog = firstByPriority(items, (item) => item.lane === "producer_backlog");
  if (backlog) return { lane: "producer_backlog", item: backlog };
  return { lane: null, item: null };
}

function baseHandlerResult(item, status, overrides = {}) {
  return {
    lane: item?.lane || null,
    family: item?.family || null,
    sourceQueueItem: item || null,
    status,
    canDryRun: Boolean(item?.canDryRun),
    dryRunIntent: null,
    dryRunCommand: item?.suggestedDryRunCommand || null,
    missingInputs: [],
    missingProducer: item?.missingProducer || null,
    governingFieldPath: item?.governingFieldPath || null,
    safetyBlockers: [...array(item?.safetyBlockers)],
    canLive: false,
    reportOnly: true,
    ...overrides,
  };
}

function refillSource(source = null) {
  if (!source) return null;
  return {
    chain: source.chain || null,
    asset: source.ticker || source.asset || null,
    token: source.token || null,
    estimatedUsd: finiteNumber(source.estimatedUsd),
  };
}

function refillDestination(job) {
  return {
    chain: job.chain || null,
    asset: job.asset || null,
    token: job.token || null,
    targetAmount: job.targetAmount || null,
    targetAmountDecimal: finiteNumber(job.targetAmountDecimal),
    estimatedAssetValueUsd: finiteNumber(job.estimatedAssetValueUsd),
  };
}

function refillCosts(job, fundingSource) {
  return {
    expectedExecutionRefillCostUsd: finiteNumber(fundingSource.expectedExecutionRefillCostUsd),
    expectedReserveReplenishmentCostUsd: finiteNumber(fundingSource.expectedReserveReplenishmentCostUsd),
    bridgeQuoteCostUsd: finiteNumber(job.movementBudget?.bridgeQuoteCostUsd),
    bridgeQuoteCostCeilingUsd: finiteNumber(job.movementBudget?.bridgeQuoteCostCeilingUsd),
    routeKnownCostUsd: finiteNumber(job.systemEconomics?.routeKnownCostUsd),
  };
}

function governingAgreement({ item, job, refillPlannerReport, fundingSource }) {
  const plannerDecision = refillPlannerReport.capitalPlan?.decision || null;
  const selectionStatus = fundingSource.selectionStatus || null;
  const selectionReady = selectionStatus === "ready" || selectionStatus === null;
  return {
    queueLane: item.lane,
    plannerDecision,
    jobDecision: job.decision || null,
    selectionStatus,
    agrees:
      item.lane === "capital_refill" &&
      plannerDecision === "REFILL_REQUIRED" &&
      job.decision === "REFILL_REQUIRED" &&
      selectionReady,
  };
}

function plannerCandidateMethods(job, refillPlannerReport) {
  if (!job?.chain || !job?.asset) return [];
  const methods = new Set();
  for (const entry of refillJobs(refillPlannerReport)) {
    if (!entry) continue;
    if (entry.chain !== job.chain) continue;
    if (entry.asset !== job.asset) continue;
    const method = entry.executionMethod || entry.fundingSource?.method || null;
    if (method) methods.add(method);
  }
  return [...methods];
}

function capitalRefillDryRunIntent({ item, job, refillPlannerReport }) {
  const fundingSource = job.fundingSource || {};
  return {
    intentType: "capital_refill_dry_run",
    jobId: job.jobId || null,
    selectedMethod: job.executionMethod || fundingSource.method || null,
    plannerCandidateMethods: plannerCandidateMethods(job, refillPlannerReport),
    source: refillSource(fundingSource.source),
    destination: refillDestination(job),
    expectedNetUsd: finiteNumber(job.systemEconomics?.effectiveSystemNetPnlUsd),
    costs: refillCosts(job, fundingSource),
    blocker: job.blocker || fundingSource.blocker || null,
    governingAgreement: governingAgreement({ item, job, refillPlannerReport, fundingSource }),
  };
}

function handleCapitalRefill(item, { refillPlannerReport = {} }) {
  const job = refillJobForItem(item, refillPlannerReport);
  if (!job) {
    return baseHandlerResult(item, "BLOCKED_MISSING_INPUT", {
      missingInputs: ["matching_refill_planner_job"],
      canDryRun: false,
      dryRunCommand: null,
    });
  }
  const missingInputs = array(job.fundingSource?.missingInputs);
  return baseHandlerResult(item, missingInputs.length ? "BLOCKED_MISSING_INPUT" : "READY_FOR_DRY_RUN", {
    canDryRun: missingInputs.length === 0,
    missingInputs,
    dryRunCommand: item.suggestedDryRunCommand || "node src/cli/plan-capital-manager-refill-jobs.mjs --json",
    dryRunIntent: capitalRefillDryRunIntent({ item, job, refillPlannerReport }),
  });
}

function handleReceiptReconciliation(item, { receiptReport = {} }) {
  const targets = receiptTargetsForItem(item, receiptReport);
  if (targets.length === 0) {
    return baseHandlerResult(item, "BLOCKED_MISSING_INPUT", {
      missingInputs: ["receipt_reconciliation_targets"],
      canDryRun: false,
      dryRunCommand: null,
    });
  }
  return baseHandlerResult(item, "READY_FOR_DRY_RUN", {
    dryRunCommand: item.suggestedDryRunCommand || "npm run report:receipt-ledger -- --json",
    dryRunIntent: {
      intentType: "receipt_reconciliation_dry_run",
      targets,
      targetCount: targets.length,
      mutationAllowed: false,
    },
  });
}

function handleProducerBacklog(item) {
  return baseHandlerResult(item, "BLOCKED_MISSING_PRODUCER", {
    canDryRun: false,
    dryRunCommand: null,
    dryRunIntent: {
      backlogType: "missing_producer",
      missingProducer: item.missingProducer || null,
      missingBinding: item.missingBinding || null,
      sourceFields: {
        governingFieldPath: item.governingFieldPath || null,
        reason: item.reason || null,
        actionClass: item.actionClass || null,
      },
    },
  });
}

function backlogStatus(item) {
  if (item.lane === "policy_review") return "BLOCKED_POLICY_REVIEW";
  if (item.lane === "waitlist") return "WAITLIST";
  if (item.missingProducer || item.lane === "producer_backlog") return "BLOCKED_MISSING_PRODUCER";
  if (!item.canDryRun) return "BLOCKED_MISSING_INPUT";
  return "BLOCKED_MISSING_INPUT";
}

function handlerBacklogItem(item) {
  return {
    lane: item.lane,
    family: item.family,
    status: backlogStatus(item),
    reason: item.reason || null,
    governingFieldPath: item.governingFieldPath || null,
    missingProducer: item.missingProducer || null,
    missingBinding: item.missingBinding || null,
    safetyBlockers: [...array(item.safetyBlockers)],
    canLive: false,
    reportOnly: true,
  };
}

function runPilotHandler(selection, context) {
  if (!selection.item) return [];
  if (selection.lane === "capital_refill") return [handleCapitalRefill(selection.item, context)];
  if (selection.lane === "receipt_reconciliation") return [handleReceiptReconciliation(selection.item, context)];
  if (selection.lane === "producer_backlog") return [handleProducerBacklog(selection.item, context)];
  return [];
}

export function buildLaneHandlerReport({
  selectorReport = {},
  refillPlannerReport = {},
  receiptReport = {},
  now = null,
} = {}) {
  const selection = selectPilot({ selectorReport, refillPlannerReport, receiptReport });
  const handlerResults = runPilotHandler(selection, { refillPlannerReport, receiptReport });
  const handledFamilies = new Set(handlerResults.map((result) => result.family));
  const handlerBacklog = queueItems(selectorReport)
    .filter((item) => !handledFamilies.has(item.family))
    .filter((item) => !PILOT_LANE_PRIORITY.includes(item.lane) || item.lane !== selection.lane)
    .map(handlerBacklogItem);
  return {
    generatedAt: now || selectorReport.generatedAt || new Date(0).toISOString(),
    status: handlerResults.length > 0 ? "LANE_HANDLER_PILOT_READY" : "DIAGNOSTIC_FAILURE",
    selectedPilotLane: selection.lane,
    reportOnly: true,
    canLive: false,
    runtimeAuthority: "none",
    allowedToExecuteLive: false,
    liveExecutionAuthority: "none",
    handlerResults,
    handlerBacklog,
    inputsRequired: {
      actionLaneQueue: true,
      generatedArtifactPath: null,
    },
    safety: { ...REPORT_ONLY_SAFETY },
  };
}
