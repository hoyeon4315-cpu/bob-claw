// Protocol Trust Tiers — risk weighting based on track record, audit, TVL
export const PROTOCOL_TRUST_TIERS = Object.freeze({
  TIER_A: {
    name: "blue_chip",
    riskMultiplier: 1.0,    // Full allocation allowed
    maxSingleExposurePct: 0.30, // 30% of capital
    requirements: [
      "multi_audit",
      "tvl_over_100m",
      "operating_over_2y",
      "no_critical_exploits",
    ],
    protocols: new Set([
      "aave-v3", "compound-v3", "curve", "curve-dex",
      "uniswap-v3", "uniswap-v4", "balancer-v2",
      "morpho", "morpho-blue", "pendle",
    ]),
  },
  TIER_B: {
    name: "established",
    riskMultiplier: 0.7,    // 70% of normal allocation
    maxSingleExposurePct: 0.20, // 20% of capital
    requirements: [
      "at_least_1_audit",
      "tvl_over_10m",
      "operating_over_6m",
      "no_major_exploits_12m",
    ],
    protocols: new Set([
      "beefy", "aerodrome", "aerodrome-v1", "aerodrome-slipstream",
      "gmx-v2", "gmx-v2-perps", "moonwell", "superform",
      "pancakeswap-amm-v3", "velodrome-v2", "fluid-lending",
    ]),
  },
  TIER_C: {
    name: "emerging",
    riskMultiplier: 0.4,    // 40% of normal allocation
    maxSingleExposurePct: 0.10, // 10% of capital
    requirements: [
      "some_audit_or_formal_verification",
      "tvl_over_1m",
      "operating_over_1m",
    ],
    protocols: new Set([
      "yo-protocol", "berapaw", "lista-lending", "avant-avusd",
      "blackhole-clmm", "canto-lending", "mystic-finance-lending",
      "credit", "tydro", "storm-trade", "symbiosis",
      "solv-basis-trading", "segment-finance", "avalon-finance",
    ]),
  },
  TIER_D: {
    name: "experimental",
    riskMultiplier: 0.15,   // 15% of normal allocation
    maxSingleExposurePct: 0.05, // 5% of capital
    requirements: [
      "any_audit_preferred",
      "tvl_over_100k",
    ],
    protocols: new Set([
      "takara-lend", "blend-pools-v2", "bluefin-spot",
      "yuzu-finance", "indigo", "spectra-v2", "katana",
      "mento-v3", "hyperion", "nest-v1", "ekubo",
      "osmosis-dex", "plasma", "neutron", "hydro-inflow",
      "sovryn-dex", "mim-swap",
    ]),
  },
});

export function getProtocolTier(protocolName = "") {
  const normalized = String(protocolName).toLowerCase().trim();
  for (const [tierKey, tier] of Object.entries(PROTOCOL_TRUST_TIERS)) {
    if (tier.protocols.has(normalized)) {
      return { tierKey, ...tier };
    }
  }
  // Unknown protocol = most restrictive
  return {
    tierKey: "UNKNOWN",
    name: "unknown",
    riskMultiplier: 0.1,
    maxSingleExposurePct: 0.02,
    requirements: ["manual_review_required"],
    protocols: new Set(),
  };
}

export function computeRiskAdjustedApy(apy, protocolName) {
  const tier = getProtocolTier(protocolName);
  return apy * tier.riskMultiplier;
}

export function computeRiskAdjustedScore(opportunity = {}) {
  const tier = getProtocolTier(opportunity.protocol);
  const riskMult = tier.riskMultiplier;
  const tvl = opportunity.tvlUsd || 0;
  const apy = opportunity.apy || 0;

  // Risk-adjusted score formula:
  // score = (risk-adjusted APY) * log(TVL) * (1 - concentration_penalty)
  const adjApy = apy * riskMult;
  const tvlFactor = Math.log10(Math.max(1, tvl));

  // Higher penalty for low TVL in lower tiers
  let tvlPenalty = 0;
  if (tvl < 1_000_000 && tier.tierKey !== "TIER_A") tvlPenalty = 0.3;
  else if (tvl < 5_000_000 && tier.tierKey === "TIER_C") tvlPenalty = 0.2;
  else if (tvl < 10_000_000 && tier.tierKey === "TIER_D") tvlPenalty = 0.4;

  return adjApy * tvlFactor * (1 - tvlPenalty);
}
