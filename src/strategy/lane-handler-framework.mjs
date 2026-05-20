// Common report-only lane handler framework for actionLaneQueue items.
// It produces dry-run intent plans only; it never signs, enqueues, writes
// runtime state, changes autoExecute, or relaxes policy/cost/cap gates.

import { getStrategyCaps } from "../config/strategy-caps.mjs";
import {
  CAPITAL_REFILL_BINDING_PRODUCER,
  resolveCapitalRefillStrategyId,
} from "../config/capital-refill-strategy-bindings.mjs";
import { buildEvCostModel } from "../executor/policy/ev-gate.mjs";
import { executionEvCostFloorEvidence } from "../executor/policy/ev-cost-floor.mjs";

const CAPITAL_REFILL_INTENT_TYPE = "capital_rebalance";

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

function selectionStatusRank(value) {
  if (value === "ready") return 0;
  if (value === "conditional") return 1;
  if (value === "manual_only") return 2;
  return 3;
}

function refillJobRank(job = {}) {
  const net = finiteNumber(job.systemEconomics?.effectiveSystemNetPnlUsd);
  const executionCost = finiteNumber(job.fundingSource?.expectedExecutionRefillCostUsd);
  const routeKnownCost = finiteNumber(job.systemEconomics?.routeKnownCostUsd);
  const routeAmountPresent = job.systemEconomics?.amount != null && String(job.systemEconomics.amount).length > 0;
  return {
    readyRank: selectionStatusRank(job.fundingSource?.selectionStatus),
    reviewRank: job.requiresManualReview ? 1 : 0,
    reviewReasonCount: array(job.reviewReasons).length,
    quoteRank: routeAmountPresent && routeKnownCost !== null ? 0 : 1,
    positiveRank: net !== null && net >= 0 ? 0 : 1,
    net: net ?? Number.NEGATIVE_INFINITY,
    executionCost: executionCost ?? Number.POSITIVE_INFINITY,
  };
}

function compareRefillJobs(left, right) {
  const a = refillJobRank(left);
  const b = refillJobRank(right);
  for (const key of ["readyRank", "reviewRank", "reviewReasonCount", "quoteRank", "positiveRank"]) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.net !== b.net) return b.net - a.net;
  if (a.executionCost !== b.executionCost) return a.executionCost - b.executionCost;
  return String(left?.jobId || "").localeCompare(String(right?.jobId || ""));
}

function refillJobForItem(item, refillPlannerReport) {
  return (
    refillJobs(refillPlannerReport)
      .filter((job) => familyMatchesJob(item, job))
      .sort(compareRefillJobs)[0] || null
  );
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
    actual: source.actual ?? source.balance ?? null,
    actualDecimal: finiteNumber(source.actualDecimal),
    estimatedUsd: finiteNumber(source.estimatedUsd),
    sourceKind: source.sourceKind || null,
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

function pickFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const parsed = finiteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function registryCapsForStrategy(resolvedStrategyId, activeCapitalUsd) {
  if (resolvedStrategyId === null) return null;
  return getStrategyCaps(resolvedStrategyId, { activeCapitalUsd: finiteNumber(activeCapitalUsd) })?.caps || {};
}

function perChainCapUsd(registryCaps = {}, destinationChain = null) {
  const chainKey = typeof destinationChain === "string" ? destinationChain : null;
  if (!chainKey) return { chainKey: null, perChainRegistry: null, perChainUsd: null };
  const perChainRegistry = finiteNumber(registryCaps.perChainUsd?.[chainKey]);
  return {
    chainKey,
    perChainRegistry,
    perChainUsd: perChainRegistry !== null ? { [chainKey]: perChainRegistry } : null,
  };
}

function effectivePerTxUsd({ treasury = {}, perChainRegistry = null, perTxRegistry = null } = {}) {
  const chainClamped =
    perChainRegistry !== null && perTxRegistry !== null ? Math.min(perChainRegistry, perTxRegistry) : null;
  return pickFiniteNumber(treasury.perTxUsd, chainClamped, perChainRegistry, perTxRegistry, treasury.perTradeCapUsd);
}

function capsSourceProducer({ registryCaps = null, strategyPolicy = null } = {}) {
  if (registryCaps !== null) return "src/config/strategy-caps/registry.mjs";
  if (strategyPolicy) return "src/treasury/policy.mjs";
  return null;
}

function refillPolicyCaps(job, { resolvedStrategyId = null, destinationChain = null, activeCapitalUsd = null } = {}) {
  const treasury = job?.strategyPolicy?.caps || job?.strategyPolicy || {};
  const rawRegistryCaps = registryCapsForStrategy(resolvedStrategyId, activeCapitalUsd);
  const registryCaps = rawRegistryCaps || {};
  const { perChainRegistry, perChainUsd } = perChainCapUsd(registryCaps, destinationChain);
  const perTxRegistry = finiteNumber(registryCaps.perTxUsd);
  const effectivePerTx = effectivePerTxUsd({
    treasury,
    perChainRegistry,
    perTxRegistry,
  });
  return {
    perTxUsd: effectivePerTx,
    perDayUsd: pickFiniteNumber(treasury.perDayUsd, registryCaps.perDayUsd),
    maxDailyLossUsd: pickFiniteNumber(treasury.maxDailyLossUsd, registryCaps.maxDailyLossUsd),
    tinyLivePerTxUsd: pickFiniteNumber(treasury.tinyLivePerTxUsd, registryCaps.tinyLivePerTxUsd),
    maxFailedGasCost24hUsd: pickFiniteNumber(treasury.maxFailedGasCost24hUsd, registryCaps.maxFailedGasCost24hUsd),
    perChainUsd,
    capsSourceProducer: capsSourceProducer({ registryCaps: rawRegistryCaps, strategyPolicy: job?.strategyPolicy }),
    resolvedStrategyId,
    perTradeCapUsd: finiteNumber(treasury.perTradeCapUsd),
  };
}

function refillRouteQuoteRef(economics = {}) {
  return {
    routeKey: economics.routeKey || null,
    amount: economics.amount || null,
    routeInputUsd: finiteNumber(economics.routeInputUsd),
    routeNetEdgeUsd: finiteNumber(economics.routeNetEdgeUsd),
    routeExecutableNetEdgeUsd: finiteNumber(economics.routeExecutableNetEdgeUsd),
    routeKnownCostUsd: finiteNumber(economics.routeKnownCostUsd),
    routeFailureRate: finiteNumber(economics.routeFailureRate),
  };
}

function selectedRouteEconomics(entry = {}, fundingSelected = false) {
  if (!fundingSelected) {
    return {
      routeQuoteRef: null,
      costs: null,
      expectedNetUsd: null,
      requiredNetUsd: null,
      p90CostUsd: null,
      effectiveFloorUsd: null,
    };
  }
  const economics = entry.systemEconomics || {};
  return {
    routeQuoteRef: refillRouteQuoteRef(economics),
    costs: refillCosts(entry, entry.fundingSource || {}),
    expectedNetUsd: finiteNumber(economics.effectiveSystemNetPnlUsd),
    requiredNetUsd: finiteNumber(economics.requiredNetUsd),
    p90CostUsd: finiteNumber(economics.p90CostUsd),
    effectiveFloorUsd: finiteNumber(economics.effectiveFloorUsd),
  };
}

function routeSourceCandidate({ entry, method, selectedJobId, selectedMethod }) {
  const methodName = method.method || null;
  const selected = entry.jobId === selectedJobId && methodName === selectedMethod;
  const fundingSelected = entry.fundingSource?.method === methodName;
  const routeEconomics = selectedRouteEconomics(entry, fundingSelected);
  return {
    jobId: entry.jobId || null,
    method: methodName,
    selected,
    availability: method.availability || null,
    preferred: method.preferred === true,
    source: refillSource(method.source),
    destination: refillDestination(entry),
    ...routeEconomics,
    missingInputs: [...array(method.missingInputs)],
    blocker: entry.blocker || entry.fundingSource?.blocker || null,
  };
}

function routeSourceCandidates(job, refillPlannerReport) {
  if (!job?.chain || !job?.asset) return [];
  const selectedMethod = job.executionMethod || job.fundingSource?.method || null;
  const rows = [];
  for (const entry of refillJobs(refillPlannerReport)) {
    if (!entry) continue;
    if (entry.chain !== job.chain) continue;
    if (entry.asset !== job.asset) continue;
    for (const method of array(entry.candidateMethods)) {
      if (!method?.method) continue;
      if (method.requiresManualFunding) continue;
      rows.push(routeSourceCandidate({ entry, method, selectedJobId: job.jobId, selectedMethod }));
    }
  }
  return rows;
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

function buildPolicyCapRef(policyCaps) {
  return {
    producer: policyCaps.capsSourceProducer,
    bindingProducer: CAPITAL_REFILL_BINDING_PRODUCER.module,
    resolvedStrategyId: policyCaps.resolvedStrategyId,
    perTxUsd: policyCaps.perTxUsd,
    perDayUsd: policyCaps.perDayUsd,
    maxDailyLossUsd: policyCaps.maxDailyLossUsd,
    tinyLivePerTxUsd: policyCaps.tinyLivePerTxUsd,
    maxFailedGasCost24hUsd: policyCaps.maxFailedGasCost24hUsd,
    perChainUsd: policyCaps.perChainUsd,
    perTradeCapUsd: policyCaps.perTradeCapUsd,
  };
}

function capRefMissingProducers(policyCaps) {
  const missing = [];
  if (policyCaps.perTxUsd === null) missing.push("perTxUsd");
  if (policyCaps.perDayUsd === null) missing.push("perDayUsd");
  if (policyCaps.maxDailyLossUsd === null) missing.push("maxDailyLossUsd");
  return missing;
}

function floorMissingProducers(evidence, intent) {
  const missing = [];
  if (!Number.isFinite(intent.expectedNetUsd)) missing.push("expectedNetUsd");
  if (!evidence) {
    if (!missing.includes("p90CostUsd")) missing.push("p90CostUsd");
    if (!missing.includes("requiredNetUsd")) missing.push("requiredNetUsd");
    if (!missing.includes("effectiveFloorUsd")) missing.push("effectiveFloorUsd");
    return missing;
  }
  if (!Number.isFinite(evidence.p90CostUsd)) missing.push("p90CostUsd");
  if (!Number.isFinite(evidence.requiredNetUsd)) missing.push("requiredNetUsd");
  if (!Number.isFinite(evidence.effectiveFloorUsd)) missing.push("effectiveFloorUsd");
  return missing;
}

function floorEvidenceForIntent({ resolvedStrategyId, destination, evCostModel }) {
  return executionEvCostFloorEvidence({
    strategyId: resolvedStrategyId,
    chain: destination?.chain || null,
    intentType: CAPITAL_REFILL_INTENT_TYPE,
    isCapitalRebalance: true,
    receiptModel: evCostModel,
  });
}

function floorNumbersForIntent(economics = {}, floorEvidence = null) {
  const expectedNetUsd = finiteNumber(economics.effectiveSystemNetPnlUsd);
  const requiredNetUsd = pickFiniteNumber(
    economics.requiredNetUsd,
    economics.requiredNetPnlUsd,
    floorEvidence?.requiredNetUsd,
  );
  const p90CostUsd = pickFiniteNumber(
    economics.p90CostUsd,
    economics.receiptCostP90Usd,
    economics.receiptCostFloorUsd,
    floorEvidence?.p90CostUsd,
  );
  const effectiveFloorUsd = pickFiniteNumber(
    economics.effectiveFloorUsd,
    economics.effectiveCostFloorUsd,
    floorEvidence?.effectiveFloorUsd,
    requiredNetUsd,
  );
  return { expectedNetUsd, requiredNetUsd, p90CostUsd, effectiveFloorUsd };
}

function missingCapProducer({ resolvedStrategyId, selectedMethod, source }) {
  if (resolvedStrategyId !== null) return null;
  return {
    producer: CAPITAL_REFILL_BINDING_PRODUCER.module,
    function: CAPITAL_REFILL_BINDING_PRODUCER.function,
    selectedMethod,
    sourceChain: source?.chain || null,
    missingFields: ["resolvedStrategyId", "perTxUsd", "perDayUsd", "maxDailyLossUsd"],
  };
}

function missingFloorProducer({ floorEvidence, resolvedStrategyId, destination }) {
  if (floorEvidence !== null) return null;
  return {
    producer: "src/executor/policy/ev-cost-floor.mjs",
    function: "executionEvCostFloorEvidence",
    strategyId: resolvedStrategyId,
    chain: destination?.chain || null,
    intentType: CAPITAL_REFILL_INTENT_TYPE,
    missingFields: ["p90CostUsd", "requiredNetUsd", "effectiveFloorUsd"],
  };
}

function capitalRefillDryRunIntent({ item, job, refillPlannerReport, evCostModel = null, activeCapitalUsd = null }) {
  const fundingSource = job.fundingSource || {};
  const economics = job.systemEconomics || {};
  const source = refillSource(fundingSource.source);
  const destination = refillDestination(job);
  const selectedMethod = job.executionMethod || fundingSource.method || null;
  const resolvedStrategyId = resolveCapitalRefillStrategyId({
    selectedMethod,
    sourceChain: source?.chain || null,
  });
  const policyCaps = refillPolicyCaps(job, {
    resolvedStrategyId,
    destinationChain: destination?.chain || null,
    activeCapitalUsd,
  });
  const floorEvidence = floorEvidenceForIntent({ resolvedStrategyId, destination, evCostModel });
  // Cost-floor projection forwarded from real planner economics OR derived from
  // the receipt-cost p90 producer (`executionEvCostFloorEvidence`) that mirrors
  // the live policy gate. Floor numerics are never fabricated; null entries
  // mean the producer model has no entry and no chain fallback is configured.
  const floorNumbers = floorNumbersForIntent(economics, floorEvidence);
  return {
    intentType: "capital_refill_dry_run",
    jobId: job.jobId || null,
    selectedMethod,
    plannerCandidateMethods: plannerCandidateMethods(job, refillPlannerReport),
    routeSourceCandidates: routeSourceCandidates(job, refillPlannerReport),
    source,
    destination,
    ...floorNumbers,
    policyCaps,
    policyCapRef: buildPolicyCapRef(policyCaps),
    capRefsMissingProducer: missingCapProducer({ resolvedStrategyId, selectedMethod, source }),
    capRefsMissingFields: capRefMissingProducers(policyCaps),
    floorEvidence,
    floorMissingProducer: missingFloorProducer({ floorEvidence, resolvedStrategyId, destination }),
    floorMissingFields: floorMissingProducers(floorEvidence, floorNumbers),
    routeQuoteRef: refillRouteQuoteRef(economics),
    paybackReserve: job.paybackReserve || null,
    gasReserve: job.gasReserve || null,
    costs: refillCosts(job, fundingSource),
    blocker: job.blocker || fundingSource.blocker || null,
    governingAgreement: governingAgreement({ item, job, refillPlannerReport, fundingSource }),
  };
}

function handleCapitalRefill(item, { refillPlannerReport = {}, evCostModel = null, activeCapitalUsd = null } = {}) {
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
    dryRunIntent: capitalRefillDryRunIntent({ item, job, refillPlannerReport, evCostModel, activeCapitalUsd }),
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

function resolveEvCostModel({ evCostModel, auditRecords, receiptRecords, now }) {
  if (evCostModel && Array.isArray(evCostModel.entries)) return evCostModel;
  if (!Array.isArray(auditRecords) && !Array.isArray(receiptRecords)) return null;
  const builtAuditRecords = Array.isArray(auditRecords) ? auditRecords : [];
  const builtReceiptRecords = Array.isArray(receiptRecords) ? receiptRecords : [];
  if (builtAuditRecords.length === 0 && builtReceiptRecords.length === 0) return null;
  return buildEvCostModel({
    auditRecords: builtAuditRecords,
    receiptRecords: builtReceiptRecords,
    now: now || new Date().toISOString(),
  });
}

export function buildLaneHandlerReport({
  selectorReport = {},
  refillPlannerReport = {},
  receiptReport = {},
  auditRecords = null,
  receiptRecords = null,
  evCostModel = null,
  activeCapitalUsd = null,
  now = null,
} = {}) {
  const selection = selectPilot({ selectorReport, refillPlannerReport, receiptReport });
  const resolvedEvCostModel = resolveEvCostModel({ evCostModel, auditRecords, receiptRecords, now });
  const handlerResults = runPilotHandler(selection, {
    refillPlannerReport,
    receiptReport,
    evCostModel: resolvedEvCostModel,
    activeCapitalUsd,
  });
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
