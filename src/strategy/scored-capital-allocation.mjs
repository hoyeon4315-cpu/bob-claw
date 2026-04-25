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

function finitePositive(v) {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeScore(raw, max) {
  if (!Number.isFinite(raw) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp(raw / max, 0, 1);
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

function computeCompositeScore(candidate, metadata, weights) {
  const meta = metadata[candidate.strategyId] || {};
  const riskScore = finitePositive(meta.riskScore ?? 0.5);
  const chainScore = finitePositive(meta.chainScore ?? 0.5);

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
  let lo = 0;
  let hi = finitePositive(requestedSats);
  if (hi === 0) return 0;
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
    .map((c) => ({
      ...c,
      score: computeCompositeScore({ ...c, maxYieldInSet: maxYield }, venueMetadata, scoreWeights),
    }))
    .sort((a, b) => b.score - a.score);

  // 2. Allocate greedily by score, applying diversification binary search
  const allocations = [];
  let remaining = finitePositive(totalAvailableSats);

  for (const candidate of scored) {
    if (remaining <= 0) break;

    const requested = finitePositive(candidate.proposedAllocationSats);
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
        }),
      );
      remaining -= alloc;
    }
  }

  const totalAllocated = finitePositive(totalAvailableSats) - remaining;

  return Object.freeze({
    allocations: Object.freeze(allocations),
    totalAllocated,
    summary: Object.freeze({
      candidateCount: candidates.length,
      allocatedCount: allocations.length,
      totalAvailableSats: finitePositive(totalAvailableSats),
      totalAllocated,
      remainingSats: remaining,
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
