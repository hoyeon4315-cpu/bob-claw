import { ZERO_TOKEN, isBtcLikeAsset, tokenAsset } from "../assets/tokens.mjs";

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

function normalizeInventoryEntry(entry = {}, kind) {
  const token = kind === "native" ? ZERO_TOKEN : entry.token;
  const resolvedAsset = entry.chain && token ? tokenAsset(entry.chain, token) : null;
  const amountRaw = entry.actual ?? entry.balance ?? null;
  return {
    chain: entry.chain,
    token,
    ticker: entry.ticker || resolvedAsset?.ticker || null,
    actual: amountRaw == null ? null : String(amountRaw),
    actualDecimal: finite(entry.actualDecimal),
    estimatedUsd: finite(entry.estimatedUsd),
    sourceKind: entry.sourceKind || kind,
  };
}

function mergeInventoryEntries(primaryEntries = [], supplementalEntries = [], kind) {
  const merged = new Map();
  const ingest = (entry, priority) => {
    const normalizedEntry = normalizeInventoryEntry(entry, kind);
    if (!normalizedEntry.chain) return;
    if (kind === "token" && !normalizedEntry.token) return;
    const key = kind === "native" ? normalizedEntry.chain : `${normalizedEntry.chain}:${normalized(normalizedEntry.token)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...normalizedEntry, priority });
      return;
    }
    const existingActual = Number(existing.actual || 0);
    const nextActual = Number(normalizedEntry.actual || 0);
    const existingUsd = Number.isFinite(existing.estimatedUsd) ? existing.estimatedUsd : -1;
    const nextUsd = Number.isFinite(normalizedEntry.estimatedUsd) ? normalizedEntry.estimatedUsd : -1;
    if (
      priority < existing.priority ||
      nextActual > existingActual ||
      (nextActual === existingActual && nextUsd > existingUsd)
    ) {
      merged.set(key, { ...normalizedEntry, priority: Math.min(priority, existing.priority) });
    }
  };

  for (const entry of supplementalEntries || []) ingest(entry, 1);
  for (const entry of primaryEntries || []) ingest(entry, 0);
  return [...merged.values()]
    .sort((left, right) => (right.estimatedUsd ?? -1) - (left.estimatedUsd ?? -1))
    .map(({ priority, ...entry }) => entry);
}

function mergeObservedInventory(planInventory = null, supplementalInventory = null) {
  if (!supplementalInventory) return planInventory;
  return {
    native: mergeInventoryEntries(planInventory?.native || [], supplementalInventory.native || [], "native"),
    tokens: mergeInventoryEntries(
      planInventory?.tokens || [],
      supplementalInventory.tokens || supplementalInventory.tokenBalances || [],
      "token",
    ),
  };
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

function sourceAmountMetadata(source = {}) {
  const resolvedSource = source || {};
  return {
    actual: resolvedSource.actual ?? resolvedSource.balance ?? null,
    actualDecimal: resolvedSource.actualDecimal ?? null,
    estimatedUsd: resolvedSource.estimatedUsd ?? null,
    sourceKind: resolvedSource.sourceKind || null,
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
    source: describeSourceAsset(action.chain, tokenSource.token, sourceAmountMetadata(tokenSource)),
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
    source: describeSourceAsset(action.chain, ZERO_TOKEN, sourceAmountMetadata(native)),
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

function crossChainRoutePreference(source, action, routeContext = null) {
  if (!routeContext || action.type !== "refill_native") return 5;
  if (source.chain === "bitcoin" && normalized(source.token) === normalized(ZERO_TOKEN)) return 0;
  if (routeContext.dstChain && routeContext.dstChain !== action.chain) return 5;
  if (source.chain === routeContext.srcChain && normalized(source.token) === normalized(routeContext.srcToken)) return 1;
  const sourceAsset = source.chain && source.token ? tokenAsset(source.chain, source.token) : null;
  const routeSourceAsset =
    routeContext.srcChain && routeContext.srcToken ? tokenAsset(routeContext.srcChain, routeContext.srcToken) : null;
  if (source.chain === routeContext.srcChain && sourceAsset?.family && sourceAsset.family === routeSourceAsset?.family) return 2;
  if (sourceAsset?.family && sourceAsset.family === routeSourceAsset?.family) return 3;
  if (source.sourceKind === "token") return 4;
  if (source.sourceKind === "native") return 5;
  return 5;
}

function selectCrossChainSource(action, plan, routeContext = null) {
  const nativeSources = (plan.inventory?.native || [])
    .filter((item) => item.chain !== action.chain && Number(item.actual || 0) > 0)
    .map((item) => ({
      chain: item.chain,
      token: ZERO_TOKEN,
      actual: item.actual ?? null,
      estimatedUsd: item.estimatedUsd ?? null,
      actualDecimal: item.actualDecimal ?? null,
      sourceKind: "native",
    }));
  const tokenSources = (plan.inventory?.tokens || [])
    .filter((item) => item.chain !== action.chain && Number(item.actual || 0) > 0)
    .map((item) => ({
      chain: item.chain,
      token: item.token,
      actual: item.actual ?? null,
      estimatedUsd: item.estimatedUsd ?? null,
      actualDecimal: item.actualDecimal ?? null,
      sourceKind: "token",
    }));
  return [...nativeSources, ...tokenSources]
    .sort((left, right) => {
      const preferenceDelta = crossChainRoutePreference(left, action, routeContext) - crossChainRoutePreference(right, action, routeContext);
      if (preferenceDelta !== 0) return preferenceDelta;
      const leftUsd = Number.isFinite(left.estimatedUsd) ? left.estimatedUsd : -1;
      const rightUsd = Number.isFinite(right.estimatedUsd) ? right.estimatedUsd : -1;
      if (leftUsd !== rightUsd) return rightUsd - leftUsd;
      return String(left.chain).localeCompare(String(right.chain));
    })[0] || null;
}

function crossChainExecutorSupport(action, selectedSource) {
  if (!selectedSource) {
    return {
      supported: false,
      missingInputs: ["cross_chain_source_selection_missing"],
      notes: "Cross-chain funding has no observed source inventory yet, so the planner cannot promote it beyond a conditional source-selection stub.",
    };
  }

  if (
    action.type === "refill_native" &&
    selectedSource.chain === "bitcoin" &&
    normalized(selectedSource.token) === normalized(ZERO_TOKEN)
  ) {
    return {
      supported: true,
      missingInputs: [],
      notes: "Gateway BTC onramp can bootstrap destination native gas from native BTC inventory using a gas-refill quote path.",
    };
  }

  if (action.type === "refill_token") {
    const sourceAsset = tokenAsset(selectedSource.chain, selectedSource.token);
    const targetAsset = tokenAsset(action.chain, action.token);
    if (isBtcLikeAsset(sourceAsset) && isBtcLikeAsset(targetAsset)) {
      return {
        supported: true,
        missingInputs: [],
        notes: "Gateway BTC-family consolidation can bridge the observed source token into the target-chain token inventory.",
      };
    }
    return {
      supported: false,
      missingInputs: ["cross_chain_token_refill_executor_missing"],
      notes: "Observed cross-chain inventory exists, but the repo only has a direct executor for BTC-family Gateway token refills.",
    };
  }

  return {
    supported: false,
    missingInputs: ["cross_chain_native_refill_executor_missing"],
    notes: "Observed cross-chain inventory exists, but native-gas refill still needs a same-chain swap or a dedicated bridge-to-native executor before it can run unattended.",
  };
}

function crossChainCandidate(action, plan, policy, routeContext = null) {
  const selectedSource = selectCrossChainSource(action, plan, routeContext);
  const directInventoryMode = policy.walletMode === "single_wallet";
  const executorSupport = crossChainExecutorSupport(action, selectedSource);
  if (!selectedSource) {
    return candidateRecord({
      action,
      method: "cross_chain_bridge_or_swap",
      source: null,
      availability: "conditional",
      preferred: false,
      requiresReserveState: false,
      reserveReplenishmentKnown: true,
      missingInputs: executorSupport.missingInputs,
      notes: executorSupport.notes,
    });
  }
  const executableDirectInventory = directInventoryMode && executorSupport.supported;
  return candidateRecord({
    action,
    method: "cross_chain_bridge_or_swap",
    source: describeSourceAsset(selectedSource.chain, selectedSource.token, {
      actual: selectedSource.actual,
      estimatedUsd: selectedSource.estimatedUsd,
      actualDecimal: selectedSource.actualDecimal,
      sourceKind: selectedSource.sourceKind,
    }),
    availability: executableDirectInventory ? "ready" : "conditional",
    preferred: executableDirectInventory,
    requiresReserveState: !directInventoryMode,
    reserveReplenishmentKnown: directInventoryMode,
    missingInputs: directInventoryMode ? executorSupport.missingInputs : ["reserve_state_unmodelled"],
    notes: executableDirectInventory
      ? executorSupport.notes
      : directInventoryMode
        ? executorSupport.notes
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

function rankConditionalSupport(candidate = {}) {
  const missingInputs = new Set(candidate.missingInputs || []);
  if (missingInputs.size === 0) return 0;
  if ([...missingInputs].every((item) => item === "bootstrap_native_required")) return 1;
  if (missingInputs.has("reserve_state_unmodelled")) return 2;
  if (
    missingInputs.has("cross_chain_source_selection_missing") ||
    [...missingInputs].some((item) => item.endsWith("_executor_missing"))
  ) {
    return 3;
  }
  if (missingInputs.has("same_chain_token_inventory_missing")) return 4;
  return 5;
}

function chooseCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
    const availabilityDelta = rankAvailability(left.availability) - rankAvailability(right.availability);
    if (availabilityDelta !== 0) return availabilityDelta;
    const supportDelta = rankConditionalSupport(left) - rankConditionalSupport(right);
    if (supportDelta !== 0) return supportDelta;
    const leftHasSource = Boolean(left.source);
    const rightHasSource = Boolean(right.source);
    if (leftHasSource !== rightHasSource) return leftHasSource ? -1 : 1;
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

export function buildFundingSourceCandidates(action, plan, policy, routeContext = null) {
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
    candidates.push(crossChainCandidate(action, plan, policy, routeContext));
  }

  candidates.push(manualFundingCandidate(action));
  return candidates;
}

export function buildFundingSourcePlan({ plan, policy, routeContext = null, supplementalInventory = null }) {
  const resolvedPlan = {
    ...plan,
    inventory: mergeObservedInventory(plan?.inventory || null, supplementalInventory),
  };
  const selections = (resolvedPlan.actions || []).map((action) => {
    const candidates = buildFundingSourceCandidates(action, resolvedPlan, policy, routeContext);
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
  const economicallyJustified = Number.isFinite(effectiveSystemNetPnlUsd) ? effectiveSystemNetPnlUsd > 0 : null;
  if (economicallyJustified === false) reasons.push("route_refill_economically_unjustified");

  return {
    schemaVersion: 1,
    observedAt: resolvedPlan.observedAt,
    address: resolvedPlan.address,
    decision: resolvedPlan.decision,
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
    inventory: resolvedPlan.inventory,
    reasons,
    selections,
    summary: {
      ...summary,
      economicallyJustified,
      effectiveSystemNetPnlUsd,
    },
  };
}

export { resourceKeyForRefillAction };
