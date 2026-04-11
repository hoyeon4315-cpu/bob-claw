import { ZERO_TOKEN, tokenAsset } from "../assets/tokens.mjs";

const METHOD_PROFILES = {
  same_chain_native_transfer: {
    fixedCostUsd: 0.01,
    variableCostBps: 10,
    expectedLatencyMs: 15_000,
    requiresReserveState: true,
    reserveReplenishmentKnown: false,
    manualFundingDependency: false,
  },
  same_chain_token_transfer: {
    fixedCostUsd: 0.015,
    variableCostBps: 10,
    expectedLatencyMs: 18_000,
    requiresReserveState: true,
    reserveReplenishmentKnown: false,
    manualFundingDependency: false,
  },
  same_chain_token_to_native_swap: {
    fixedCostUsd: 0.03,
    variableCostBps: 35,
    expectedLatencyMs: 25_000,
    requiresReserveState: false,
    reserveReplenishmentKnown: true,
    manualFundingDependency: false,
  },
  same_chain_native_to_token_swap: {
    fixedCostUsd: 0.03,
    variableCostBps: 35,
    expectedLatencyMs: 25_000,
    requiresReserveState: false,
    reserveReplenishmentKnown: true,
    manualFundingDependency: false,
  },
  cross_chain_bridge_or_swap: {
    fixedCostUsd: 0.2,
    variableCostBps: 75,
    expectedLatencyMs: 240_000,
    requiresReserveState: true,
    reserveReplenishmentKnown: false,
    manualFundingDependency: false,
  },
  external_manual_funding: {
    fixedCostUsd: null,
    variableCostBps: null,
    expectedLatencyMs: null,
    requiresReserveState: false,
    reserveReplenishmentKnown: false,
    manualFundingDependency: true,
  },
};

function normalized(value) {
  return String(value || "").toLowerCase();
}

function resourceKeyForRefillAction(action) {
  return action.type === "refill_native" ? `${action.chain}:native` : `${action.chain}:${normalized(action.token)}`;
}

function inventoryForChain(plan, chain) {
  return {
    native: (plan.inventory?.native || []).find((item) => item.chain === chain) || null,
    tokens: (plan.inventory?.tokens || []).filter((item) => item.chain === chain),
  };
}

function sortByEstimatedUsd(items) {
  return [...items].sort((left, right) => {
    const leftUsd = Number.isFinite(left.estimatedUsd) ? left.estimatedUsd : -1;
    const rightUsd = Number.isFinite(right.estimatedUsd) ? right.estimatedUsd : -1;
    return rightUsd - leftUsd;
  });
}

function estimateMethodCostUsd(method, assetValueUsd) {
  const profile = METHOD_PROFILES[method];
  if (!profile || !Number.isFinite(profile.fixedCostUsd) || !Number.isFinite(profile.variableCostBps) || !Number.isFinite(assetValueUsd)) {
    return null;
  }
  return profile.fixedCostUsd + assetValueUsd * (profile.variableCostBps / 10_000);
}

function describeSourceAsset(chain, token) {
  const asset = tokenAsset(chain, token);
  return {
    chain,
    token,
    ticker: asset.ticker,
    isNative: asset.isNative,
  };
}

function candidateRecord({
  action,
  method,
  source = null,
  availability,
  preferred,
  requiresBootstrapNative = false,
  bootstrapNativeSatisfied = true,
  missingInputs = [],
  notes,
}) {
  const profile = METHOD_PROFILES[method];
  const expectedExecutionRefillCostUsd = estimateMethodCostUsd(method, action.refillEstimatedUsd);
  return {
    method,
    availability,
    preferred,
    source,
    expectedExecutionRefillCostUsd,
    expectedReserveReplenishmentCostUsd:
      availability === "manual_only" || !profile.reserveReplenishmentKnown ? null : 0,
    expectedLatencyMs: profile.expectedLatencyMs,
    requiresBootstrapNative,
    bootstrapNativeSatisfied,
    requiresReserveState: profile.requiresReserveState,
    manualFundingDependency: profile.manualFundingDependency,
    missingInputs,
    notes,
  };
}

function nativeSwapCandidate(action, plan, preferred) {
  const chainInventory = inventoryForChain(plan, action.chain);
  const native = chainInventory.native;
  const tokenSource = sortByEstimatedUsd(chainInventory.tokens.filter((item) => Number(item.actual || 0) > 0))[0] || null;
  if (!tokenSource) {
    return candidateRecord({
      action,
      method: "same_chain_token_to_native_swap",
      source: null,
      availability: "conditional",
      preferred,
      requiresBootstrapNative: true,
      bootstrapNativeSatisfied: false,
      missingInputs: ["same_chain_token_inventory_missing", "bootstrap_native_required"],
      notes: "No same-chain token inventory is available to rebuild native gas through a swap.",
    });
  }
  const bootstrapNativeSatisfied = Number(native?.actualDecimal || 0) > 0;
  return candidateRecord({
    action,
    method: "same_chain_token_to_native_swap",
    source: describeSourceAsset(action.chain, tokenSource.token),
    availability: bootstrapNativeSatisfied ? "ready" : "conditional",
    preferred,
    requiresBootstrapNative: true,
    bootstrapNativeSatisfied,
    missingInputs: bootstrapNativeSatisfied ? [] : ["bootstrap_native_required"],
    notes: "Use same-chain token inventory to rebuild native gas when some bootstrap native gas still exists.",
  });
}

function tokenSwapCandidate(action, plan, preferred) {
  const chainInventory = inventoryForChain(plan, action.chain);
  const native = chainInventory.native;
  const bootstrapNativeSatisfied = Number(native?.actualDecimal || 0) > 0;
  return candidateRecord({
    action,
    method: "same_chain_native_to_token_swap",
    source: describeSourceAsset(action.chain, ZERO_TOKEN),
    availability: bootstrapNativeSatisfied ? "ready" : "conditional",
    preferred,
    requiresBootstrapNative: true,
    bootstrapNativeSatisfied,
    missingInputs: bootstrapNativeSatisfied ? [] : ["bootstrap_native_required"],
    notes: "Use same-chain native balance to acquire the route token inventory.",
  });
}

function reserveTransferCandidate(action, preferred) {
  return candidateRecord({
    action,
    method: action.type === "refill_native" ? "same_chain_native_transfer" : "same_chain_token_transfer",
    source: describeSourceAsset(action.chain, action.type === "refill_native" ? ZERO_TOKEN : action.token),
    availability: "conditional",
    preferred,
    missingInputs: ["reserve_state_unmodelled"],
    notes: "Preferred in dual-wallet mode, but the repo does not yet model reserve balances or reserve replenishment state.",
  });
}

function crossChainCandidate(action) {
  return candidateRecord({
    action,
    method: "cross_chain_bridge_or_swap",
    source: null,
    availability: "conditional",
    preferred: false,
    missingInputs: ["cross_chain_source_selection_missing", "reserve_state_unmodelled"],
    notes: "Cross-chain funding remains secondary because cost, delay, and settlement risk are still under-modelled.",
  });
}

function manualFundingCandidate(action) {
  return candidateRecord({
    action,
    method: "external_manual_funding",
    source: null,
    availability: "manual_only",
    preferred: false,
    notes: "Manual funding stays as the last-resort fallback during canary and design phases.",
  });
}

function rankAvailability(value) {
  if (value === "ready") return 0;
  if (value === "conditional") return 1;
  if (value === "manual_only") return 2;
  return 3;
}

function chooseCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
    const availabilityDelta = rankAvailability(left.availability) - rankAvailability(right.availability);
    if (availabilityDelta !== 0) return availabilityDelta;
    const leftCost = Number.isFinite(left.expectedExecutionRefillCostUsd) ? left.expectedExecutionRefillCostUsd : Number.POSITIVE_INFINITY;
    const rightCost = Number.isFinite(right.expectedExecutionRefillCostUsd) ? right.expectedExecutionRefillCostUsd : Number.POSITIVE_INFINITY;
    if (leftCost !== rightCost) return leftCost - rightCost;
    return String(left.method).localeCompare(String(right.method));
  })[0];
}

export function buildFundingSourceCandidates(action, plan, policy) {
  const candidates = [];
  if (policy.walletMode === "dual_wallet") {
    candidates.push(reserveTransferCandidate(action, true));
  }

  if (policy.refillPolicy.enableDexRefill) {
    if (action.type === "refill_native") {
      candidates.push(nativeSwapCandidate(action, plan, policy.walletMode !== "dual_wallet"));
    } else if (action.type === "refill_token") {
      candidates.push(tokenSwapCandidate(action, plan, policy.walletMode !== "dual_wallet"));
    }
  }

  if (policy.refillPolicy.enableCrossChainRefill) {
    candidates.push(crossChainCandidate(action));
  }

  candidates.push(manualFundingCandidate(action));
  return candidates;
}

export function buildFundingSourcePlan({ plan, policy, routeContext = null }) {
  const selections = (plan.actions || []).map((action) => {
    const candidates = buildFundingSourceCandidates(action, plan, policy);
    const selected = chooseCandidate(candidates);
    return {
      resourceKey: resourceKeyForRefillAction(action),
      type: action.type,
      chain: action.chain,
      asset: action.asset || action.ticker,
      token: action.token || null,
      targetAmount: action.refillAmount,
      targetAmountDecimal: action.refillAmountDecimal,
      estimatedAssetValueUsd: action.refillEstimatedUsd ?? null,
      candidates,
      selectedMethod: selected.method,
      selectedSource: selected,
      selectionStatus: selected.availability,
      expectedExecutionRefillCostUsd: selected.expectedExecutionRefillCostUsd,
      expectedReserveReplenishmentCostUsd: selected.expectedReserveReplenishmentCostUsd,
      requiresManualFunding: selected.manualFundingDependency,
      requiresReserveState: selected.requiresReserveState,
      missingInputs: selected.missingInputs,
      rationale: action.rationale,
    };
  });

  const summary = {
    selectionCount: selections.length,
    readyCount: selections.filter((item) => item.selectionStatus === "ready").length,
    conditionalCount: selections.filter((item) => item.selectionStatus === "conditional").length,
    manualOnlyCount: selections.filter((item) => item.selectionStatus === "manual_only").length,
    executionRefillExpectedCostUsd: selections
      .map((item) => item.expectedExecutionRefillCostUsd)
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0),
  };

  const reserveCosts = selections.map((item) => item.expectedReserveReplenishmentCostUsd);
  const reserveReplenishmentKnown = reserveCosts.every((value) => Number.isFinite(value));
  summary.reserveReplenishmentExpectedCostUsd = reserveReplenishmentKnown
    ? reserveCosts.reduce((sum, value) => sum + value, 0)
    : null;

  const reasons = [];
  if (selections.some((item) => item.requiresReserveState)) reasons.push("reserve_state_unmodelled");
  if (!reserveReplenishmentKnown && selections.length > 0) reasons.push("reserve_replenishment_unmodelled");
  if (selections.some((item) => item.requiresManualFunding)) reasons.push("manual_funding_dependency");
  if (selections.some((item) => item.missingInputs.includes("bootstrap_native_required"))) reasons.push("bootstrap_native_required");

  let effectiveSystemNetPnlUsd = null;
  if (Number.isFinite(routeContext?.netEdgeUsd)) {
    if (reserveReplenishmentKnown) {
      effectiveSystemNetPnlUsd =
        routeContext.netEdgeUsd - summary.executionRefillExpectedCostUsd - summary.reserveReplenishmentExpectedCostUsd;
    } else if (selections.length === 0) {
      effectiveSystemNetPnlUsd = routeContext.netEdgeUsd;
    }
  }

  return {
    schemaVersion: 1,
    observedAt: plan.observedAt,
    address: plan.address,
    decision: plan.decision,
    routeContext: routeContext
      ? {
          routeKey: routeContext.routeKey,
          amount: routeContext.amount,
          inputUsd: routeContext.inputUsd ?? null,
          prepFundingUsd: routeContext.prepFundingUsd ?? null,
          netEdgeUsd: routeContext.netEdgeUsd ?? null,
          executableNetEdgeUsd: routeContext.executableNetEdgeUsd ?? null,
          tradeReadiness: routeContext.tradeReadiness ?? null,
        }
      : null,
    reasons,
    selections,
    summary: {
      ...summary,
      effectiveSystemNetPnlUsd,
    },
  };
}

export { resourceKeyForRefillAction };
