import { listStrategyCaps } from "../../config/strategy-caps.mjs";
import { DIVERSIFICATION_POLICY } from "../../config/diversification.mjs";

const DEFAULT_REVIEW_ONLY_WEIGHT_FACTOR = 0.3;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rawScore(item) {
  const score = Number(item?.score);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

function gateFactor(item, reviewOnlyFactor) {
  const status = item?.allocationGate?.status || "allocation_ready";
  if (status === "allocation_ready") return 1;
  if (status === "review_only") return reviewOnlyFactor;
  return 0;
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
  const direct = resolveStrategyCap({ item, strategyCaps });
  if (!direct) return null;
  return finitePositive(direct.caps?.perChainUsd?.[item.chain]);
}

function isPromotableCandidate(item) {
  if (item?.gate?.status !== "promotable") return false;
  const status = item?.allocationGate?.status || "allocation_ready";
  return status === "allocation_ready" || status === "review_only";
}

// Iterative water-fill: allocate proportional to weight, clipped by per-item
// and per-strategy caps. Residual (capped overflow) gets redistributed to
// uncapped items in the next pass. Converges in <=N iterations.
function waterFillAllocate({ entries, total, perStrategyCapUsd }) {
  const n = entries.length;
  const allocations = new Array(n).fill(0);
  if (n === 0 || !(total > 0)) return allocations;

  const itemCap = entries.map((e) => {
    const caps = [];
    if (Number.isFinite(e.perItemCapUsd) && e.perItemCapUsd > 0) caps.push(e.perItemCapUsd);
    if (Number.isFinite(perStrategyCapUsd) && perStrategyCapUsd > 0) caps.push(perStrategyCapUsd);
    return caps.length ? Math.min(...caps) : Infinity;
  });

  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
  if (!(totalWeight > 0)) {
    const equal = total / n;
    for (let i = 0; i < n; i += 1) allocations[i] = Math.min(equal, itemCap[i]);
    return allocations;
  }

  let remaining = total;
  const active = new Set(entries.map((_, i) => i));
  for (let iter = 0; iter < 16 && remaining > 1e-6 && active.size > 0; iter += 1) {
    let activeWeight = 0;
    for (const i of active) activeWeight += entries[i].weight;
    if (!(activeWeight > 0)) break;
    let consumed = 0;
    const filled = [];
    for (const i of active) {
      const want = (entries[i].weight / activeWeight) * remaining;
      const headroom = itemCap[i] - allocations[i];
      const give = Math.min(want, headroom);
      allocations[i] += give;
      consumed += give;
      if (allocations[i] >= itemCap[i] - 1e-9) filled.push(i);
    }
    for (const i of filled) active.delete(i);
    remaining -= consumed;
    if (consumed < 1e-9) break;
  }
  return allocations;
}

export function buildScoredTargetBalances({
  promotionGate = null,
  economics = null,
  strategyCaps = listStrategyCaps(),
  totalCapitalUsd = 0,
  diversificationPolicy = DIVERSIFICATION_POLICY,
  reviewOnlyWeightFactor = DEFAULT_REVIEW_ONLY_WEIGHT_FACTOR,
  now = new Date().toISOString(),
} = {}) {
  const total = finitePositive(totalCapitalUsd);
  const items = (promotionGate?.items || []).filter(isPromotableCandidate);
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
      summary: { chainCount: 0, strategyCount: 0, totalAllocationUsd: 0 },
    };
  }

  const perStrategyMaxShare = Number(diversificationPolicy?.perStrategyMaxShare);
  const perStrategyCapUsd =
    Number.isFinite(perStrategyMaxShare) && perStrategyMaxShare > 0
      ? perStrategyMaxShare * total
      : null;

  const entries = items.map((item) => {
    const cap = strategyChainCapUsd(item, strategyCaps);
    const gateFactorValue = gateFactor(item, reviewOnlyWeightFactor);
    const score = rawScore(item);
    return {
      item,
      weight: score * gateFactorValue,
      perItemCapUsd: cap,
      score,
      gateFactor: gateFactorValue,
    };
  });

  const allocations = waterFillAllocate({
    entries,
    total,
    perStrategyCapUsd,
  });

  // Per-chain cap: scale down chains over share, do NOT redistribute (keep
  // residual as BTC reserve — perChainMaxShare is a hard safety ceiling).
  const perChainMaxShare = Number(diversificationPolicy?.perChainMaxShare);
  const perChainCapUsd =
    Number.isFinite(perChainMaxShare) && perChainMaxShare > 0 ? perChainMaxShare * total : null;
  if (perChainCapUsd !== null) {
    const sumByChain = new Map();
    entries.forEach((e, i) => {
      sumByChain.set(e.item.chain, (sumByChain.get(e.item.chain) || 0) + allocations[i]);
    });
    for (const [chain, sum] of sumByChain.entries()) {
      if (sum <= perChainCapUsd) continue;
      const scale = perChainCapUsd / sum;
      entries.forEach((e, i) => {
        if (e.item.chain === chain) allocations[i] *= scale;
      });
    }
  }

  const perStrategy = [];
  entries.forEach((entry, i) => {
    const allocation = allocations[i];
    if (!(allocation > 0)) return;
    const item = entry.item;
    const economicsEntry = economicsByTemplate.get(item.templateId) || null;
    perStrategy.push({
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId || null,
      strategyId: item.strategyId || null,
      label: item.label || null,
      score: entry.score,
      gateFactor: entry.gateFactor,
      weight: entry.weight,
      capUsd: entry.perItemCapUsd,
      allocationUsd: allocation,
      allocationGateStatus: item.allocationGate?.status || "allocation_ready",
      economicsKnown: economicsEntry !== null,
    });
  });

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
      reviewOnlyWeightFactor,
    },
  };
}
