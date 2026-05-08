// Scored capital allocation engine.
//
// Replaces flat per-strategy caps with a deterministic weighted score
// that drives capital deployment across strategies, chains, and protocols.
//
// Score components (all normalized 0–1):
//   - riskScore     : protocol safety (TVL, audits, age)
//   - returnScore   : expected yield (expectedYieldSats / maxYield)
//   - chainScore    : chain efficiency (gas, offramp, signer reliability)
//
// compositeScore = riskScore * 0.30 + returnScore * 0.50 + chainScore * 0.20
//
// Diversification constraints (applied *after* scoring):
//   - perStrategyMaxShare  (default 0.30)
//   - perChainMaxShare     (default 0.40)
//   - perProtocolMaxShare  (default 0.35)
//   - perFamilyMaxShare    (default 0.45)
//
// Pure function. No I/O, no LLM.

import { CAPITAL_ALLOCATOR_POLICY } from "../config/capital-allocator.mjs";
import { canonicalGatewayChain } from "../config/gateway-destinations.mjs";
import {
  effectiveMicroBudgetUsd,
  resolveEffectiveSmallCapitalBudgets,
} from "../config/small-capital-campaign-mode.mjs";

function finitePositive(v) {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeScore(raw, max) {
  if (!Number.isFinite(raw) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp(raw / max, 0, 1);
}

function usdToSats(usd, btcPriceUsd) {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) return null;
  return Math.floor(((usd + 1e-9) / btcPriceUsd) * 1e8);
}

const DEFAULT_WEIGHTS = Object.freeze({
  risk: 0.30,
  return: 0.50,
  chain: 0.20,
});

const DEFAULT_DIVERSIFICATION = Object.freeze({
  perStrategyMaxShare: 0.30,
  perChainMaxShare: 1.0,
  perProtocolMaxShare: 1.0,
  perFamilyMaxShare: 1.0,
});

const DEFAULT_VENUE_METADATA = Object.freeze({
  // Base
  "wrapped-btc-loop-base-moonwell": { riskScore: 0.75, chainScore: 0.90, family: "lending" },
  "aerodrome-cl-base": { riskScore: 0.70, chainScore: 0.90, family: "lp" },
  "pendle-pt-lbtc-base": { riskScore: 0.65, chainScore: 0.90, family: "vault" },
  "beefy-folding-vault": { riskScore: 0.60, chainScore: 0.90, family: "vault" },
  "recursive_wrapped_btc_lending_loop": { riskScore: 0.75, chainScore: 0.90, family: "lending" },
  "recursive_stablecoin_lending_loop": { riskScore: 0.75, chainScore: 0.90, family: "lending" },
  "gateway_native_asset_conversion_sleeve": { riskScore: 0.80, chainScore: 0.85, family: "yield" },
  // BSC
  "pendle-pt-solvbtc-bbn-bsc": { riskScore: 0.60, chainScore: 0.80, family: "vault" },
  // Avalanche
  "gmx-v2-perp-basis-avax": { riskScore: 0.70, chainScore: 0.85, family: "perp" },
  // Berachain
  "berachain-bend-bex-bgt": { riskScore: 0.55, chainScore: 0.70, family: "lending" },
  // Rotation / spread
  "destination_wrapped_btc_rotation": { riskScore: 0.75, chainScore: 0.85, family: "rotation" },
  "stablecoin_treasury_rotation": { riskScore: 0.75, chainScore: 0.85, family: "rotation" },
  "gateway_proxy_spread_rebalance_recheck": { riskScore: 0.70, chainScore: 0.85, family: "spread" },
  "macro_asset_rotation": { riskScore: 0.70, chainScore: 0.85, family: "rotation" },
});

function resolveFamily(strategyId, metadata) {
  return metadata[strategyId]?.family || "unknown";
}

function resolveChainScore(candidate, metadata, chainScoreLedger) {
  const chain = canonicalGatewayChain(candidate.chain);
  const ledgerEntry = chainScoreLedger?.byChain?.[chain] || null;
  if (ledgerEntry && Number.isFinite(ledgerEntry.chainScore)) {
    return {
      chain,
      chainScore: finitePositive(ledgerEntry.chainScore),
      chainScoreSource: ledgerEntry.scoreSource || "ledger",
      widePosterior: ledgerEntry.widePosterior === true,
      ledgerSampleCount: ledgerEntry.sampleCount ?? null,
      ledgerAlphaSampleCount: ledgerEntry.alphaSampleCount ?? null,
      receiptFreshnessHours: ledgerEntry.receiptFreshnessHours ?? null,
      chainScoreBlockers: [...(ledgerEntry.blockers || [])],
    };
  }
  const meta = metadata[candidate.strategyId] || {};
  return {
    chain,
    chainScore: finitePositive(meta.chainScore ?? 0.5),
    chainScoreSource: "static_prior",
    widePosterior: true,
    ledgerSampleCount: null,
    ledgerAlphaSampleCount: null,
    receiptFreshnessHours: null,
    chainScoreBlockers: ["chain_score_static_prior"],
  };
}

function allocationBucketForCandidate(candidate = {}, policy = CAPITAL_ALLOCATOR_POLICY) {
  if (candidate.chainScoreSource === "prior" || candidate.chainScoreSource === "static_prior") return "explore";
  if (candidate.widePosterior === true) return "explore";
  const alphaSampleCount = finiteNumber(candidate.ledgerAlphaSampleCount);
  if (alphaSampleCount !== null && alphaSampleCount < policy.exploreMinSamples) return "explore";
  const sampleCount = finiteNumber(candidate.ledgerSampleCount);
  if (sampleCount !== null && sampleCount < policy.exploreMinSamples) return "explore";
  const freshnessHours = finiteNumber(candidate.receiptFreshnessHours);
  if (freshnessHours !== null && freshnessHours > policy.exploreReceiptFreshnessHours) return "explore";
  return "exploit";
}

function exploreCapSatsForCandidate({
  candidate = {},
  totalAvailableSats = 0,
  btcPriceUsd = 60_000,
  policy = CAPITAL_ALLOCATOR_POLICY,
} = {}) {
  const totalAvailableUsd = (finitePositive(totalAvailableSats) * finitePositive(btcPriceUsd)) / 1e8;
  const scaled = resolveEffectiveSmallCapitalBudgets({ operatingCapitalUsd: totalAvailableUsd });
  const defaultBudgets = scaled.effectiveBudgets.defaultBudgetsUsd;
  const radarCaps = scaled.effectiveBudgets.radarCaps;
  const capsUsd = [
    policy.exploreCandidateMaxUsd,
    totalAvailableUsd > 0 ? totalAvailableUsd * policy.smallCapitalMicroTestHardCapPct : null,
    defaultBudgets.microMaxUsd,
    defaultBudgets.initialCampaignUsd,
    defaultBudgets.initialMicroUsd,
  ];
  if (/radar/u.test(String(candidate.strategyId || ""))) capsUsd.push(radarCaps.perCanaryUsd);
  const capUsd = Math.min(...capsUsd.filter((value) => Number.isFinite(value) && value > 0));
  return usdToSats(capUsd, btcPriceUsd);
}

function exploreBudgetSats({ totalAvailableSats = 0, btcPriceUsd = 60_000, policy = CAPITAL_ALLOCATOR_POLICY } = {}) {
  const totalSats = finitePositive(totalAvailableSats);
  const totalAvailableUsd = (totalSats * finitePositive(btcPriceUsd)) / 1e8;
  const shareCapSats = Math.floor(totalSats * policy.exploreSharePct);
  const microBudgetUsd = effectiveMicroBudgetUsd(totalAvailableUsd);
  const microBudgetSats = usdToSats(microBudgetUsd, btcPriceUsd);
  return Math.min(shareCapSats, finitePositive(microBudgetSats));
}

function computeCompositeScore(candidate, metadata, weights, chainScoreLedger = null) {
  const meta = metadata[candidate.strategyId] || {};
  const riskScore = finitePositive(meta.riskScore ?? 0.5);
  const chainScore = resolveChainScore(candidate, metadata, chainScoreLedger).chainScore;

  // returnScore: relative to the highest expectedYield in the candidate set
  const maxYield = finitePositive(candidate.maxYieldInSet ?? 1);
  const returnScore = normalizeScore(candidate.expectedYieldSats, maxYield);

  return (
    riskScore * weights.risk +
    returnScore * weights.return +
    chainScore * weights.chain
  );
}

function projectedShare(current, total, add) {
  const t = finitePositive(total) + finitePositive(add);
  if (t <= 0) return 0;
  // When portfolio is empty, any positive add is allowed
  if (finitePositive(total) === 0) return 0;
  return (finitePositive(current) + finitePositive(add)) / t;
}

function wouldViolateDiversification({
  candidate,
  addSats,
  allocations,
  policy,
}) {
  if (!policy) return null;
  const total = allocations.reduce((sum, a) => sum + finitePositive(a.allocatedSats), 0);

  const perStrategy = allocations.filter((a) => a.strategyId === candidate.strategyId);
  const currentStrategy = perStrategy.reduce((s, a) => s + finitePositive(a.allocatedSats), 0);
  const shareStrategy = projectedShare(currentStrategy, total, addSats);
  if (shareStrategy > policy.perStrategyMaxShare) {
    return { dimension: "strategy", share: shareStrategy, max: policy.perStrategyMaxShare };
  }

  const perChain = allocations.filter((a) => a.chain === candidate.chain);
  const currentChain = perChain.reduce((s, a) => s + finitePositive(a.allocatedSats), 0);
  const shareChain = projectedShare(currentChain, total, addSats);
  if (shareChain > policy.perChainMaxShare) {
    return { dimension: "chain", share: shareChain, max: policy.perChainMaxShare };
  }

  const perProtocol = allocations.filter((a) => a.protocol === candidate.protocol);
  const currentProtocol = perProtocol.reduce((s, a) => s + finitePositive(a.allocatedSats), 0);
  const shareProtocol = projectedShare(currentProtocol, total, addSats);
  if (shareProtocol > policy.perProtocolMaxShare) {
    return { dimension: "protocol", share: shareProtocol, max: policy.perProtocolMaxShare };
  }

  const family = resolveFamily(candidate.strategyId, DEFAULT_VENUE_METADATA);
  const perFamily = allocations.filter((a) => resolveFamily(a.strategyId, DEFAULT_VENUE_METADATA) === family);
  const currentFamily = perFamily.reduce((s, a) => s + finitePositive(a.allocatedSats), 0);
  const shareFamily = projectedShare(currentFamily, total, addSats);
  if (shareFamily > policy.perFamilyMaxShare) {
    return { dimension: "family", share: shareFamily, max: policy.perFamilyMaxShare };
  }

  return null;
}

function shrinkToDiversification({ candidate, requestedSats, allocations, policy }) {
  if (!policy) return finitePositive(requestedSats);
  let lo = 0;
  let hi = finitePositive(requestedSats);
  if (hi === 0) return 0;
  if (!wouldViolateDiversification({ candidate, addSats: hi, allocations, policy })) return hi;
  for (let i = 0; i < 40; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid === lo) break;
    const v = wouldViolateDiversification({ candidate, addSats: mid, allocations, policy });
    if (v) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * Build a scored capital allocation across candidates.
 *
 * @param {object} opts
 * @param {Array} opts.candidates – dispatcher candidates from candidate-builder
 * @param {object} [opts.venueMetadata] – strategyId → { riskScore, chainScore, family }
 * @param {object} [opts.diversificationPolicy]
 * @param {number} [opts.totalAvailableSats] – total capital pool to allocate
 * @param {object} [opts.scoreWeights]
 * @returns {{ allocations: Array, totalAllocated: number, summary: object }}
 */
export function buildScoredAllocation({
  candidates = [],
  venueMetadata = DEFAULT_VENUE_METADATA,
  diversificationPolicy = DEFAULT_DIVERSIFICATION,
  totalAvailableSats = 0,
  scoreWeights = DEFAULT_WEIGHTS,
  chainScoreLedger = null,
  btcPriceUsd = 60_000,
  allocatorPolicy = CAPITAL_ALLOCATOR_POLICY,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      allocations: [],
      totalAllocated: 0,
      summary: { reason: "no_candidates" },
    };
  }

  const maxYield = Math.max(...candidates.map((c) => finitePositive(c.expectedYieldSats)), 1);

  // 1. Score every candidate
  const scored = candidates
    .map((c) => {
      const chainScore = resolveChainScore(c, venueMetadata, chainScoreLedger);
      const allocationBucket = allocationBucketForCandidate(chainScore, allocatorPolicy);
      return {
        ...c,
        chain: chainScore.chain || c.chain,
        ...chainScore,
        allocationBucket,
        exploreCapSats: allocationBucket === "explore"
          ? exploreCapSatsForCandidate({
              candidate: c,
              totalAvailableSats,
              btcPriceUsd,
              policy: allocatorPolicy,
            })
          : null,
        score: computeCompositeScore({ ...c, maxYieldInSet: maxYield }, venueMetadata, scoreWeights, chainScoreLedger),
      };
    })
    .sort((a, b) => b.score - a.score);

  // 2. Allocate greedily by score, applying diversification binary search
  const allocations = [];
  let remaining = finitePositive(totalAvailableSats);
  let exploreRemaining = exploreBudgetSats({
    totalAvailableSats,
    btcPriceUsd,
    policy: allocatorPolicy,
  });

  for (const candidate of scored) {
    if (remaining <= 0) break;

    let requested = finitePositive(candidate.proposedAllocationSats);
    if (candidate.allocationBucket === "explore") {
      if (exploreRemaining <= 0) continue;
      requested = Math.min(
        requested,
        finitePositive(candidate.exploreCapSats ?? requested),
        exploreRemaining,
      );
    }
    if (requested <= 0) continue;

    const cappedByDiversity = shrinkToDiversification({
      candidate,
      requestedSats: requested,
      allocations,
      policy: diversificationPolicy,
    });

    const alloc = Math.min(requested, cappedByDiversity, remaining);
    if (alloc > 0) {
      allocations.push(
        Object.freeze({
          strategyId: candidate.strategyId,
          chain: candidate.chain,
          protocol: candidate.protocol,
          allocatedSats: alloc,
          expectedYieldSats: candidate.expectedYieldSats,
          score: candidate.score,
          chainScore: candidate.chainScore,
          chainScoreSource: candidate.chainScoreSource,
          widePosterior: candidate.widePosterior,
          ledgerSampleCount: candidate.ledgerSampleCount,
          ledgerAlphaSampleCount: candidate.ledgerAlphaSampleCount,
          receiptFreshnessHours: candidate.receiptFreshnessHours,
          chainScoreBlockers: Object.freeze([...(candidate.chainScoreBlockers || [])]),
          allocationBucket: candidate.allocationBucket,
          exploreCapSats: candidate.exploreCapSats,
        }),
      );
      remaining -= alloc;
      if (candidate.allocationBucket === "explore") {
        exploreRemaining = Math.max(0, exploreRemaining - alloc);
      }
    }
  }

  const totalAllocated = finitePositive(totalAvailableSats) - remaining;
  const exploreAllocationSats = allocations
    .filter((allocation) => allocation.allocationBucket === "explore")
    .reduce((sum, allocation) => sum + finitePositive(allocation.allocatedSats), 0);
  const exploitAllocationSats = allocations
    .filter((allocation) => allocation.allocationBucket === "exploit")
    .reduce((sum, allocation) => sum + finitePositive(allocation.allocatedSats), 0);

  return Object.freeze({
    allocations: Object.freeze(allocations),
    totalAllocated,
    summary: Object.freeze({
      candidateCount: candidates.length,
      allocatedCount: allocations.length,
      totalAvailableSats: finitePositive(totalAvailableSats),
      totalAllocated,
      remainingSats: remaining,
      exploreAllocationSats,
      exploitAllocationSats,
      exploreCandidateCount: scored.filter((candidate) => candidate.allocationBucket === "explore").length,
      priorScoreCandidateCount: scored.filter((candidate) =>
        candidate.chainScoreSource === "prior" || candidate.chainScoreSource === "static_prior",
      ).length,
      topStrategy: allocations[0]?.strategyId || null,
      topScore: scored[0]?.score || 0,
    }),
  });
}

export {
  DEFAULT_WEIGHTS,
  DEFAULT_DIVERSIFICATION,
  DEFAULT_VENUE_METADATA,
};
