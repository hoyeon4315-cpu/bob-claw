export const DEFAULT_RANKER_WEIGHTS = Object.freeze({
  apr: 100,
  tvlLog: 10,
  age: 5,
  audit: 15,
  sameChainBonus: 0.15,
});

export const DEFAULT_RANKER_PENALTIES = Object.freeze({
  lowTvlThreshold: 1_000_000,
  lowTvlPenalty: 0.3,
  highVolatilityThreshold: 0.8,
  highVolatilityPenalty: 0.2,
  defiLlamaSigmaThreshold: 0.8,
  defiLlamaSigmaPenalty: 0.15,
  defiLlamaIlRiskPenalty: 0.12,
  defiLlamaMultiExposurePenalty: 0.08,
  defiLlamaNegativeTrendThresholdPct: -10,
  defiLlamaNegativeTrendPenalty: 0.1,
  unknownIssuerPenalty: 0.25,
  pointRewardPenalty: 0.4,
  incentiveDominantPenalty: 0.15,
  campaignEndsSoonHours: 24,
  campaignEndsSoonPenalty: 0.3,
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function computeOpportunityScore(opportunity = {}, {
  weights = DEFAULT_RANKER_WEIGHTS,
  penalties = DEFAULT_RANKER_PENALTIES,
} = {}) {
  const apr = opportunity.effectiveApr ?? (opportunity.aprPct ?? 0) / 100;
  const tvl = isFiniteNumber(opportunity.tvlUsd) ? opportunity.tvlUsd : 0;
  const age = isFiniteNumber(opportunity.contractAgeDays) ? opportunity.contractAgeDays : 0;
  const hasAudit = opportunity.hasAudit === true;
  const trustedIssuer = opportunity.trustedIssuer === true;
  const hasPointRewards = opportunity.hasPointRewards === true;
  const vol30d = isFiniteNumber(opportunity.vol30dPct) ? opportunity.vol30dPct / 100 : 0;
  const campaignRemainingHours = isFiniteNumber(opportunity.campaignRemainingHours)
    ? opportunity.campaignRemainingHours
    : Number.POSITIVE_INFINITY;
  const incentiveDominant = opportunity.incentiveDominant === true;
  const srcChain = opportunity.srcChain || opportunity.chain;
  const dstChain = opportunity.dstChain || opportunity.chain;
  const isSameChain = srcChain && dstChain && srcChain === dstChain;
  const bridgeCostBps = isFiniteNumber(opportunity.bridgeCostBps) ? opportunity.bridgeCostBps / 10000 : 0;
  const defiLlama = opportunity.defiLlama || {};
  const ilRisk = String(opportunity.ilRisk ?? defiLlama.ilRisk ?? "").toLowerCase();
  const exposure = String(opportunity.exposure ?? defiLlama.exposure ?? "").toLowerCase();
  const sigma = isFiniteNumber(opportunity.sigma)
    ? opportunity.sigma
    : isFiniteNumber(defiLlama.sigma)
      ? defiLlama.sigma
      : null;
  const apyPct30D = isFiniteNumber(opportunity.apyPct30D)
    ? opportunity.apyPct30D
    : isFiniteNumber(defiLlama.apyPct30D)
      ? defiLlama.apyPct30D
      : null;

  // Adjust APR for bridge cost on cross-chain opportunities
  const effectiveApr = isSameChain ? apr : Math.max(0, apr - bridgeCostBps);

  let score = 0;
  score += effectiveApr * weights.apr;
  score += Math.log10(Math.max(1, tvl)) * weights.tvlLog;
  score += Math.min(age / 365, 1) * weights.age;
  score += hasAudit ? weights.audit : 0;
  score += trustedIssuer ? weights.audit * 0.5 : 0;

  let multiplier = 1;
  if (tvl < penalties.lowTvlThreshold) multiplier -= penalties.lowTvlPenalty;
  if (vol30d > penalties.highVolatilityThreshold) multiplier -= penalties.highVolatilityPenalty;
  if (sigma !== null && sigma > penalties.defiLlamaSigmaThreshold) multiplier -= penalties.defiLlamaSigmaPenalty;
  if (ilRisk === "yes") multiplier -= penalties.defiLlamaIlRiskPenalty;
  if (exposure === "multi") multiplier -= penalties.defiLlamaMultiExposurePenalty;
  if (apyPct30D !== null && apyPct30D < penalties.defiLlamaNegativeTrendThresholdPct) {
    multiplier -= penalties.defiLlamaNegativeTrendPenalty;
  }
  if (!trustedIssuer && !hasAudit) multiplier -= penalties.unknownIssuerPenalty;
  if (hasPointRewards) multiplier -= penalties.pointRewardPenalty;
  if (incentiveDominant) multiplier -= penalties.incentiveDominantPenalty;
  if (campaignRemainingHours < penalties.campaignEndsSoonHours) multiplier -= penalties.campaignEndsSoonPenalty;
  if (isSameChain) multiplier += weights.sameChainBonus;

  multiplier = Math.max(0, multiplier);
  score *= multiplier;

  return isFiniteNumber(score) ? score : 0;
}

export function rankOpportunities(opportunities = [], context = {}) {
  const scored = (opportunities || []).map((opp) => ({
    ...opp,
    score: computeOpportunityScore(opp, context),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function selectTopN(rankedOpportunities = {}, n = 10) {
  const count = Number.isFinite(n) && n > 0 ? n : 10;
  return (rankedOpportunities || []).slice(0, count);
}

export function computeScoreSum(opportunities = []) {
  return (opportunities || []).reduce((sum, opp) => sum + (isFiniteNumber(opp.score) ? opp.score : 0), 0);
}
