// Score-weighted target balances.
//
// AGENTS.md: "There is no manual promotion step and no tiered phase gate.
// A strategy runs the moment its config declares autoExecute: true with valid
// caps committed to the repo." So the candidate set for capital deployment is
// every (autoExecute strategy × perChainUsd chain) pair, NOT the
// allowlist/evidence-gated promotion-gate items.
//
// Promotion-gate items are still consulted as a *score source* (each
// (chain, familyId) pair carries a destination score). Lookup uses explicit
// strategy/family ids first, then exposure-derived score families for
// non-infra strategies. When no score is available, fall back to a minWeight
// floor.
//
// Allocation algorithm:
//   1. Build candidates = strategyCaps where autoExecute=true × perChainUsd > 0.
//   2. Weight = score × gateFactor (review_only/blocked/missing → reducedFactor).
//   3. Iterative water-fill: distribute total proportional to weight, clip to
//      per-item cap and per-strategy diversification cap, redistribute leftover.
//   4. Per-chain max share is a hard ceiling (no redistribution beyond it).

import { listStrategyCaps } from "../../config/strategy-caps.mjs";
import { DIVERSIFICATION_POLICY } from "../../config/diversification.mjs";
import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../all-chain-autopilot.mjs";

const DEFAULT_REDUCED_WEIGHT_FACTOR = 0.3;
const DEFAULT_MIN_WEIGHT = 0.1;
const DEFAULT_ALLOWED_CHAINS = new Set(OFFICIAL_GATEWAY_DESTINATION_CHAINS);
const INFRA_SCORE_FALLBACK_STRATEGY_IDS = new Set([
  "gateway-btc-funding-transfer",
  "gateway-btc-onramp",
  "gateway-btc-offramp",
  "gas-zip-native-refuel",
  "across-bridge",
  "lifi-bridge",
  "native-dex-experiment",
  "prelive_fork_execution",
]);

const SCORE_FAMILY_IDS_BY_ASSET_FAMILY = Object.freeze({
  stablecoin: Object.freeze(["stablecoin_lending_carry", "stablecoin_lp_or_basis"]),
  btc_wrappers: Object.freeze([
    "wrapped_btc_destination_yield",
    "wrapped_btc_lending",
    "wrapped_btc_lp_positions",
  ]),
  eth_like_yield: Object.freeze(["eth_destination_deployment"]),
  reserve: Object.freeze(["custom_destination_actions"]),
  mixed_assets: Object.freeze(["custom_destination_actions"]),
  multi_asset: Object.freeze(["custom_destination_actions"]),
  multi_asset_yield: Object.freeze(["custom_destination_actions"]),
  proxy: Object.freeze(["custom_destination_actions"]),
});

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildPromotionScoreIndex(promotionGate) {
  const byTemplateId = new Map();
  const byChainFamily = new Map();
  const byChainStrategy = new Map();
  for (const item of promotionGate?.items || []) {
    if (item?.templateId) byTemplateId.set(item.templateId, item);
    if (item?.chain && item?.familyId) {
      byChainFamily.set(`${item.chain}:${item.familyId}`, item);
    }
    if (item?.chain && item?.strategyId) {
      byChainStrategy.set(`${item.chain}:${item.strategyId}`, item);
    }
  }
  return { byTemplateId, byChainFamily, byChainStrategy };
}

function scoreLookupIds(strategy) {
  const explicit = Array.isArray(strategy.scoreFamilyIds) ? strategy.scoreFamilyIds : [];
  const inferred = INFRA_SCORE_FALLBACK_STRATEGY_IDS.has(strategy.strategyId)
    ? []
    : SCORE_FAMILY_IDS_BY_ASSET_FAMILY[strategy.exposure?.assetFamily] || [];
  return unique([
    ...explicit,
    strategy.familyId,
    ...inferred,
    strategy.strategyId,
  ]);
}

function lookupPromotionItem(strategy, chain, scoreIndex) {
  const strategyDirect = scoreIndex.byChainStrategy.get(`${chain}:${strategy.strategyId}`);
  if (strategyDirect) return strategyDirect;
  for (const id of scoreLookupIds(strategy)) {
    const direct = scoreIndex.byChainFamily.get(`${chain}:${id}`);
    if (direct) return direct;
    const templateDirect = scoreIndex.byTemplateId.get(`${chain}:${id}`);
    if (templateDirect) return templateDirect;
  }
  return null;
}

function gateFactor(promotionItem, reducedFactor) {
  if (!promotionItem) return reducedFactor;
  const allocStatus = promotionItem.allocationGate?.status || null;
  if (allocStatus === "allocation_ready") return 1;
  return reducedFactor;
}

function rawScore(promotionItem) {
  const score = Number(promotionItem?.score);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

function buildCandidates({ strategyCaps, scoreIndex, reducedWeightFactor, minWeight, allowedChains }) {
  const candidates = [];
  for (const strategy of strategyCaps) {
    if (strategy.autoExecute !== true) continue;
    for (const [chain, perChainUsdRaw] of Object.entries(strategy.caps?.perChainUsd || {})) {
      const perChainUsd = finitePositive(perChainUsdRaw);
      if (perChainUsd === null) continue;
      if (allowedChains && !allowedChains.has(chain)) continue;
      const promotionItem = lookupPromotionItem(strategy, chain, scoreIndex);
      const score = rawScore(promotionItem);
      const factor = gateFactor(promotionItem, reducedWeightFactor);
      const baseWeight = score > 0 ? score : minWeight;
      const weight = baseWeight * factor;
      candidates.push({
        strategy,
        chain,
        perItemCapUsd: perChainUsd,
        promotionItem,
        score,
        gateFactor: factor,
        weight,
      });
    }
  }
  return candidates;
}

function waterFillAllocate({ candidates, total, perStrategyCapUsd }) {
  const n = candidates.length;
  const allocations = new Array(n).fill(0);
  if (n === 0 || !(total > 0)) return allocations;

  const itemCap = candidates.map((c) => {
    const caps = [];
    if (Number.isFinite(c.perItemCapUsd) && c.perItemCapUsd > 0) caps.push(c.perItemCapUsd);
    if (Number.isFinite(perStrategyCapUsd) && perStrategyCapUsd > 0) caps.push(perStrategyCapUsd);
    return caps.length ? Math.min(...caps) : Infinity;
  });

  const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
  if (!(totalWeight > 0)) {
    const equal = total / n;
    for (let i = 0; i < n; i += 1) allocations[i] = Math.min(equal, itemCap[i]);
    return allocations;
  }

  let remaining = total;
  const active = new Set(candidates.map((_, i) => i));
  for (let iter = 0; iter < 32 && remaining > 1e-6 && active.size > 0; iter += 1) {
    let activeWeight = 0;
    for (const i of active) activeWeight += candidates[i].weight;
    if (!(activeWeight > 0)) break;
    let consumed = 0;
    const filled = [];
    for (const i of active) {
      const want = (candidates[i].weight / activeWeight) * remaining;
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
  reducedWeightFactor = DEFAULT_REDUCED_WEIGHT_FACTOR,
  minWeight = DEFAULT_MIN_WEIGHT,
  allowedChains = DEFAULT_ALLOWED_CHAINS,
  reviewOnlyWeightFactor,
  now = new Date().toISOString(),
} = {}) {
  if (Number.isFinite(reviewOnlyWeightFactor) && reviewOnlyWeightFactor > 0) {
    reducedWeightFactor = reviewOnlyWeightFactor;
  }

  const total = finitePositive(totalCapitalUsd);
  const scoreIndex = buildPromotionScoreIndex(promotionGate);
  const economicsByTemplate = new Map();
  for (const entry of economics?.items || []) {
    if (entry?.templateId) economicsByTemplate.set(entry.templateId, entry);
  }

  const candidates = buildCandidates({
    strategyCaps,
    scoreIndex,
    reducedWeightFactor,
    minWeight,
    allowedChains: allowedChains instanceof Set ? allowedChains : (Array.isArray(allowedChains) ? new Set(allowedChains) : null),
  });

  if (!total || candidates.length === 0) {
    return {
      schemaVersion: 2,
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

  const allocations = waterFillAllocate({
    candidates,
    total,
    perStrategyCapUsd,
  });

  const perChainMaxShare = Number(diversificationPolicy?.perChainMaxShare);
  const perChainCapUsd =
    Number.isFinite(perChainMaxShare) && perChainMaxShare > 0 ? perChainMaxShare * total : null;
  if (perChainCapUsd !== null) {
    const sumByChain = new Map();
    candidates.forEach((c, i) => {
      sumByChain.set(c.chain, (sumByChain.get(c.chain) || 0) + allocations[i]);
    });
    for (const [chain, sum] of sumByChain.entries()) {
      if (sum <= perChainCapUsd) continue;
      const scale = perChainCapUsd / sum;
      candidates.forEach((c, i) => {
        if (c.chain === chain) allocations[i] *= scale;
      });
    }
  }

  const perStrategy = [];
  candidates.forEach((c, i) => {
    const allocation = allocations[i];
    if (!(allocation > 0)) return;
    const promotionItem = c.promotionItem;
    const templateId = promotionItem?.templateId
      || `${c.chain}:${c.strategy.familyId || c.strategy.strategyId}`;
    const economicsEntry = economicsByTemplate.get(templateId) || null;
    perStrategy.push({
      templateId,
      chain: c.chain,
      familyId: c.strategy.familyId || null,
      strategyId: c.strategy.strategyId,
      label: promotionItem?.label || c.strategy.label || c.strategy.strategyId,
      score: c.score,
      gateFactor: c.gateFactor,
      weight: c.weight,
      capUsd: c.perItemCapUsd,
      allocationUsd: allocation,
      allocationGateStatus: promotionItem?.allocationGate?.status || "no_gate_data",
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
    schemaVersion: 2,
    observedAt: now,
    totalCapitalUsd: total,
    perStrategy,
    perChain,
    summary: {
      chainCount: perChain.length,
      strategyCount: perStrategy.length,
      totalAllocationUsd,
      reducedWeightFactor,
      minWeight,
    },
  };
}
