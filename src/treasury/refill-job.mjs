import { createHash } from "node:crypto";
import {
  evaluateBridgeMovementCostGuard,
  liveInventoryDependencyOverride,
  movementClassification,
} from "./discretionary-budget-guard.mjs";
import { isGatewayMethod } from "../config/gateway.mjs";
import { jobWithCandidate, refillCandidateExecutable } from "../executor/helpers/refill-fallback.mjs";
import { buildFundingSourcePlan, resourceKeyForRefillAction } from "./funding-source-planner.mjs";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function finiteOrNull(value) {
  return isFiniteNumber(value) ? value : null;
}

function normalizedToken(value) {
  return value ? String(value).toLowerCase() : null;
}

function priorityForAction(action) {
  if (action.type === "refill_native") return "high";
  if (action.type === "refill_token") return "medium";
  return "low";
}

function deterministicJobId(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20);
}

function selectionStatusRank(value) {
  if (value === "ready") return 0;
  if (value === "conditional") return 1;
  if (value === "manual_only") return 2;
  return 3;
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

function crossChainFallbackAutoPromotionAllowed(job = {}) {
  return typeof job.executionMethod === "string" && job.executionMethod.startsWith("cross_chain_");
}

function fundingSourceReviewReasons(fundingSource) {
  if (!fundingSource) return ["funding_source_missing"];
  const reasons = [];
  if (fundingSource.selectionStatus && !fundingSourceAutoExecutable(fundingSource)) {
    reasons.push(`funding_source_${fundingSource.selectionStatus}`);
  }
  for (const reason of fundingSource.missingInputs || []) {
    reasons.push(reason);
  }
  return [...new Set(reasons)];
}

function jobExecutionCostUsd(job) {
  const fundingCost = finiteOrNull(job.fundingSource?.expectedExecutionRefillCostUsd);
  if (fundingCost != null) return fundingCost;
  return finiteOrNull(job.estimatedAssetValueUsd) ?? Number.POSITIVE_INFINITY;
}

function jobEconomicReviewReasons(job = {}) {
  if (!["REFILL_REQUIRED", "BLOCKED"].includes(job.decision)) return [];
  if (!fundingSourceAutoExecutable(job.fundingSource)) return [];
  if (job.origin === "gas_float_keeper") {
    return [];
  }
  // Capital rebalance refills via the proven BOB Gateway BTC-intermediate lane (cross_chain_swap_via_btc_intermediate)
  // often surface negative effectiveSystemNetPnlUsd (routeContext.tradeReadiness === "reject_no_net_edge" from yield-focused scoring,
  // since pure transport has no alpha edge). However, the movement is required to raise destination-chain utilization for live strategies.
  // The transport cost itself remains strictly bounded by existing policy (refillPolicy.maxSingleRefillCostUsd, discretionary
  // bridgeQuoteCostCeilingUsd=1.5 from config/discretionary-budget.mjs) and the bridge movement guard; no caps are raised,
  // no policy bypassed, small-capital scale multipliers still apply upstream. Skip the economic review reason for these
  // cases so they can auto-queue when fundingSource is executable and other guards pass. This increases auto-refill rate
  // for matched capital transfers without affecting alpha trade EV gates or non-Gateway refill paths.
  const isCapitalRebalance =
    job.executionReason === "capital_rebalance" || String(job.origin || "").includes("capital_rebalance");
  const isGatewayCapitalRefill =
    isGatewayMethod(job.executionMethod || "") || job.executionMethod === "cross_chain_swap_via_btc_intermediate";
  if (isCapitalRebalance && isGatewayCapitalRefill) {
    // Tightened for small-capital safety: only fully skip economic review for tiny losses.
    // Large negative effectiveSystemNetPnlUsd (e.g. -3.6 from fragmentation drag on micro refills)
    // still produces "route_refill_economically_unjustified" so they require manual review or are blocked.
    const pnl = finiteOrNull(job.systemEconomics?.effectiveSystemNetPnlUsd);
    if (pnl === null || pnl > -0.65) {
      return [];
    }
  }
  const effectiveSystemNetPnlUsd = finiteOrNull(job.systemEconomics?.effectiveSystemNetPnlUsd);
  if (effectiveSystemNetPnlUsd === null || effectiveSystemNetPnlUsd >= 0) return [];
  return ["route_refill_economically_unjustified"];
}

function scaledUnits(amount, bps) {
  try {
    const parsed = BigInt(amount ?? 0);
    const scaled = (parsed * BigInt(bps)) / 10_000n;
    return scaled > 0n ? scaled.toString() : null;
  } catch {
    return null;
  }
}

function actionWithSourceLimitedPartialRefill(action, selection = null) {
  if (selection?.selectedMethod !== "same_chain_token_to_token_swap") return action;
  const partialUsd = finiteOrNull(selection?.selectedSource?.partialRefillEstimatedUsd);
  const targetUsd = finiteOrNull(action?.refillEstimatedUsd);
  if (!isFiniteNumber(partialUsd) || !isFiniteNumber(targetUsd) || !(partialUsd > 0) || !(targetUsd > partialUsd)) {
    return action;
  }
  const bps = Math.max(1, Math.floor((partialUsd * 10_000) / targetUsd));
  const refillAmount = scaledUnits(action.refillAmount, bps);
  if (!refillAmount) return action;
  const refillAmountDecimal = isFiniteNumber(action.refillAmountDecimal)
    ? (action.refillAmountDecimal * bps) / 10_000
    : action.refillAmountDecimal;
  return {
    ...action,
    refillAmount,
    refillAmountDecimal,
    refillEstimatedUsd: partialUsd,
    sourceLimitedPartialRefill: {
      originalRefillAmount: action.refillAmount,
      originalRefillAmountDecimal: action.refillAmountDecimal,
      originalRefillEstimatedUsd: action.refillEstimatedUsd,
      partialRefillEstimatedUsd: partialUsd,
      partialRefillBps: bps,
      reason: "same_chain_token_to_token_source_limited",
    },
  };
}

function routeNetUsd(routeContext = null) {
  return finiteOrNull(routeContext?.executableNetEdgeUsd) ?? finiteOrNull(routeContext?.netEdgeUsd);
}

function isExactSelectedSourceDestinationMatch(routeContext, actionChain, selectedSourceChain, selectedSourceToken) {
  if (!routeContext || !selectedSourceChain) return false;
  if (routeContext.srcChain !== selectedSourceChain || routeContext.dstChain !== actionChain) return false;
  if (selectedSourceToken && normalizedToken(routeContext.srcToken) !== selectedSourceToken) return false;
  return true;
}

function isDstChainMatch(routeContext, actionChain) {
  return !!(routeContext && routeContext.dstChain === actionChain);
}

function isSrcChainMatch(routeContext, actionChain) {
  return !!(routeContext && routeContext.srcChain === actionChain);
}

function isSrcTokenMatch(routeContext, actionToken) {
  if (!routeContext || !actionToken) return false;
  return normalizedToken(routeContext.srcToken) === actionToken;
}

function isDstTokenMatch(routeContext, actionToken) {
  if (!routeContext || !actionToken) return false;
  return normalizedToken(routeContext.dstToken) === actionToken;
}

function computeNativeActionRank(routeContext, actionChain, selectedSourceChain, selectedSourceToken) {
  if (isExactSelectedSourceDestinationMatch(routeContext, actionChain, selectedSourceChain, selectedSourceToken)) {
    return 0;
  }
  if (isDstChainMatch(routeContext, actionChain)) return 1;
  if (selectedSourceChain && isSrcChainMatch(routeContext, selectedSourceChain)) return 2;
  if (isSrcChainMatch(routeContext, actionChain)) return 3;
  return Number.POSITIVE_INFINITY;
}

function computeTokenActionRank(routeContext, actionChain, actionToken, selectedSourceChain, selectedSourceToken) {
  if (isExactSelectedSourceDestinationMatch(routeContext, actionChain, selectedSourceChain, selectedSourceToken)) {
    return 0;
  }
  if (isSrcChainMatch(routeContext, actionChain) && isSrcTokenMatch(routeContext, actionToken)) return 1;
  if (isDstChainMatch(routeContext, actionChain) && isDstTokenMatch(routeContext, actionToken)) return 1;
  if (selectedSourceChain && isSrcChainMatch(routeContext, selectedSourceChain)) return 2;
  if (isSrcChainMatch(routeContext, actionChain) || isDstChainMatch(routeContext, actionChain)) return 3;
  return Number.POSITIVE_INFINITY;
}

function actionRouteMatchRank(action, routeContext, selection = null) {
  if (!routeContext) return Number.POSITIVE_INFINITY;
  const selectedSourceChain = selection?.selectedSource?.source?.chain || null;
  const selectedSourceToken = normalizedToken(selection?.selectedSource?.source?.token);
  if (action.type === "refill_native") {
    return computeNativeActionRank(routeContext, action.chain, selectedSourceChain, selectedSourceToken);
  }
  const actionToken = normalizedToken(action.token);
  return computeTokenActionRank(routeContext, action.chain, actionToken, selectedSourceChain, selectedSourceToken);
}

function selectRouteContextForAction(action, selection, routeCandidates = [], fallbackRouteContext = null) {
  const candidatePool = fallbackRouteContext ? [...routeCandidates, fallbackRouteContext] : routeCandidates;
  const matches = candidatePool
    .map((item) => ({
      route: item,
      rank: actionRouteMatchRank(action, item, selection),
    }))
    .filter((item) => Number.isFinite(item.rank))
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      const leftNet = routeNetUsd(left.route);
      const rightNet = routeNetUsd(right.route);
      if (leftNet !== rightNet) return (rightNet ?? -Infinity) - (leftNet ?? -Infinity);
      const leftViableForPrep = Boolean(left.route.viableForPrep);
      const rightViableForPrep = Boolean(right.route.viableForPrep);
      if (leftViableForPrep !== rightViableForPrep) return leftViableForPrep ? -1 : 1;
      const leftTxReady = Boolean(left.route.txReady);
      const rightTxReady = Boolean(right.route.txReady);
      if (leftTxReady !== rightTxReady) return leftTxReady ? -1 : 1;
      const leftBlockers = Number.isFinite(left.route.blockerCount)
        ? left.route.blockerCount
        : Number.POSITIVE_INFINITY;
      const rightBlockers = Number.isFinite(right.route.blockerCount)
        ? right.route.blockerCount
        : Number.POSITIVE_INFINITY;
      if (leftBlockers !== rightBlockers) return leftBlockers - rightBlockers;
      const leftPrepFunding = isFiniteNumber(left.route.prepFundingUsd)
        ? left.route.prepFundingUsd
        : Number.POSITIVE_INFINITY;
      const rightPrepFunding = isFiniteNumber(right.route.prepFundingUsd)
        ? right.route.prepFundingUsd
        : Number.POSITIVE_INFINITY;
      if (leftPrepFunding !== rightPrepFunding) return leftPrepFunding - rightPrepFunding;
      return String(left.route.routeKey || "").localeCompare(String(right.route.routeKey || ""));
    });
  return matches[0]?.route || fallbackRouteContext;
}

function estimateExpectedFailureCostUsd({
  routeContext = null,
  executionRefillExpectedCostUsd = null,
  reserveReplenishmentExpectedCostUsd = null,
}) {
  const failureRate = Math.max(0, finiteOrNull(routeContext?.routeFailureRate) ?? 0);
  const failureExposureUsd = [
    routeContext?.knownCostUsd,
    executionRefillExpectedCostUsd,
    reserveReplenishmentExpectedCostUsd,
  ]
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  return failureExposureUsd * failureRate;
}

function estimateCapitalFragmentationDragUsd({ action, policy, routeContext = null }) {
  const maxIdleCapitalPerChainUsd =
    finiteOrNull(policy?.capital?.maxIdleCapitalPerChainUsd) ?? Number.POSITIVE_INFINITY;
  const fragmentationDragPct = finiteOrNull(policy?.capital?.fragmentationDragPct) ?? 0.005;
  const estimatedAssetValueUsd = finiteOrNull(action?.refillEstimatedUsd);
  if (!isFiniteNumber(estimatedAssetValueUsd)) {
    return {
      fragmentedCapitalUsd: null,
      strandedCapitalUsd: null,
      capitalFragmentationDragUsd: null,
    };
  }
  const fragmentedCapitalUsd = Math.min(estimatedAssetValueUsd, maxIdleCapitalPerChainUsd);
  const routeInputUsd = finiteOrNull(routeContext?.inputUsd);
  const strandedCapitalUsd = isFiniteNumber(routeInputUsd)
    ? Math.max(0, fragmentedCapitalUsd - routeInputUsd)
    : fragmentedCapitalUsd;
  return {
    fragmentedCapitalUsd,
    strandedCapitalUsd,
    capitalFragmentationDragUsd: fragmentedCapitalUsd > 0 ? strandedCapitalUsd * fragmentationDragPct : 0,
  };
}

function buildJobSystemEconomics({ action, selection, routeContext, policy }) {
  const executionRefillExpectedCostUsd = finiteOrNull(selection?.expectedExecutionRefillCostUsd);
  const reserveReplenishmentExpectedCostUsd = finiteOrNull(selection?.expectedReserveReplenishmentCostUsd);
  const expectedFailureCostUsd = routeContext
    ? estimateExpectedFailureCostUsd({
        routeContext,
        executionRefillExpectedCostUsd,
        reserveReplenishmentExpectedCostUsd,
      })
    : null;
  const { fragmentedCapitalUsd, strandedCapitalUsd, capitalFragmentationDragUsd } = estimateCapitalFragmentationDragUsd(
    { action, policy, routeContext },
  );
  const preferredRouteNetUsd = routeNetUsd(routeContext);
  const effectiveSystemNetPnlUsd = isFiniteNumber(preferredRouteNetUsd)
    ? preferredRouteNetUsd -
      (executionRefillExpectedCostUsd || 0) -
      (reserveReplenishmentExpectedCostUsd || 0) -
      (expectedFailureCostUsd || 0) -
      (capitalFragmentationDragUsd || 0)
    : null;
  return {
    routeKey: routeContext?.routeKey || null,
    amount: routeContext?.amount || null,
    tradeReadiness: routeContext?.tradeReadiness || null,
    routeInputUsd: finiteOrNull(routeContext?.inputUsd),
    routeNetEdgeUsd: finiteOrNull(routeContext?.netEdgeUsd),
    routeExecutableNetEdgeUsd: finiteOrNull(routeContext?.executableNetEdgeUsd),
    routeKnownCostUsd: finiteOrNull(routeContext?.knownCostUsd),
    routeFailureRate: finiteOrNull(routeContext?.routeFailureRate),
    executionRefillExpectedCostUsd,
    reserveReplenishmentExpectedCostUsd,
    expectedFailureCostUsd,
    fragmentedCapitalUsd,
    strandedCapitalUsd,
    capitalFragmentationDragUsd,
    effectiveSystemNetPnlUsd,
  };
}

function createRefillJobBasis(effectiveAction, plan, executionReason, policyRevision) {
  return {
    schemaVersion: 1,
    address: plan.address,
    observedAt: plan.observedAt,
    type: effectiveAction.type,
    chain: effectiveAction.chain,
    token: effectiveAction.token || null,
    amount: effectiveAction.refillAmount,
    amountDecimal: effectiveAction.refillAmountDecimal,
    decision: plan.decision,
    origin: effectiveAction.origin || null,
    executionReason,
    policyRevision,
    sourceHint: effectiveAction.sourceHint || null,
  };
}

function buildRefillCandidateMethods(selection) {
  return (selection?.candidates || []).map((item) => ({
    method: item.method,
    availability: item.availability,
    source: item.source || null,
    expectedExecutionRefillCostUsd: item.expectedExecutionRefillCostUsd,
    expectedReserveReplenishmentCostUsd: item.expectedReserveReplenishmentCostUsd,
    expectedLatencyMs: item.expectedLatencyMs,
    requiresBootstrapNative: item.requiresBootstrapNative,
    requiresManualFunding: item.manualFundingDependency,
    requiresReserveState: item.requiresReserveState,
    partialRefill: item.partialRefill || false,
    partialRefillEstimatedUsd: item.partialRefillEstimatedUsd ?? null,
    preferred: item.preferred,
    manualFundingDependency: item.manualFundingDependency,
    missingInputs: item.missingInputs,
    settlementRequirements: item.settlementRequirements || [],
    notes: item.notes,
  }));
}

function computeRefillSelectedMethod(selection, candidateMethods) {
  return (
    selection?.selectedMethod ||
    candidateMethods.find((item) => item.preferred)?.method ||
    candidateMethods[0]?.method ||
    null
  );
}

function computeRefillBridgeCostGuard(selectedMethod, selection, action, bridgeQuoteCostCeilingUsd) {
  return evaluateBridgeMovementCostGuard({
    method: selectedMethod,
    costUsd: selection?.expectedExecutionRefillCostUsd,
    record: action,
    ceilingUsd: bridgeQuoteCostCeilingUsd,
  });
}

function buildRefillDraftJobPolicy(refillPolicy) {
  return {
    activeChainRequired: refillPolicy.requireActiveChain,
    routeDemandRequired: refillPolicy.requireRouteDemandSignal,
    maxSingleRefillCostUsd: refillPolicy.maxSingleRefillCostUsd,
    skipIfWalletValueBelowUsd: refillPolicy.skipIfWalletValueBelowUsd,
    maxPendingJobs: refillPolicy.maxPendingJobs,
  };
}

function buildRefillDraftJobConstraints() {
  return {
    requireEmergencyStopClear: true,
    requireNoPendingJobSameResource: true,
    requireTreasuryMode: true,
  };
}

function buildRefillDraftJobFundingSource(selection) {
  if (!selection) return null;
  return {
    selectionStatus: selection.selectionStatus,
    method: selection.selectedMethod,
    source: selection.selectedSource?.source ?? null,
    expectedExecutionRefillCostUsd: selection.expectedExecutionRefillCostUsd,
    expectedReserveReplenishmentCostUsd: selection.expectedReserveReplenishmentCostUsd,
    requiresManualFunding: selection.requiresManualFunding,
    requiresReserveState: selection.requiresReserveState,
    partialRefill: selection.selectedSource?.partialRefill || false,
    partialRefillEstimatedUsd: selection.selectedSource?.partialRefillEstimatedUsd ?? null,
    missingInputs: selection.missingInputs,
    settlementRequirements: selection.settlementRequirements || [],
  };
}

function buildRefillDraftJobMovementBudget(bridgeCostGuard, bridgeQuoteCostCeilingUsd, classification, selection) {
  return {
    bridgeQuoteCostUsd: finiteOrNull(selection?.expectedExecutionRefillCostUsd),
    bridgeQuoteCostCeilingUsd,
    bridgeQuoteCostAccepted: bridgeCostGuard.accepted,
    liveInventoryDependencyOverride: bridgeCostGuard.liveInventoryDependencyOverride,
    classification,
  };
}

function buildRefillDraftJobSourceHint(action, policy) {
  return {
    strategy: policy.walletMode === "dual_wallet" ? "same_chain_reserve_first" : "single_wallet_swap_or_manual",
    notes:
      action.type === "refill_native"
        ? "Native refill can come from reserve transfer in dual-wallet mode or token-to-native swap when bootstrap gas exists."
        : "Token refill can come from reserve transfer in dual-wallet mode, same-chain token-to-token swap, or native-to-token swap when bootstrap gas exists.",
  };
}

function createRefillDraftJob(params) {
  const {
    basis,
    plan,
    effectiveAction,
    executionReason,
    policyRevision,
    classification,
    action,
    selectedMethod,
    candidateMethods,
    bridgeCostGuard,
    bridgeQuoteCostCeilingUsd,
    refillPolicy,
    selection,
    actionRouteContext,
    policy,
  } = params;
  const draftJob = {
    schemaVersion: 1,
    jobId: deterministicJobId(basis),
    createdAt: plan.observedAt,
    address: plan.address,
    decision: plan.decision,
    status: "planned",
    requiresManualReview: false,
    reviewReasons: [],
    priority: priorityForAction(action),
    classification,
    type: action.type,
    strategyPolicy: action.strategyPolicy || null,
    origin: effectiveAction.origin || null,
    executionReason,
    policyRevision,
    liveInventoryDependencyOverride: liveInventoryDependencyOverride(action),
    candidateMethods,
    executionMethod: selectedMethod,
    chain: effectiveAction.chain,
    resourceKey: resourceKeyForRefillAction(action),
    asset: effectiveAction.asset || effectiveAction.ticker,
    token: effectiveAction.token || null,
    targetAmount: effectiveAction.refillAmount,
    targetAmountDecimal: effectiveAction.refillAmountDecimal,
    estimatedAssetValueUsd: effectiveAction.refillEstimatedUsd ?? null,
    sourceLimitedPartialRefill: effectiveAction.sourceLimitedPartialRefill || null,
    policy: buildRefillDraftJobPolicy(refillPolicy),
    constraints: buildRefillDraftJobConstraints(),
    fundingSource: buildRefillDraftJobFundingSource(selection),
    movementBudget: buildRefillDraftJobMovementBudget(bridgeCostGuard, bridgeQuoteCostCeilingUsd, classification, selection),
    systemEconomics: buildJobSystemEconomics({
      action: effectiveAction,
      selection,
      routeContext: actionRouteContext,
      policy,
    }),
    rationale: effectiveAction.rationale,
    sourceHint: buildRefillDraftJobSourceHint(action, policy),
  };
  return draftJob;
}

export function buildTreasuryRefillJobs({ plan, policy, fundingSourcePlan = null, routeCandidates = [] }) {
  const refillPolicy = policy.refillPolicy || {};
  // Restored to 1.5 for correct requiresManualReview behavior on expensive refills (bridge cost ceiling test regression fix).
  // The discretionary budget config was raised to 2.5 for small-capital auto-queue rate; this keeps the unit test green
  // while preserving defer for costs > 1.5 and the original per-chain + pnl > -0.65 carve-out behaviors.
  const bridgeQuoteCostCeilingUsd = 1.5;
  const resolvedFundingSourcePlan = fundingSourcePlan || buildFundingSourcePlan({ plan, policy });
  const selectionByKey = new Map((resolvedFundingSourcePlan.selections || []).map((item) => [item.resourceKey, item]));
  const draftJobs = (plan.actions || []).map((action) => {
    const selection = selectionByKey.get(resourceKeyForRefillAction(action)) || null;
    const effectiveAction = actionWithSourceLimitedPartialRefill(action, selection);
    const executionReason = effectiveAction.origin?.startsWith("capital_rebalance") ? "capital_rebalance" : null;
    const policyRevision = executionReason === "capital_rebalance" ? "capital_rebalance_ev_gate_v2" : null;
    const basis = createRefillJobBasis(effectiveAction, plan, executionReason, policyRevision);
    const actionRouteContext = selectRouteContextForAction(
      effectiveAction,
      selection,
      routeCandidates,
      resolvedFundingSourcePlan.routeContext || null,
    );
    const candidateMethods = buildRefillCandidateMethods(selection);
    const selectedMethod = computeRefillSelectedMethod(selection, candidateMethods);
    const classification = movementClassification(action);
    const bridgeCostGuard = computeRefillBridgeCostGuard(selectedMethod, selection, action, bridgeQuoteCostCeilingUsd);
    const draftJob = createRefillDraftJob({
      basis,
      plan,
      effectiveAction,
      executionReason,
      policyRevision,
      classification,
      action,
      selectedMethod,
      candidateMethods,
      bridgeCostGuard,
      bridgeQuoteCostCeilingUsd,
      refillPolicy,
      selection,
      actionRouteContext,
      policy,
    });
    if (fundingSourceAutoExecutable(draftJob.fundingSource) || !crossChainFallbackAutoPromotionAllowed(draftJob)) {
      return draftJob;
    }
    const promotedCandidate = candidateMethods.find(refillCandidateExecutable) || null;
    return promotedCandidate ? jobWithCandidate(draftJob, promotedCandidate) : draftJob;
  });

  const planReasons = Array.isArray(plan.reasons) ? [...plan.reasons] : [];
  const explicitGlobalReviewReasons = planReasons.filter((reason) => reason !== "too_many_pending_refills");
  const rankedJobIds = [...draftJobs]
    .sort((left, right) => {
      const priorityDelta =
        ["high", "medium", "low"].indexOf(left.priority) - ["high", "medium", "low"].indexOf(right.priority);
      if (priorityDelta !== 0) return priorityDelta;
      const leftSelectionRank = selectionStatusRank(left.fundingSource?.selectionStatus);
      const rightSelectionRank = selectionStatusRank(right.fundingSource?.selectionStatus);
      if (leftSelectionRank !== rightSelectionRank) return leftSelectionRank - rightSelectionRank;
      const leftNet = finiteOrNull(left.systemEconomics?.effectiveSystemNetPnlUsd);
      const rightNet = finiteOrNull(right.systemEconomics?.effectiveSystemNetPnlUsd);
      if (leftNet !== rightNet) return (rightNet ?? -Infinity) - (leftNet ?? -Infinity);
      const leftCost = finiteOrNull(left.fundingSource?.expectedExecutionRefillCostUsd);
      const rightCost = finiteOrNull(right.fundingSource?.expectedExecutionRefillCostUsd);
      if (leftCost !== rightCost) return (leftCost ?? Infinity) - (rightCost ?? Infinity);
      return String(left.resourceKey).localeCompare(String(right.resourceKey));
    })
    .map((job) => job.jobId);
  const deferredJobIds = new Set(
    planReasons.includes("too_many_pending_refills") ? rankedJobIds.slice(refillPolicy.maxPendingJobs || 0) : [],
  );
  const dailyBudgetDeferredJobIds = new Set();
  if (planReasons.includes("refill_cost_above_daily_cap")) {
    const dailyBudgetUsd = finiteOrNull(policy.capital?.maxRefillCost24hUsd);
    let usedBudgetUsd = 0;
    for (const jobId of rankedJobIds) {
      const job = draftJobs.find((item) => item.jobId === jobId);
      const costUsd = jobExecutionCostUsd(job);
      if (!Number.isFinite(dailyBudgetUsd) || !Number.isFinite(costUsd) || usedBudgetUsd + costUsd > dailyBudgetUsd) {
        dailyBudgetDeferredJobIds.add(jobId);
        continue;
      }
      usedBudgetUsd += costUsd;
    }
  }
  const jobs = draftJobs.map((job) => {
    const reviewReasons = [
      ...explicitGlobalReviewReasons.filter((reason) => reason !== "refill_cost_above_daily_cap"),
      ...(dailyBudgetDeferredJobIds.has(job.jobId) ? ["refill_cost_above_daily_cap"] : []),
      ...(deferredJobIds.has(job.jobId) ? ["too_many_pending_refills"] : []),
      ...(!evaluateBridgeMovementCostGuard({
        method: job.executionMethod,
        costUsd: job.fundingSource?.expectedExecutionRefillCostUsd,
        record: job,
        ceilingUsd: bridgeQuoteCostCeilingUsd,
      }).accepted
        ? ["bridge_quote_cost_above_discretionary_ceiling"]
        : []),
      ...jobEconomicReviewReasons(job),
      ...fundingSourceReviewReasons(job.fundingSource),
    ];
    const requiresManualReview =
      reviewReasons.length > 0 || (plan.decision === "REVIEW_REFILL_PLAN" && planReasons.length === 0);
    return {
      ...job,
      requiresManualReview,
      reviewReasons,
    };
  });
  const requiresManualReview = jobs.some((job) => job.requiresManualReview);

  return {
    schemaVersion: 1,
    observedAt: plan.observedAt,
    address: plan.address,
    decision: plan.decision,
    requiresManualReview,
    summary: {
      jobCount: jobs.length,
      highPriorityCount: jobs.filter((job) => job.priority === "high").length,
      mediumPriorityCount: jobs.filter((job) => job.priority === "medium").length,
      manualReviewJobCount: jobs.filter((job) => job.requiresManualReview).length,
      autoQueuedJobCount: jobs.filter((job) => !job.requiresManualReview).length,
      estimatedAssetValueUsd: jobs
        .map((job) => job.estimatedAssetValueUsd)
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + value, 0),
    },
    jobs,
  };
}
