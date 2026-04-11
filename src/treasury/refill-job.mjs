import { createHash } from "node:crypto";
import { buildFundingSourcePlan, resourceKeyForRefillAction } from "./funding-source-planner.mjs";

function priorityForAction(action) {
  if (action.type === "refill_native") return "high";
  if (action.type === "refill_token") return "medium";
  return "low";
}

function deterministicJobId(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20);
}

export function buildTreasuryRefillJobs({ plan, policy, fundingSourcePlan = null }) {
  const requiresManualReview = plan.decision === "REVIEW_REFILL_PLAN";
  const refillPolicy = policy.refillPolicy || {};
  const resolvedFundingSourcePlan = fundingSourcePlan || buildFundingSourcePlan({ plan, policy });
  const selectionByKey = new Map((resolvedFundingSourcePlan.selections || []).map((item) => [item.resourceKey, item]));
  const jobs = (plan.actions || []).map((action) => {
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
    const candidateMethods = (selection?.candidates || []).map((item) => ({
      method: item.method,
      availability: item.availability,
      expectedExecutionRefillCostUsd: item.expectedExecutionRefillCostUsd,
      expectedReserveReplenishmentCostUsd: item.expectedReserveReplenishmentCostUsd,
      expectedLatencyMs: item.expectedLatencyMs,
      requiresBootstrapNative: item.requiresBootstrapNative,
      preferred: item.preferred,
      manualFundingDependency: item.manualFundingDependency,
      missingInputs: item.missingInputs,
      notes: item.notes,
    }));
    const selectedMethod = selection?.selectedMethod || candidateMethods.find((item) => item.preferred)?.method || candidateMethods[0]?.method || null;
    return {
      schemaVersion: 1,
      jobId: deterministicJobId(basis),
      createdAt: plan.observedAt,
      address: plan.address,
      status: "planned",
      requiresManualReview,
      priority: priorityForAction(action),
      type: action.type,
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
          }
        : null,
      systemEconomics: {
        routeKey: resolvedFundingSourcePlan.routeContext?.routeKey || null,
        amount: resolvedFundingSourcePlan.routeContext?.amount || null,
        tradeReadiness: resolvedFundingSourcePlan.routeContext?.tradeReadiness || null,
        routeInputUsd: resolvedFundingSourcePlan.routeContext?.inputUsd ?? null,
        routeNetEdgeUsd: resolvedFundingSourcePlan.routeContext?.netEdgeUsd ?? null,
        routeExecutableNetEdgeUsd: resolvedFundingSourcePlan.routeContext?.executableNetEdgeUsd ?? null,
        effectiveSystemNetPnlUsd: resolvedFundingSourcePlan.summary?.effectiveSystemNetPnlUsd ?? null,
      },
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
      estimatedAssetValueUsd: jobs
        .map((job) => job.estimatedAssetValueUsd)
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + value, 0),
    },
    jobs,
  };
}
