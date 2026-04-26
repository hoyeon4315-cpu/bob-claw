import { listStrategyCaps } from "../../config/strategy-caps.mjs";
import { DIVERSIFICATION_POLICY } from "../../config/diversification.mjs";

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function scoreWeight(item) {
  const score = Number(item?.score);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

function resolveStrategyCap({ item, strategyCaps }) {
  if (!item?.chain) return null;
  if (item.strategyId) {
    const direct = strategyCaps.find((s) => s.strategyId === item.strategyId);
    if (direct) return direct;
  }
  const familyId = item.familyId || null;
  const matching = strategyCaps.filter((s) => {
    if (s.autoExecute !== true) return false;
    if (!finitePositive(s.caps?.perChainUsd?.[item.chain])) return false;
    if (familyId && s.familyId && s.familyId !== familyId) return false;
    return true;
  });
  if (matching.length === 1) return matching[0];
  return null;
}

function strategyChainCapUsd(item, strategyCaps) {
  if (!item?.chain) return null;
  const direct = resolveStrategyCap({ item, strategyCaps });
  if (!direct) return null;
  return finitePositive(direct.caps?.perChainUsd?.[item.chain]);
}

function isAllocationReady(item) {
  if (item?.gate?.status !== "promotable") return false;
  return (item?.allocationGate?.status || "allocation_ready") === "allocation_ready";
}

export function buildScoredTargetBalances({
  promotionGate = null,
  economics = null,
  strategyCaps = listStrategyCaps(),
  totalCapitalUsd = 0,
  diversificationPolicy = DIVERSIFICATION_POLICY,
  now = new Date().toISOString(),
} = {}) {
  const total = finitePositive(totalCapitalUsd);
  const items = (promotionGate?.items || []).filter(isAllocationReady);
  const economicsByTemplate = new Map();
  for (const entry of economics?.items || []) {
    if (entry?.templateId) economicsByTemplate.set(entry.templateId, entry);
  }

  if (!total || !items.length) {
    return {
      schemaVersion: 1,
      observedAt: now,
      totalCapitalUsd: total ?? 0,
      perStrategy: [],
      perChain: [],
      summary: {
        chainCount: 0,
        strategyCount: 0,
        totalAllocationUsd: 0,
      },
    };
  }

  const totalWeight = items.reduce((sum, item) => sum + scoreWeight(item), 0);
  const perStrategyMaxShare = Number(diversificationPolicy?.perStrategyMaxShare);
  const perStrategyCapUsd = Number.isFinite(perStrategyMaxShare) && perStrategyMaxShare > 0
    ? perStrategyMaxShare * total
    : null;
  const perStrategy = [];
  for (const item of items) {
    const weight = scoreWeight(item);
    const weightShare = totalWeight > 0
      ? (weight / totalWeight) * total
      : total / items.length;
    const cap = strategyChainCapUsd(item, strategyCaps);
    let allocationUsd = cap !== null ? Math.min(weightShare, cap) : weightShare;
    if (perStrategyCapUsd !== null) allocationUsd = Math.min(allocationUsd, perStrategyCapUsd);
    if (!(allocationUsd > 0)) continue;
    const economicsEntry = economicsByTemplate.get(item.templateId) || null;
    perStrategy.push({
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId || null,
      strategyId: item.strategyId || null,
      label: item.label || null,
      score: weight,
      weightShareUsd: weightShare,
      capUsd: cap,
      allocationUsd,
      economicsKnown: economicsEntry !== null,
    });
  }

  const perChainMaxShare = Number(diversificationPolicy?.perChainMaxShare);
  const perChainCapUsd = Number.isFinite(perChainMaxShare) && perChainMaxShare > 0
    ? perChainMaxShare * total
    : null;
  if (perChainCapUsd !== null) {
    const sumByChain = new Map();
    for (const entry of perStrategy) {
      sumByChain.set(entry.chain, (sumByChain.get(entry.chain) || 0) + entry.allocationUsd);
    }
    for (const [chain, sum] of sumByChain.entries()) {
      if (sum <= perChainCapUsd) continue;
      const scale = perChainCapUsd / sum;
      for (const entry of perStrategy) {
        if (entry.chain === chain) entry.allocationUsd *= scale;
      }
    }
  }

  const perChainMap = new Map();
  for (const entry of perStrategy) {
    const existing = perChainMap.get(entry.chain) || {
      chain: entry.chain,
      strategyIds: [],
      templateIds: [],
      settlementTargetUsd: 0,
    };
    existing.settlementTargetUsd += entry.allocationUsd;
    if (entry.strategyId && !existing.strategyIds.includes(entry.strategyId)) {
      existing.strategyIds.push(entry.strategyId);
    }
    if (entry.templateId && !existing.templateIds.includes(entry.templateId)) {
      existing.templateIds.push(entry.templateId);
    }
    perChainMap.set(entry.chain, existing);
  }

  const perChain = [...perChainMap.values()].sort((a, b) => a.chain.localeCompare(b.chain));
  const totalAllocationUsd = perStrategy.reduce((sum, entry) => sum + entry.allocationUsd, 0);

  return {
    schemaVersion: 1,
    observedAt: now,
    totalCapitalUsd: total,
    perStrategy,
    perChain,
    summary: {
      chainCount: perChain.length,
      strategyCount: perStrategy.length,
      totalAllocationUsd,
    },
  };
}
