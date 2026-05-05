import { WBTC_OFT_TOKEN, WRAPPED_NATIVE_TOKENS, ZERO_TOKEN, isBtcLikeAsset, tokenAsset } from "../assets/tokens.mjs";
import { acrossSupportsPair } from "../config/across.mjs";
import {
  BRIDGE_PROVIDERS,
  fallbackProvidersWhenGatewayPaused,
} from "../config/bridge-providers.mjs";
import { GAS_ZIP_DEFAULT_POLICY, gasZipAcceptsAction, gasZipInboundChain } from "../config/gas-zip.mjs";
import { isGatewayMethod } from "../config/gateway.mjs";
import { dexProvidersForChain } from "../dex/providers.mjs";

const PARTIAL_REFILL_MIN_COVERAGE_BPS = 8500n;

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
  same_chain_token_to_token_swap: {
    fixedCostUsd: 0.035,
    variableCostBps: 40,
    expectedLatencyMs: 30_000,
    requiresReserveState: false,
    reserveReplenishmentKnown: true,
    manualFundingDependency: false,
  },
  gas_refuel_bridge_gas_zip: {
    fixedCostUsd: 0.05,
    variableCostBps: 50,
    expectedLatencyMs: 90_000,
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
  cross_chain_swap_via_btc_intermediate: {
    fixedCostUsd: 0.25,
    variableCostBps: 100,
    expectedLatencyMs: 300_000,
    requiresReserveState: true,
    reserveReplenishmentKnown: false,
    manualFundingDependency: false,
  },
  cross_chain_bridge_across: {
    fixedCostUsd: 0.15,
    variableCostBps: 25,
    expectedLatencyMs: 180_000,
    requiresReserveState: false,
    reserveReplenishmentKnown: true,
    manualFundingDependency: false,
  },
  cross_chain_bridge_lifi: {
    fixedCostUsd: 0.25,
    variableCostBps: 45,
    expectedLatencyMs: 300_000,
    requiresReserveState: false,
    reserveReplenishmentKnown: true,
    manualFundingDependency: false,
  },
  cross_chain_bridge_relay: {
    fixedCostUsd: 0.1,
    variableCostBps: 15,
    expectedLatencyMs: 60_000,
    requiresReserveState: false,
    reserveReplenishmentKnown: true,
    manualFundingDependency: false,
  },
  cross_chain_bridge_stargate: {
    fixedCostUsd: 0.3,
    variableCostBps: 60,
    expectedLatencyMs: 240_000,
    requiresReserveState: false,
    reserveReplenishmentKnown: true,
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

function isStablecoinTicker(value) {
  const ticker = String(value || "").toUpperCase();
  return ticker.startsWith("USDC") || ticker === "USDT" || ticker === "RLUSD" || ticker === "DAI";
}

function resourceKeyForRefillAction(action) {
  const baseKey = action.type === "refill_native" ? `${action.chain}:native` : `${action.chain}:${normalized(action.token)}`;
  if (!action?.sourceHint?.chain) return baseKey;
  return `${baseKey}:from:${action.sourceHint.chain}:${normalized(action.sourceHint.token || ZERO_TOKEN)}`;
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

function sourceInventoryCoversTargetValue(action, source = null) {
  const targetUsd = finite(action?.refillEstimatedUsd);
  if (!Number.isFinite(targetUsd) || !(targetUsd > 0)) return true;
  const sourceUsd = finite(source?.estimatedUsd);
  return Number.isFinite(sourceUsd) && sourceUsd >= targetUsd;
}

function sourceInventoryCoversTargetAmount(action, source = null) {
  if (!source) return false;
  try {
    const targetAmount = BigInt(action?.refillAmount ?? 0);
    const sourceAmount = BigInt(source?.actual ?? source?.balance ?? 0);
    if (targetAmount <= 0n) return false;
    if (sourceAmount >= targetAmount) return true;
    return (sourceAmount * 10_000n) / targetAmount >= PARTIAL_REFILL_MIN_COVERAGE_BPS;
  } catch {
    return false;
  }
}

function shouldUseRawAmountCoverage(action, source = null) {
  if (action?.type !== "refill_token" || !source?.token || !action?.token) return false;
  if (normalized(source.token) !== normalized(action.token)) return false;
  const sourceAsset = tokenAsset(source.chain, source.token);
  const targetAsset = tokenAsset(action.chain, action.token);
  return sourceAsset?.decimals === targetAsset?.decimals;
}

function sourceInventoryCoversTarget(action, source = null) {
  return shouldUseRawAmountCoverage(action, source)
    ? sourceInventoryCoversTargetAmount(action, source)
    : sourceInventoryCoversTargetValue(action, source);
}

function candidateRecord({
  action,
  method,
  source = null,
  availability,
  preferred,
  standbyFallback = false,
  requiresBootstrapNative = false,
  bootstrapNativeSatisfied = true,
  requiresReserveState = undefined,
  reserveReplenishmentKnown = undefined,
  partialRefill = false,
  partialRefillEstimatedUsd = null,
  missingInputs = [],
  settlementRequirements = [],
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
    standbyFallback,
    source,
    expectedExecutionRefillCostUsd,
    expectedReserveReplenishmentCostUsd:
      availability === "manual_only" || !resolvedReserveReplenishmentKnown ? null : 0,
    expectedLatencyMs: profile.expectedLatencyMs,
    requiresBootstrapNative,
    bootstrapNativeSatisfied,
    requiresReserveState: resolvedRequiresReserveState,
    manualFundingDependency: profile.manualFundingDependency,
    partialRefill,
    partialRefillEstimatedUsd: Number.isFinite(partialRefillEstimatedUsd) ? partialRefillEstimatedUsd : null,
    missingInputs,
    settlementRequirements,
    notes,
  };
}

function nativeSwapCandidate(action, plan, preferred) {
  const chainInventory = inventoryForChain(plan, action.chain);
  const native = chainInventory.native;
  const tokenSources = sortByEstimatedUsd(chainInventory.tokens.filter((item) => Number(item.actual || 0) > 0));
  const wrappedNativeToken = normalized(WRAPPED_NATIVE_TOKENS[action.chain]);
  const wrappedNativeSource = tokenSources.find((item) => normalized(item.token) === wrappedNativeToken && sourceInventoryCoversTargetValue(action, item));
  const tokenSource = wrappedNativeSource || tokenSources[0] || null;
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
  const coversTargetValue = sourceInventoryCoversTargetValue(action, tokenSource);
  const missingInputs = [];
  if (!bootstrapNativeSatisfied) {
    missingInputs.push("bootstrap_native_required");
    missingInputs.push("stranded_same_chain_token_inventory_without_native");
  }
  if (!coversTargetValue) {
    missingInputs.push("source_inventory_below_target_amount");
  }
  return candidateRecord({
    action,
    method: "same_chain_token_to_native_swap",
    source: describeSourceAsset(action.chain, tokenSource.token, sourceAmountMetadata(tokenSource)),
    availability: bootstrapNativeSatisfied && coversTargetValue ? "ready" : "conditional",
    preferred: bootstrapNativeSatisfied && coversTargetValue ? preferred : false,
    requiresBootstrapNative: true,
    bootstrapNativeSatisfied,
    missingInputs,
    notes: !coversTargetValue
      ? "Same-chain token inventory exists, but its observed value is below the refill target so cross-chain funding or a smaller target is still required."
      : bootstrapNativeSatisfied
      ? "Use same-chain token inventory to rebuild native gas when some bootstrap native gas still exists."
      : "Same-chain token inventory is already present but stranded because native gas is zero; first bootstrap native gas, then swap local tokens into the chain native asset.",
  });
}

function tokenSwapCandidate(action, plan, preferred) {
  const chainInventory = inventoryForChain(plan, action.chain);
  const native = chainInventory.native;
  const bootstrapNativeSatisfied = Number(native?.actualDecimal || 0) > 0;
  const coversTargetValue = sourceInventoryCoversTargetValue(action, native);
  return candidateRecord({
    action,
    method: "same_chain_native_to_token_swap",
    source: describeSourceAsset(action.chain, ZERO_TOKEN, sourceAmountMetadata(native)),
    availability: bootstrapNativeSatisfied && coversTargetValue ? "ready" : "conditional",
    preferred: bootstrapNativeSatisfied && coversTargetValue ? preferred : false,
    requiresBootstrapNative: true,
    bootstrapNativeSatisfied,
    missingInputs: [
      ...(bootstrapNativeSatisfied ? [] : ["bootstrap_native_required"]),
      ...(coversTargetValue ? [] : ["source_inventory_below_target_amount"]),
    ],
    notes: coversTargetValue
      ? "Use same-chain native balance to acquire the route token inventory."
      : "Same-chain native balance exists, but its observed value is below the refill target so cross-chain funding or a smaller target is still required.",
  });
}

function actionablePartialRefillUsd(action, source, policy) {
  const targetUsd = finite(action?.refillEstimatedUsd);
  const sourceUsd = finite(source?.estimatedUsd);
  if (!Number.isFinite(targetUsd) || !(targetUsd > 0) || !Number.isFinite(sourceUsd) || !(sourceUsd > 0)) {
    return null;
  }
  const minPartialUsd = Math.min(
    targetUsd,
    finite(action?.strategyPolicy?.minPartialRefillUsd) ??
      finite(policy?.capital?.canaryStartUsdMin) ??
      10,
  );
  const inputBuffer = 1.1;
  const partialUsd = Math.min(targetUsd, sourceUsd / inputBuffer);
  return partialUsd >= minPartialUsd ? partialUsd : null;
}

function tokenToTokenSwapCandidate(action, plan, policy, preferred) {
  const chainInventory = inventoryForChain(plan, action.chain);
  const native = chainInventory.native;
  const bootstrapNativeSatisfied = Number(native?.actualDecimal || 0) > 0;
  const dexSupported = dexProvidersForChain(action.chain).length > 0;
  const tokenSources = chainInventory.tokens
    .filter((item) => Number(item.actual || 0) > 0 && normalized(item.token) !== normalized(action.token))
    .sort((left, right) => {
      const leftCovers = sourceInventoryCoversTargetValue(action, left);
      const rightCovers = sourceInventoryCoversTargetValue(action, right);
      if (leftCovers !== rightCovers) return leftCovers ? -1 : 1;
      const leftPartial = actionablePartialRefillUsd(action, left, policy) ?? 0;
      const rightPartial = actionablePartialRefillUsd(action, right, policy) ?? 0;
      if (leftPartial !== rightPartial) return rightPartial - leftPartial;
      return (finite(right.estimatedUsd) ?? -1) - (finite(left.estimatedUsd) ?? -1);
    });
  const tokenSource = tokenSources[0] || null;
  if (!tokenSource) {
    return candidateRecord({
      action,
      method: "same_chain_token_to_token_swap",
      source: null,
      availability: "conditional",
      preferred: false,
      requiresBootstrapNative: true,
      bootstrapNativeSatisfied,
      missingInputs: [
        "same_chain_token_inventory_missing",
        ...(bootstrapNativeSatisfied ? [] : ["bootstrap_native_required"]),
      ],
      notes: "No same-chain non-target token inventory is available for a direct DEX refill into the target token.",
    });
  }
  const coversTargetValue = sourceInventoryCoversTargetValue(action, tokenSource);
  const partialRefillEstimatedUsd = coversTargetValue ? null : actionablePartialRefillUsd(action, tokenSource, policy);
  const actionable = coversTargetValue || Number.isFinite(partialRefillEstimatedUsd);
  const missingInputs = [
    ...(bootstrapNativeSatisfied ? [] : ["bootstrap_native_required"]),
    ...(dexSupported ? [] : ["same_chain_dex_executor_missing"]),
    ...(actionable ? [] : ["source_inventory_below_target_amount"]),
  ];
  const ready = bootstrapNativeSatisfied && dexSupported && actionable;
  return candidateRecord({
    action,
    method: "same_chain_token_to_token_swap",
    source: describeSourceAsset(action.chain, tokenSource.token, sourceAmountMetadata(tokenSource)),
    availability: ready ? "ready" : "conditional",
    preferred: ready ? preferred : false,
    requiresBootstrapNative: true,
    bootstrapNativeSatisfied,
    partialRefill: !coversTargetValue && Number.isFinite(partialRefillEstimatedUsd),
    partialRefillEstimatedUsd,
    missingInputs,
    notes: coversTargetValue
      ? "Use same-chain token inventory to acquire the target token inventory directly through the chain DEX executor."
      : actionable
        ? "Use source-limited same-chain token inventory for a deterministic partial refill large enough to unlock the next yield canary."
        : "Same-chain token inventory exists, but its observed value is below the actionable partial refill threshold.",
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
  if (routeContext.dstChain && routeContext.dstChain !== action.chain) return 5;
  if (source.chain === routeContext.srcChain && normalized(source.token) === normalized(routeContext.srcToken)) return 1;
  const sourceAsset = source.chain && source.token ? tokenAsset(source.chain, source.token) : null;
  const routeSourceAsset =
    routeContext.srcChain && routeContext.srcToken ? tokenAsset(routeContext.srcChain, routeContext.srcToken) : null;
  if (source.chain === routeContext.srcChain && sourceAsset?.family && sourceAsset.family === routeSourceAsset?.family) return 2;
  if (sourceAsset?.family && sourceAsset.family === routeSourceAsset?.family) return 3;
  if (source.chain === "bitcoin" && normalized(source.token) === normalized(ZERO_TOKEN)) return 4;
  if (source.sourceKind === "token") return 5;
  if (source.sourceKind === "native") return 6;
  return 5;
}

function preferredSourceRank(source, action = {}) {
  const hint = action?.sourceHint || null;
  if (!hint?.chain) return 2;
  if (source.chain !== hint.chain) return 2;
  if (hint.token && normalized(source.token) !== normalized(hint.token)) return 1;
  return 0;
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
      const hintDelta = preferredSourceRank(left, action) - preferredSourceRank(right, action);
      if (hintDelta !== 0) return hintDelta;
      const leftCoversTarget = sourceInventoryCoversTargetValue(action, left);
      const rightCoversTarget = sourceInventoryCoversTargetValue(action, right);
      if (leftCoversTarget !== rightCoversTarget) return leftCoversTarget ? -1 : 1;
      const leftSupport = crossChainExecutorSupport(action, left);
      const rightSupport = crossChainExecutorSupport(action, right);
      const leftSupportRank = !leftSupport.supported ? 2 : (leftSupport.intermediateSwapRequired ? 1 : 0);
      const rightSupportRank = !rightSupport.supported ? 2 : (rightSupport.intermediateSwapRequired ? 1 : 0);
      if (leftSupportRank !== rightSupportRank) return leftSupportRank - rightSupportRank;
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

  if (action.type === "refill_native") {
    const sourceAsset = tokenAsset(selectedSource.chain, selectedSource.token);
    if (isBtcLikeAsset(sourceAsset)) {
      return {
        supported: true,
        missingInputs: [],
        notes: "Gateway BTC-family transport can move wrapped BTC inventory into the destination chain while bundling destination native gas through gas-refill.",
      };
    }
    if (dexProvidersForChain(selectedSource.chain).length > 0) {
      return {
        supported: true,
        intermediateSwapRequired: true,
        missingInputs: [],
        notes: "Source token is not BTC-family but source chain has DEX liquidity; swap source token to wBTC.OFT then bridge via Gateway with gasRefill for destination native gas.",
      };
    }
  }

  if (action.type === "refill_token") {
    const sourceAsset = tokenAsset(selectedSource.chain, selectedSource.token);
    const targetAsset = tokenAsset(action.chain, action.token);
    const targetIsStablecoin = targetAsset?.family === "stablecoin" || isStablecoinTicker(action.ticker || targetAsset?.ticker);
    const destinationDexSupported = targetIsStablecoin && dexProvidersForChain(action.chain).length > 0;
    if (isBtcLikeAsset(sourceAsset) && isBtcLikeAsset(targetAsset)) {
      if (normalized(selectedSource.token) !== normalized(WBTC_OFT_TOKEN) && dexProvidersForChain(selectedSource.chain).length > 0) {
        return {
          supported: true,
          intermediateSwapRequired: true,
          missingInputs: [],
          notes: "Source token is BTC-family but not wBTC.OFT; swap it into wBTC.OFT on the source chain, then bridge through Gateway into the destination BTC-family inventory.",
        };
      }
      return {
        supported: true,
        missingInputs: [],
        notes: "Gateway BTC-family consolidation can bridge the observed source token into the target-chain token inventory.",
      };
    }
    if (isBtcLikeAsset(sourceAsset) && targetIsStablecoin) {
      if (!destinationDexSupported) {
        return {
          supported: false,
          missingInputs: ["destination_dex_executor_missing"],
          notes: "The wrapped-BTC source is sufficient, but the destination chain has no supported DEX executor to finish the stablecoin conversion when Gateway cannot quote the stable token directly.",
        };
      }
      return {
        supported: true,
        missingInputs: [],
        notes: "Gateway BTC-family transport can bridge observed wrapped-BTC inventory directly, and a destination-chain DEX swap can finish the stablecoin refill when the direct stable route is unavailable.",
      };
    }
    if (!isBtcLikeAsset(sourceAsset) && isBtcLikeAsset(targetAsset) && dexProvidersForChain(selectedSource.chain).length > 0) {
      return {
        supported: true,
        intermediateSwapRequired: true,
        missingInputs: [],
        notes: "Source token is not BTC-family but target is; swap source token to wBTC.OFT on source chain then bridge via Gateway consolidation.",
      };
    }
    if (!isBtcLikeAsset(sourceAsset) && targetIsStablecoin && dexProvidersForChain(selectedSource.chain).length > 0) {
      if (!destinationDexSupported) {
        return {
          supported: false,
          missingInputs: ["destination_dex_executor_missing"],
          notes: "The source chain can swap into wrapped BTC, but the destination chain has no supported DEX executor to finish the stablecoin conversion when Gateway cannot quote the stable token directly.",
        };
      }
      return {
        supported: true,
        intermediateSwapRequired: true,
        missingInputs: [],
        notes: "Source token is not BTC-family; swap it to wBTC.OFT on the source chain, then use Gateway to request target-chain stablecoin inventory.",
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

function crossChainCandidate(action, plan, policy, routeContext = null, gatewayAvailability = null) {
  const selectedSource = selectCrossChainSource(action, plan, routeContext);
  const directInventoryMode = policy.walletMode === "single_wallet";
  const gatewayAvailable = gatewayAvailability?.available !== false;
  const executorSupport = crossChainExecutorSupport(action, selectedSource);
  const method = executorSupport.intermediateSwapRequired
    ? "cross_chain_swap_via_btc_intermediate"
    : "cross_chain_bridge_or_swap";
  if (!gatewayAvailable && isGatewayMethod(method)) {
    return candidateRecord({
      action,
      method,
      source: selectedSource
        ? describeSourceAsset(selectedSource.chain, selectedSource.token, sourceAmountMetadata(selectedSource))
        : null,
      availability: "manual_only",
      preferred: false,
      missingInputs: [gatewayAvailability?.reason || "gateway_operator_paused"],
      notes:
        "BOB Gateway is currently disabled (committed flag or runtime state file). Gateway-backed cross-chain methods are not selectable until the pause clears. Route through an alternate bridge provider or manual funding instead.",
    });
  }
  const coversTarget = sourceInventoryCoversTarget(action, selectedSource);
  if (!selectedSource) {
    return candidateRecord({
      action,
      method,
      source: null,
      availability: "conditional",
      preferred: false,
      requiresReserveState: false,
      reserveReplenishmentKnown: true,
      missingInputs: executorSupport.missingInputs,
      notes: executorSupport.notes,
    });
  }
  const executableDirectInventory = directInventoryMode && executorSupport.supported && coversTarget;
  // For gas-float-keeper–originated native refills, the purpose-built
  // lane is Gas.Zip. Even when cross-chain BTC-intermediate would work,
  // it must not pre-empt the gas-zip candidate via preferred=true. Let
  // the gas-zip candidate claim preferred itself when accepted.
  const isGasFloatOrigin = action?.origin === "gas_float_keeper";
  const suppressPreference = isGasFloatOrigin && action.type === "refill_native";
  return candidateRecord({
    action,
    method,
    source: describeSourceAsset(selectedSource.chain, selectedSource.token, {
      actual: selectedSource.actual,
      estimatedUsd: selectedSource.estimatedUsd,
      actualDecimal: selectedSource.actualDecimal,
      sourceKind: selectedSource.sourceKind,
    }),
    availability: executableDirectInventory
      ? (suppressPreference ? "conditional" : "ready")
      : "conditional",
    preferred: executableDirectInventory && !suppressPreference,
    requiresReserveState: !directInventoryMode,
    reserveReplenishmentKnown: directInventoryMode,
    missingInputs: directInventoryMode
      ? [
          ...executorSupport.missingInputs,
          ...(coversTarget ? [] : ["source_inventory_below_target_amount"]),
        ]
      : ["reserve_state_unmodelled"],
    notes: executableDirectInventory
      ? executorSupport.notes
      : directInventoryMode
        ? coversTarget
          ? executorSupport.notes
          : "Cross-chain source inventory is observed, but the selected source cannot cover the refill target amount yet."
      : "Cross-chain funding source is selected from observed inventory, but reserve replenishment and route execution remain under-modelled.",
  });
}

function selectGasZipSource(action, plan, policy) {
  const vendorPolicy = policy?.gasZipPolicy || GAS_ZIP_DEFAULT_POLICY;
  return sortByEstimatedUsd(
    (plan.inventory?.native || []).filter((item) =>
      item.chain &&
      item.chain !== action.chain &&
      Number(item.actual || 0) > 0 &&
      gasZipInboundChain(item.chain, vendorPolicy),
    ),
  )[0] || null;
}

function gasRefuelCandidate(action, plan, policy) {
  const vendorPolicy = policy?.gasZipPolicy || GAS_ZIP_DEFAULT_POLICY;
  const verdict = gasZipAcceptsAction(action, vendorPolicy);
  if (!verdict.accepted) {
    return candidateRecord({
      action,
      method: "gas_refuel_bridge_gas_zip",
      source: null,
      availability: "manual_only",
      preferred: false,
      missingInputs: [verdict.reason],
      notes:
        "Gas.Zip fallback rejected this action. Per committed policy it is gas-only and per-job capped; strategy capital must not use this lane.",
    });
  }
  const source = selectGasZipSource(action, plan, policy);
  if (!source) {
    return candidateRecord({
      action,
      method: "gas_refuel_bridge_gas_zip",
      source: null,
      availability: "conditional",
      preferred: false,
      missingInputs: ["gas_zip_source_native_inventory_missing"],
      notes:
        "Gas.Zip gas-only refuel is policy-allowed, but no supported source-chain native inventory is currently available to fund the deposit.",
    });
  }
  // Gas-float top-ups are the purpose-built lane for Gas.Zip. When the
  // action was emitted by the gas-float keeper and Gas.Zip policy accepts
  // it with a viable source, it is the preferred/ready executor. Using a
  // heavier cross-chain BTC-intermediate path for a few USD of gas would
  // waste bridge fees on every refill.
  const isGasFloatOrigin = action?.origin === "gas_float_keeper";
  return candidateRecord({
    action,
    method: "gas_refuel_bridge_gas_zip",
    source: describeSourceAsset(source.chain, ZERO_TOKEN, sourceAmountMetadata(source)),
    availability: isGasFloatOrigin ? "ready" : "conditional",
    preferred: isGasFloatOrigin,
    requiresBootstrapNative: false,
    bootstrapNativeSatisfied: true,
    settlementRequirements: ["gas_zip_destination_native_delta_proof_required"],
    notes:
      "Gas.Zip gas-only refuel. Settlement requires destination-chain native balance delta proof before the job is accepted as successful.",
  });
}

function alternateBridgeCandidates(action, plan, { gatewayAvailable, routeContext = null } = {}) {
  // Gateway remains the preferred first-choice lane, but live non-Gateway
  // providers stay in the candidate list so autopilot can retry them when
  // the selected Gateway path returns `no_route`, `routing_unavailable`, or
  // an execution-time failure. When Gateway is healthy, these remain standby
  // fallbacks rather than displacing the initial Gateway selection.
  if (action?.type !== "refill_token" && action?.type !== "refill_native") return [];
  const selectedSource = selectCrossChainSource(action, plan, routeContext);
  if (!selectedSource) return [];
  const targetAsset = action.type === "refill_token"
    ? tokenAsset(action.chain, action.token)
    : null;
  const targetTicker = String(action.ticker || targetAsset?.ticker || "").toLowerCase();
  const rawFamily = targetTicker === "usdc" || targetTicker === "usdt" || targetTicker === "dai"
    ? "stablecoin"
    : targetAsset?.family || null;
  const assetFamily = rawFamily
    ? (rawFamily === "wrapped_btc" || rawFamily === "native_btc" ? "btc"
      : rawFamily === "usd" || rawFamily === "stablecoin" ? "stable"
      : rawFamily)
    : null;
  const fallbackProviders = fallbackProvidersWhenGatewayPaused({
    srcChain: selectedSource.chain,
    dstChain: action.chain,
    assetFamily,
  }).sort((left, right) => {
    const order = new Map([
      ["across", 0],
      ["lifi", 1],
      ["stargate", 2],
    ]);
    return (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99);
  });
  if (fallbackProviders.length === 0) return [];
  const standbyFallback = gatewayAvailable !== false;
  return fallbackProviders.map((provider) => {
    const method = provider.methodIds[0];
    const isLive = provider.status === "live";
    const missingInputs = isLive
      ? []
      : [`bridge_provider_executor_missing:${provider.id}`];
    const coversTarget = sourceInventoryCoversTarget(action, selectedSource);
    if (!coversTarget) missingInputs.push("source_inventory_below_target_amount");
    // For Across specifically, also check the token/chain pair matches
    // the committed registry — otherwise the quote call would fail at
    // runtime with `pair unsupported`. If unsupported, demote to
    // conditional with an explicit missing input rather than emitting
    // a candidate the executor cannot honour.
    if (provider.id === "across" && action.type === "refill_token") {
      const ticker = String(action.ticker || "").toLowerCase();
      if (!acrossSupportsPair({ srcChain: selectedSource.chain, dstChain: action.chain, ticker })) {
        missingInputs.push("across_pair_unsupported");
      }
    }
    const ready = !standbyFallback && isLive && coversTarget && missingInputs.length === 0;
    const availability = ready ? "ready" : "conditional";
    return candidateRecord({
      action,
      method,
      source: describeSourceAsset(selectedSource.chain, selectedSource.token, sourceAmountMetadata(selectedSource)),
      availability,
      preferred: false,
      standbyFallback,
      requiresReserveState: false,
      reserveReplenishmentKnown: true,
      missingInputs,
      notes: isLive
        ? standbyFallback
          ? `Standby Gateway fallback via ${provider.label} (live executor retained for automatic retry).`
          : `Gateway fallback via ${provider.label} (live executor).`
        : `Gateway fallback via ${provider.label}; catalog entry only — executor helper is a design scaffold and must be implemented before auto-selection.`,
    });
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
  if (
    [...missingInputs].every(
      (item) => item === "bootstrap_native_required" || item === "stranded_same_chain_token_inventory_without_native",
    )
  ) {
    return 1;
  }
  if (missingInputs.has("reserve_state_unmodelled")) return 2;
  if (
    missingInputs.has("cross_chain_source_selection_missing") ||
    [...missingInputs].some((item) => item.endsWith("_executor_missing"))
  ) {
    return 3;
  }
  if (missingInputs.has("same_chain_token_inventory_missing")) return 6;
  if (candidate.method === "gas_refuel_bridge_gas_zip") return 5;
  return 5;
}

function chooseCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
    if (Boolean(left.standbyFallback) !== Boolean(right.standbyFallback)) return left.standbyFallback ? 1 : -1;
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

export function buildFundingSourceCandidates(action, plan, policy, routeContext = null, gatewayAvailability = null) {
  const candidates = [];
  const gatewayAvailable = gatewayAvailability?.available !== false;
  const sourcePinned = Boolean(action?.sourceHint?.chain);
  if (policy.walletMode === "dual_wallet") {
    candidates.push(reserveTransferCandidate(action, true));
  }

  if (policy.refillPolicy.enableDexRefill && !sourcePinned) {
    if (action.type === "refill_native") {
      candidates.push(nativeSwapCandidate(action, plan, policy.walletMode !== "dual_wallet"));
    } else if (action.type === "refill_token") {
      candidates.push(tokenToTokenSwapCandidate(action, plan, policy, policy.walletMode !== "dual_wallet"));
      candidates.push(tokenSwapCandidate(action, plan, policy.walletMode !== "dual_wallet"));
    }
  }

  if (policy.refillPolicy.enableCrossChainRefill) {
    candidates.push(crossChainCandidate(action, plan, policy, routeContext, gatewayAvailability));
    candidates.push(...alternateBridgeCandidates(action, plan, { gatewayAvailable, routeContext }));
  }

  if (policy.refillPolicy.enableGasRefuelFallback && action.type === "refill_native") {
    candidates.push(gasRefuelCandidate(action, plan, policy));
  }

  candidates.push(manualFundingCandidate(action));
  return candidates;
}

export function buildFundingSourcePlan({
  plan,
  policy,
  routeContext = null,
  supplementalInventory = null,
  gatewayAvailability = null,
}) {
  const resolvedPlan = {
    ...plan,
    inventory: mergeObservedInventory(plan?.inventory || null, supplementalInventory),
  };
  const selections = (resolvedPlan.actions || []).map((action) => {
    const candidates = buildFundingSourceCandidates(action, resolvedPlan, policy, routeContext, gatewayAvailability);
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
      settlementRequirements: selected.settlementRequirements,
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
  if (gatewayAvailability && gatewayAvailability.available === false) {
    reasons.push(gatewayAvailability.reason || "gateway_operator_paused");
  }

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
    gatewayAvailability: gatewayAvailability
      ? {
          available: gatewayAvailability.available === true,
          reason: gatewayAvailability.reason || null,
          stateFile: gatewayAvailability.stateFile || null,
          observedAt: gatewayAvailability.observedAt || null,
        }
      : null,
    selections,
    summary: {
      ...summary,
      economicallyJustified,
      effectiveSystemNetPnlUsd,
    },
  };
}

export { resourceKeyForRefillAction };
