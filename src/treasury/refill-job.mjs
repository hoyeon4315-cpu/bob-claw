import { createHash } from "node:crypto";
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

function routeNetUsd(routeContext = null) {
  return finiteOrNull(routeContext?.executableNetEdgeUsd) ?? finiteOrNull(routeContext?.netEdgeUsd);
}

function actionRouteMatchRank(action, routeContext, selection = null) {
  if (!routeContext) return Number.POSITIVE_INFINITY;
  const selectedSourceChain = selection?.selectedSource?.source?.chain || null;
  const selectedSourceToken = normalizedToken(selection?.selectedSource?.source?.token);
  if (action.type === "refill_native") {
    if (
      selectedSourceChain &&
      routeContext.srcChain === selectedSourceChain &&
      routeContext.dstChain === action.chain &&
      (!selectedSourceToken || normalizedToken(routeContext.srcToken) === selectedSourceToken)
    ) {
      return 0;
    }
    if (routeContext.dstChain === action.chain) return 1;
    if (selectedSourceChain && routeContext.srcChain === selectedSourceChain) return 2;
    if (routeContext.srcChain === action.chain) return 3;
    return Number.POSITIVE_INFINITY;
  }
  const actionToken = normalizedToken(action.token);
  if (
    selectedSourceChain &&
    routeContext.srcChain === selectedSourceChain &&
    routeContext.dstChain === action.chain &&
    (!selectedSourceToken || normalizedToken(routeContext.srcToken) === selectedSourceToken)
  ) {
    return 0;
  }
  if (routeContext.srcChain === action.chain && normalizedToken(routeContext.srcToken) === actionToken) return 1;
  if (routeContext.dstChain === action.chain && normalizedToken(routeContext.dstToken) === actionToken) return 1;
  if (selectedSourceChain && routeContext.srcChain === selectedSourceChain) return 2;
  if (routeContext.srcChain === action.chain || routeContext.dstChain === action.chain) return 3;
  return Number.POSITIVE_INFINITY;
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
      const leftBlockers = Number.isFinite(left.route.blockerCount) ? left.route.blockerCount : Number.POSITIVE_INFINITY;
      const rightBlockers = Number.isFinite(right.route.blockerCount) ? right.route.blockerCount : Number.POSITIVE_INFINITY;
      if (leftBlockers !== rightBlockers) return leftBlockers - rightBlockers;
      const leftPrepFunding = isFiniteNumber(left.route.prepFundingUsd) ? left.route.prepFundingUsd : Number.POSITIVE_INFINITY;
      const rightPrepFunding = isFiniteNumber(right.route.prepFundingUsd) ? right.route.prepFundingUsd : Number.POSITIVE_INFINITY;
      if (leftPrepFunding !== rightPrepFunding) return leftPrepFunding - rightPrepFunding;
      return String(left.route.routeKey || "").localeCompare(String(right.route.routeKey || ""));
    });
  return matches[0]?.route || fallbackRouteContext;
}

function estimateExpectedFailureCostUsd({ routeContext = null, executionRefillExpectedCostUsd = null, reserveReplenishmentExpectedCostUsd = null }) {
  const failureRate = Math.max(0, finiteOrNull(routeContext?.routeFailureRate) ?? 0);
  const failureExposureUsd = [routeContext?.knownCostUsd, executionRefillExpectedCostUsd, reserveReplenishmentExpectedCostUsd]
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  return failureExposureUsd * failureRate;
}

function estimateCapitalFragmentationDragUsd({ action, policy, routeContext = null }) {
  const maxIdleCapitalPerChainUsd = finiteOrNull(policy?.capital?.maxIdleCapitalPerChainUsd) ?? Number.POSITIVE_INFINITY;
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
    ? estimateExpectedFailureCostUsd({ routeContext, executionRefillExpectedCostUsd, reserveReplenishmentExpectedCostUsd })
    : null;
  const {
    fragmentedCapitalUsd,
    strandedCapitalUsd,
    capitalFragmentationDragUsd,
  } = estimateCapitalFragmentationDragUsd({ action, policy, routeContext });
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

export function buildTreasuryRefillJobs({ plan, policy, fundingSourcePlan = null, routeCandidates = [] }) {
  const refillPolicy = policy.refillPolicy || {};
  const resolvedFundingSourcePlan = fundingSourcePlan || buildFundingSourcePlan({ plan, policy });
  const selectionByKey = new Map((resolvedFundingSourcePlan.selections || []).map((item) => [item.resourceKey, item]));
  const draftJobs = (plan.actions || []).map((action) => {
    const basis = {
      schemaVersion: 1,
      address: plan.address,
      observedAt: plan.observedAt,
      type: action.type,
      chain: action.chain,
      token: action.token || null,
      amount: action.refillAmount,
      amountDecimal: action.refillAmountDecimal,
      decision: plan.decision,
    };
    const selection = selectionByKey.get(resourceKeyForRefillAction(action)) || null;
    const actionRouteContext = selectRouteContextForAction(action, selection, routeCandidates, resolvedFundingSourcePlan.routeContext || null);
    const candidateMethods = (selection?.candidates || []).map((item) => ({
      method: item.method,
      availability: item.availability,
      source: item.source || null,
      expectedExecutionRefillCostUsd: item.expectedExecutionRefillCostUsd,
      expectedReserveReplenishmentCostUsd: item.expectedReserveReplenishmentCostUsd,
      expectedLatencyMs: item.expectedLatencyMs,
      requiresBootstrapNative: item.requiresBootstrapNative,
      requiresManualFunding: item.manualFundingDependency,
      requiresReserveState: item.requiresReserveState,
      preferred: item.preferred,
      manualFundingDependency: item.manualFundingDependency,
      missingInputs: item.missingInputs,
      settlementRequirements: item.settlementRequirements || [],
      notes: item.notes,
    }));
    const selectedMethod = selection?.selectedMethod || candidateMethods.find((item) => item.preferred)?.method || candidateMethods[0]?.method || null;
    return {
      schemaVersion: 1,
      jobId: deterministicJobId(basis),
      createdAt: plan.observedAt,
      address: plan.address,
      status: "planned",
      requiresManualReview: false,
      reviewReasons: [],
      priority: priorityForAction(action),
      type: action.type,
      strategyPolicy: action.strategyPolicy || null,
      candidateMethods,
      executionMethod: selectedMethod,
      chain: action.chain,
      resourceKey: resourceKeyForRefillAction(action),
      asset: action.asset || action.ticker,
      token: action.token || null,
      targetAmount: action.refillAmount,
      targetAmountDecimal: action.refillAmountDecimal,
      estimatedAssetValueUsd: action.refillEstimatedUsd ?? null,
      policy: {
        activeChainRequired: refillPolicy.requireActiveChain,
        routeDemandRequired: refillPolicy.requireRouteDemandSignal,
        maxSingleRefillCostUsd: refillPolicy.maxSingleRefillCostUsd,
        skipIfWalletValueBelowUsd: refillPolicy.skipIfWalletValueBelowUsd,
        maxPendingJobs: refillPolicy.maxPendingJobs,
      },
      constraints: {
        requireEmergencyStopClear: true,
        requireNoPendingJobSameResource: true,
        requireTreasuryMode: true,
      },
      fundingSource: selection
        ? {
            selectionStatus: selection.selectionStatus,
            method: selection.selectedMethod,
            source: selection.selectedSource?.source ?? null,
            expectedExecutionRefillCostUsd: selection.expectedExecutionRefillCostUsd,
            expectedReserveReplenishmentCostUsd: selection.expectedReserveReplenishmentCostUsd,
            requiresManualFunding: selection.requiresManualFunding,
            requiresReserveState: selection.requiresReserveState,
            missingInputs: selection.missingInputs,
            settlementRequirements: selection.settlementRequirements || [],
          }
        : null,
      systemEconomics: buildJobSystemEconomics({ action, selection, routeContext: actionRouteContext, policy }),
      rationale: action.rationale,
      sourceHint: {
        strategy: policy.walletMode === "dual_wallet" ? "same_chain_reserve_first" : "single_wallet_swap_or_manual",
        notes:
          action.type === "refill_native"
            ? "Native refill can come from reserve transfer in dual-wallet mode or token-to-native swap when bootstrap gas exists."
            : "Token refill can come from reserve transfer in dual-wallet mode or native-to-token swap when bootstrap gas exists.",
        },
      };
    });

  const planReasons = Array.isArray(plan.reasons) ? [...plan.reasons] : [];
  const explicitGlobalReviewReasons = planReasons.filter((reason) => reason !== "too_many_pending_refills");
  const rankedJobIds = [...draftJobs]
    .sort((left, right) => {
      const priorityDelta = ["high", "medium", "low"].indexOf(left.priority) - ["high", "medium", "low"].indexOf(right.priority);
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
