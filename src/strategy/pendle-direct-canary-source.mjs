import { resolvePendleMerklBinding, findPendleMarket, buildPendleBindingFromMarket } from "./pendle-merkl-binding-join.mjs";

const ASSET_FAMILY_RULES = [
  { test: /BTC$/i, family: "btc_fixed_yield" },
  { test: /ETH$/i, family: "eth_fixed_yield" },
  { test: /(USD|USDe|SUSD|RLUSD|GHO|DAI|USDT|USDC)/i, family: "stable_fixed_yield" },
];

function classifyAssetFamily(symbol) {
  if (typeof symbol !== "string") return "non_core_asset";
  for (const rule of ASSET_FAMILY_RULES) {
    if (rule.test.test(symbol)) return rule.family;
  }
  return "non_core_asset";
}

function chainName(chainId) {
  const m = { 1: "ethereum", 8453: "base", 56: "bsc", 10: "optimism", 130: "unichain", 146: "sonic" };
  return m[chainId] || String(chainId);
}

function maturityHours(expiryIso, now) {
  const t = new Date(expiryIso).getTime();
  if (!Number.isFinite(t)) return null;
  return (t - now) / 3_600_000;
}

export function buildPendleDirectCanaryCandidate(market, { chainId, now = Date.now() } = {}) {
  if (!market || typeof market !== "object") return null;
  const binding = buildPendleBindingFromMarket(market, { now });
  if (!binding) return null;
  const family = classifyAssetFamily(market.name);
  const tvl = market?.details?.totalTvl ?? null;
  const impliedApy = market?.details?.impliedApy ?? null;
  const matHours = maturityHours(market.expiry, now);
  return {
    source: "pendle_markets_api_direct",
    opportunityId: `pendle-direct:${chainId}:${(market.address || "").toLowerCase()}`,
    chainId,
    chain: chainName(chainId),
    protocolId: "pendle",
    protocolName: "Pendle",
    executionSurface: "fixedYield",
    family,
    assetSymbol: market.name,
    poolAddress: (market.address || "").toLowerCase(),
    tvlUsd: tvl,
    aprPct: impliedApy != null ? impliedApy * 100 : null,
    maturity: binding.maturity,
    maturityHours: matHours,
    protocolBinding: binding,
  };
}

export function buildPendleDirectCanaryFeed({ snapshotsByChainId = {}, now = Date.now(), minTvlByFamily = null } = {}) {
  const candidates = [];
  for (const [chainIdKey, snapshot] of Object.entries(snapshotsByChainId)) {
    if (!snapshot || !Array.isArray(snapshot.markets)) continue;
    const chainId = Number(chainIdKey);
    for (const market of snapshot.markets) {
      const candidate = buildPendleDirectCanaryCandidate(market, { chainId, now });
      if (!candidate) continue;
      if (minTvlByFamily) {
        const floor = minTvlByFamily[candidate.family];
        if (Number.isFinite(floor) && candidate.tvlUsd != null && candidate.tvlUsd < floor) continue;
      }
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return candidates;
}

const FAMILY_TO_STRATEGY = {
  btc_fixed_yield: "pendle-yt-canary",
  eth_fixed_yield: "pendle-yt-canary",
  stable_fixed_yield: "pendle-yt-canary",
  non_core_asset: "pendle-yt-canary",
};

export function pendleDirectCandidateToOpportunity(candidate, { now = Date.now() } = {}) {
  if (!candidate) return null;
  return {
    source: "pendle_direct_ingestion",
    observedAt: new Date(now).toISOString(),
    opportunityId: candidate.opportunityId,
    chainId: candidate.chainId,
    chain: candidate.chain,
    protocolId: candidate.protocolId,
    protocolName: candidate.protocolName,
    type: "PENDLE_YT_DIRECT",
    action: "DEPOSIT_YT",
    name: candidate.assetSymbol,
    description: `Pendle YT direct candidate: ${candidate.assetSymbol} @ ${candidate.aprPct?.toFixed(2)}% APR maturity=${candidate.maturity}`,
    identifier: candidate.poolAddress,
    poolAddress: candidate.poolAddress,
    depositUrl: `https://app.pendle.finance/trade/pools/${candidate.poolAddress}/zap/in?chain=${candidate.chain}`,
    status: "open",
    family: candidate.family,
    mappedStrategyId: FAMILY_TO_STRATEGY[candidate.family] || "pendle-yt-canary",
    executionSurface: "fixedYield",
    pendleInstrument: "yt",
    protocolBinding: candidate.protocolBinding,
    tvlUsd: candidate.tvlUsd,
    aprPct: candidate.aprPct,
    nativeAprPct: candidate.aprPct,
    campaignRemainingHours: candidate.maturityHours,
    decision: "candidate",
    validationMode: "tiny_live_canary_only",
    overfitRisk: "low",
    overfitFlags: [],
    assetFamilies: [candidate.family],
    hasBtcExposure: candidate.family === "btc_fixed_yield",
    hasEthExposure: candidate.family === "eth_fixed_yield",
    hasStableExposure: candidate.family === "stable_fixed_yield",
  };
}

export function pendleDirectCandidatesToOpportunities(candidates = [], options = {}) {
  return candidates
    .map((c) => pendleDirectCandidateToOpportunity(c, options))
    .filter((o) => o != null);
}

export { findPendleMarket, resolvePendleMerklBinding };
