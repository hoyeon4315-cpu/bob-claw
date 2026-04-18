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

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function sumFinite(values = []) {
  return values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
}

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

function describeSourceAsset(chain, token, extra = {}) {
  const asset = tokenAsset(chain, token);
  return {
    chain,
    token,
    ticker: asset.ticker,
    isNative: asset.isNative,
    ...extra,
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
  requiresReserveState = undefined,
  reserveReplenishmentKnown = undefined,
  missingInputs = [],
  notes,
}) {
  const profile = METHOD_PROFILES[method];
  const expectedExecutionRefillCostUsd = estimateMethodCostUsd(method, action.refillEstimatedUsd);
  const resolvedRequiresReserveState = typeof requiresReserveState === "boolean" ? requiresReserveState : profile.requiresReserveState;
  const resolvedReserveReplenishmentKnown =
    typeof reserveReplenishmentKnown === "boolean" ? reserveReplenishmentKnown : profile.reserveReplenishmentKnown;
  return {
    method,
    availability,
    preferred,
    source,
    expectedExecutionRefillCostUsd,
    expectedReserveReplenishmentCostUsd:
      availability === "manual_only" || !resolvedReserveReplenishmentKnown ? null : 0,
    expectedLatencyMs: profile.expectedLatencyMs,
    requiresBootstrapNative,
    bootstrapNativeSatisfied,
    requiresReserveState: resolvedRequiresReserveState,
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
      preferred: false,
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
    preferred: bootstrapNativeSatisfied ? preferred : false,
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
    preferred: bootstrapNativeSatisfied ? preferred : false,
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

function selectCrossChainSource(action, plan) {
  const nativeSources = (plan.inventory?.native || [])
    .filter((item) => item.chain !== action.chain && Number(item.actual || 0) > 0)
    .map((item) => ({
      chain: item.chain,
      token: ZERO_TOKEN,
      estimatedUsd: item.estimatedUsd ?? null,
      actualDecimal: item.actualDecimal ?? null,
      sourceKind: "native",
    }));
  const tokenSources = (plan.inventory?.tokens || [])
    .filter((item) => item.chain !== action.chain && Number(item.actual || 0) > 0)
    .map((item) => ({
      chain: item.chain,
      token: item.token,
      estimatedUsd: item.estimatedUsd ?? null,
      actualDecimal: item.actualDecimal ?? null,
      sourceKind: "token",
    }));
  return [...nativeSources, ...tokenSources]
    .sort((left, right) => (right.estimatedUsd ?? -1) - (left.estimatedUsd ?? -1) || String(left.chain).localeCompare(String(right.chain)))[0] || null;
}

function crossChainCandidate(action, plan, policy) {
  const selectedSource = selectCrossChainSource(action, plan);
  const directInventoryMode = policy.walletMode === "single_wallet";
  if (!selectedSource) {
    return candidateRecord({
      action,
      method: "cross_chain_bridge_or_swap",
      source: null,
      availability: "conditional",
      preferred: false,
      requiresReserveState: false,
      reserveReplenishmentKnown: true,
      missingInputs: ["cross_chain_source_selection_missing"],
      notes: "Cross-chain funding has no observed source inventory yet, so the planner cannot promote it beyond a conditional source-selection stub.",
    });
  }
  return candidateRecord({
    action,
    method: "cross_chain_bridge_or_swap",
    source: describeSourceAsset(selectedSource.chain, selectedSource.token, {
      estimatedUsd: selectedSource.estimatedUsd,
      actualDecimal: selectedSource.actualDecimal,
      sourceKind: selectedSource.sourceKind,
    }),
    availability: directInventoryMode ? "ready" : "conditional",
    preferred: directInventoryMode,
    requiresReserveState: !directInventoryMode,
    reserveReplenishmentKnown: directInventoryMode,
    missingInputs: directInventoryMode ? [] : ["reserve_state_unmodelled"],
    notes: directInventoryMode
      ? "Single-wallet mode can consume observed cross-chain inventory directly, so the planner treats the selected source as immediately usable."
      : "Cross-chain funding source is selected from observed inventory, but reserve replenishment and route execution remain under-modelled.",
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
    const leftBootstrapBlocked = left.requiresBootstrapNative && !left.bootstrapNativeSatisfied;
    const rightBootstrapBlocked = right.requiresBootstrapNative && !right.bootstrapNativeSatisfied;
    if (leftBootstrapBlocked !== rightBootstrapBlocked) return leftBootstrapBlocked ? 1 : -1;
    const leftCost = Number.isFinite(left.expectedExecutionRefillCostUsd) ? left.expectedExecutionRefillCostUsd : Number.POSITIVE_INFINITY;
    const rightCost = Number.isFinite(right.expectedExecutionRefillCostUsd) ? right.expectedExecutionRefillCostUsd : Number.POSITIVE_INFINITY;
    if (leftCost !== rightCost) return leftCost - rightCost;
    return String(left.method).localeCompare(String(right.method));
  })[0];
}

function preferredRouteNetUsd(routeContext = null) {
  return finite(routeContext?.executableNetEdgeUsd) ?? finite(routeContext?.netEdgeUsd);
}

function estimateExpectedFailureCostUsd({ routeContext = null, summary = null }) {
  const failureRate = Math.max(0, finite(routeContext?.routeFailureRate) ?? 0);
  if (!(failureRate > 0)) return 0;
  const failureExposureUsd = sumFinite([
    routeContext?.knownCostUsd,
    summary?.executionRefillExpectedCostUsd,
    summary?.reserveReplenishmentExpectedCostUsd,
  ]);
  return failureExposureUsd * failureRate;
}

function estimateCapitalFragmentationDrag({ selections = [], routeContext = null, policy }) {
  const maxIdleCapitalPerChainUsd = finite(policy?.capital?.maxIdleCapitalPerChainUsd) ?? Number.POSITIVE_INFINITY;
  const fragmentationDragPct = finite(policy?.capital?.fragmentationDragPct) ?? 0.005;
  const fragmentedCapitalUsd = sumFinite(
    selections.map((item) => {
      const estimatedAssetValueUsd = finite(item?.estimatedAssetValueUsd);
      if (!Number.isFinite(estimatedAssetValueUsd)) return null;
      return Math.min(estimatedAssetValueUsd, maxIdleCapitalPerChainUsd);
    }),
  );
  const routeInputUsd = finite(routeContext?.inputUsd);
  const strandedCapitalUsd = Number.isFinite(routeInputUsd)
    ? Math.max(0, fragmentedCapitalUsd - routeInputUsd)
    : fragmentedCapitalUsd;
  return {
    fragmentedCapitalUsd,
    strandedCapitalUsd,
    capitalFragmentationDragUsd: fragmentedCapitalUsd > 0 ? strandedCapitalUsd * fragmentationDragPct : 0,
  };
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
    candidates.push(crossChainCandidate(action, plan, policy));
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
  const canModelSystemCosts = reserveReplenishmentKnown || selections.length === 0;
  const {
    fragmentedCapitalUsd,
    strandedCapitalUsd,
    capitalFragmentationDragUsd,
  } = routeContext
    ? estimateCapitalFragmentationDrag({ selections, routeContext, policy })
    : { fragmentedCapitalUsd: null, strandedCapitalUsd: null, capitalFragmentationDragUsd: null };
  const expectedFailureCostUsd = routeContext && canModelSystemCosts
    ? estimateExpectedFailureCostUsd({ routeContext, summary })
    : null;
  summary.fragmentedCapitalUsd = fragmentedCapitalUsd;
  summary.strandedCapitalUsd = strandedCapitalUsd;
  summary.expectedFailureCostUsd = expectedFailureCostUsd;
  summary.capitalFragmentationDragUsd = capitalFragmentationDragUsd;

  const reasons = [];
  if (selections.some((item) => item.requiresReserveState)) reasons.push("reserve_state_unmodelled");
  if (!reserveReplenishmentKnown && selections.length > 0) reasons.push("reserve_replenishment_unmodelled");
  if (selections.some((item) => item.requiresManualFunding)) reasons.push("manual_funding_dependency");
  if (selections.some((item) => item.missingInputs.includes("bootstrap_native_required"))) reasons.push("bootstrap_native_required");

  let effectiveSystemNetPnlUsd = null;
  const routeBaseNetUsd = preferredRouteNetUsd(routeContext);
  if (Number.isFinite(routeBaseNetUsd)) {
    if (canModelSystemCosts) {
      effectiveSystemNetPnlUsd =
        routeBaseNetUsd -
        summary.executionRefillExpectedCostUsd -
        (summary.reserveReplenishmentExpectedCostUsd || 0) -
        (expectedFailureCostUsd || 0) -
        (capitalFragmentationDragUsd || 0);
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
          srcChain: routeContext.srcChain ?? null,
          dstChain: routeContext.dstChain ?? null,
          srcToken: routeContext.srcToken ?? null,
          dstToken: routeContext.dstToken ?? null,
          amount: routeContext.amount,
          inputUsd: routeContext.inputUsd ?? null,
          prepFundingUsd: routeContext.prepFundingUsd ?? null,
          viableForPrep: routeContext.viableForPrep ?? null,
          txReady: routeContext.txReady ?? null,
          blockerCount: routeContext.blockerCount ?? null,
          netEdgeUsd: routeContext.netEdgeUsd ?? null,
          executableNetEdgeUsd: routeContext.executableNetEdgeUsd ?? null,
          knownCostUsd: routeContext.knownCostUsd ?? null,
          routeFailureRate: routeContext.routeFailureRate ?? null,
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
