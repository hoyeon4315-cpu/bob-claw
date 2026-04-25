import { ANNOUNCED_GATEWAY_CHAINS } from "../chains/gateway-announced.mjs";

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function countBy(items = [], selector = () => "unknown") {
  const counts = {};
  for (const item of items || []) {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sumBy(items = [], selector = () => 0) {
  return (items || []).reduce((sum, item) => sum + finite(selector(item)), 0);
}

function unique(items = []) {
  return [...new Set((items || []).filter(Boolean))];
}

function statusDecision(status) {
  if (status === "candidate_for_validation") return "deploy_after_policy";
  if (status === "measured_below_policy" || status === "blocked_by_policy") return "no_trade";
  if (status === "thin_coverage" || status === "unobserved") return "measure_first";
  return "analysis_only";
}

function flattenCatalog(catalog = {}) {
  return [
    ...(catalog.btcFamilies || []),
    ...(catalog.ethBranches || []),
  ].map((entry) => ({
    id: entry.id || entry.label,
    label: entry.label,
    status: entry.status,
    decision: statusDecision(entry.status),
    reason: entry.reason || null,
    bestRoute: entry.evidence?.bestRoute || entry.evidence?.revalidatedRouteKey || null,
    bestNetPct: entry.evidence?.bestNetPct ?? null,
    netPnlMeasuredUsd: entry.evidence?.netPnlMeasuredUsd ?? null,
    sampleCount: entry.evidence?.sampleCount ?? entry.evidence?.latestSampleCount ?? null,
  }));
}

function inventoryByChain(inventory = {}) {
  const chains = new Map();
  for (const item of inventory.native || []) {
    if (!chains.has(item.chain)) chains.set(item.chain, { nativeUsd: 0, tokenUsd: 0, statuses: [] });
    const row = chains.get(item.chain);
    row.nativeUsd += finite(item.estimatedUsd);
    row.statuses.push(item.status);
  }
  for (const item of inventory.tokens || []) {
    if (!chains.has(item.chain)) chains.set(item.chain, { nativeUsd: 0, tokenUsd: 0, statuses: [] });
    const row = chains.get(item.chain);
    row.tokenUsd += finite(item.estimatedUsd);
    row.statuses.push(item.status);
  }
  return chains;
}

function topBlockers(allocations = [], chain) {
  const blockers = [];
  for (const item of allocations || []) {
    if (item.queueItem?.chain !== chain) continue;
    blockers.push(...(item.blockers || []));
    blockers.push(...(item.sizing?.blockers || []));
  }
  return Object.entries(countBy(blockers, (item) => item))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([blocker, count]) => ({ blocker, count }));
}

function chainDecision({ activeUsd, entryReadyCount, queueCount, capitalJobCount, blockerCounts, inventory }) {
  if (entryReadyCount > 0) return "deploy_now";
  if (activeUsd > 0) return "active";
  const blockers = new Set(blockerCounts.map((item) => item.blocker));
  if (capitalJobCount > 0 || blockers.has("inventory_missing") || blockers.has("matched_token_missing")) {
    return "refill_required";
  }
  if (blockers.has("hold_executor_missing") || blockers.has("unsupported_binding_kind")) return "executor_required";
  if (blockers.has("strategy_per_chain_cap_exceeded") || blockers.has("strategy_per_day_cap_exceeded")) return "cap_limited";
  if (blockers.has("cap_too_low_for_ethereum_gas_efficiency")) return "too_small_after_gas";
  if (queueCount > 0) return "not_ready";
  if ((inventory?.nativeUsd || 0) > 0 || (inventory?.tokenUsd || 0) > 0) return "inventory_observed_no_strategy";
  return "no_current_strategy";
}

function rankDecision(decision) {
  return {
    deploy_now: 1,
    active: 2,
    refill_required: 3,
    cap_limited: 4,
    too_small_after_gas: 5,
    executor_required: 6,
    not_ready: 7,
    inventory_observed_no_strategy: 8,
    no_current_strategy: 9,
  }[decision] || 99;
}

export function buildLiveDeploymentPriorities({
  strategyCatalog = {},
  merklAllocationPlan = {},
  refillJobs = {},
  inventory = {},
  observedAt = new Date().toISOString(),
} = {}) {
  const plan = merklAllocationPlan.plan || merklAllocationPlan;
  const activePositions = plan.activePositions || [];
  const entryQueue = plan.entryQueue || [];
  const allocations = plan.allocations || [];
  const capitalJobs = plan.capitalJobs || [];
  const queueItems = allocations.map((item) => item.queueItem).filter(Boolean);
  const invByChain = inventoryByChain(inventory);
  const officialDestinationChains = ANNOUNCED_GATEWAY_CHAINS.filter((chain) => chain !== "bitcoin");

  const activeByChain = countBy(activePositions, (item) => item.chain);
  const activeUsdByChain = {};
  for (const chain of officialDestinationChains) {
    activeUsdByChain[chain] = sumBy(activePositions.filter((item) => item.chain === chain), (item) => item.amountUsd);
  }
  const queueByChain = countBy(queueItems, (item) => item.chain);
  const entryReadyByChain = countBy(entryQueue.map((item) => item.queueItem), (item) => item.chain);
  const capitalJobsByChain = countBy(capitalJobs, (item) => item.chain);

  const chainPriorities = officialDestinationChains.map((chain) => {
    const blockerCounts = topBlockers(allocations, chain);
    const inventoryRow = invByChain.get(chain) || { nativeUsd: 0, tokenUsd: 0, statuses: [] };
    const decision = chainDecision({
      activeUsd: activeUsdByChain[chain] || 0,
      entryReadyCount: entryReadyByChain[chain] || 0,
      queueCount: queueByChain[chain] || 0,
      capitalJobCount: capitalJobsByChain[chain] || 0,
      blockerCounts,
      inventory: inventoryRow,
    });
    return {
      chain,
      decision,
      activePositionCount: activeByChain[chain] || 0,
      activeUsd: activeUsdByChain[chain] || 0,
      queueCount: queueByChain[chain] || 0,
      entryReadyCount: entryReadyByChain[chain] || 0,
      capitalJobCount: capitalJobsByChain[chain] || 0,
      inventoryUsd: Math.round((inventoryRow.nativeUsd + inventoryRow.tokenUsd) * 1e6) / 1e6,
      inventoryStatuses: unique(inventoryRow.statuses),
      topBlockers: blockerCounts,
    };
  }).sort((left, right) =>
    rankDecision(left.decision) - rankDecision(right.decision) ||
    right.activeUsd - left.activeUsd ||
    right.queueCount - left.queueCount ||
    left.chain.localeCompare(right.chain));

  const catalogEntries = flattenCatalog(strategyCatalog);
  const activeProtocolUsd = plan.summary?.activeProtocolUsd || {};
  const activeChainUsd = plan.summary?.activeChainUsd || {};
  const activeUsd = finite(plan.summary?.activePositionUsd);
  const estimatedWalletUsd = finite(inventory.summary?.estimatedWalletUsd);
  const estimatedWalletBtc = estimatedWalletUsd > 0 ? estimatedWalletUsd / finite(inventory.tokens?.[0]?.priceUsd, 77645) : 0;

  return {
    schemaVersion: 1,
    observedAt,
    objective: "allocate_real_capital_to_policy_allowed_highest_evidence_strategies",
    summary: {
      activeUsd,
      estimatedWalletUsd,
      estimatedWalletBtc,
      openPositionCount: activePositions.length,
      entryReadyCount: entryQueue.length,
      refillJobCount: refillJobs.summary?.jobCount || 0,
      autoQueuedRefillCount: refillJobs.summary?.autoQueuedJobCount || 0,
      noTradeStrategyCount: catalogEntries.filter((item) => item.decision === "no_trade").length,
      measureFirstStrategyCount: catalogEntries.filter((item) => item.decision === "measure_first").length,
    },
    activeBook: {
      byChainUsd: activeChainUsd,
      byProtocolUsd: activeProtocolUsd,
      positions: activePositions.map((item) => ({
        opportunityId: item.opportunityId,
        chain: item.chain,
        protocolId: item.protocolId,
        amountUsd: item.amountUsd,
        entryTxHash: item.entryTxHash,
      })),
    },
    chainPriorities,
    strategyDecisions: catalogEntries,
    merklDeployment: {
      status: merklAllocationPlan.status || (entryQueue.length ? "preview_ready" : "blocked"),
      blockedReason: merklAllocationPlan.blockedReason || null,
      topDeployNow: entryQueue.slice(0, 8).map((item) => ({
        opportunityId: item.queueItem?.opportunityId,
        chain: item.queueItem?.chain,
        protocolId: item.queueItem?.protocolId,
        name: item.queueItem?.name,
        targetUsd: item.targetUsd,
        score: item.score,
      })),
      topBlocked: allocations
        .filter((item) => item.status === "blocked")
        .slice(0, 12)
        .map((item) => ({
          opportunityId: item.queueItem?.opportunityId,
          chain: item.queueItem?.chain,
          protocolId: item.queueItem?.protocolId,
          name: item.queueItem?.name,
          score: item.score,
          blockers: item.blockers || [],
          sizingBlockers: item.sizing?.blockers || [],
        })),
    },
  };
}
