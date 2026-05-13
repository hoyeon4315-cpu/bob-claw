import {
  resolvePendleMerklBinding,
  findPendleMarket,
  buildPendleBindingFromMarket,
} from "./pendle-merkl-binding-join.mjs";
import { buildPendleFairValueQuote, buildPendleOnChainExitQuote } from "../research/pendle-yt-on-chain-quote.mjs";

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

function normalizeTokenAddress(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("0x") && normalized.length === 42) return normalized;
  const withChain = normalized.match(/^\d+-(0x[0-9a-f]{40})$/);
  return withChain ? withChain[1] : null;
}

function tokenAddresses(values = []) {
  return [
    ...new Set(
      (values || [])
        .map((value) => normalizeTokenAddress(typeof value === "object" ? value.address : value))
        .filter(Boolean),
    ),
  ];
}

function maturityHours(expiryIso, now) {
  const t = new Date(expiryIso).getTime();
  if (!Number.isFinite(t)) return null;
  return (t - now) / 3_600_000;
}

const EXIT_QUOTE_TVL_MIN_USD = 100_000;
const EXIT_QUOTE_DEFAULT_NOTIONAL_USD = 10;
const PENDLE_API_BASE = "https://api-v2.pendle.finance/core";

export async function fetchPendleMarketSdkTokens({ chainId, marketAddress, fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isFinite(Number(chainId))) throw new Error("chainId is required");
  const market = normalizeTokenAddress(marketAddress);
  if (!market) throw new Error("marketAddress is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is unavailable");
  const response = await fetchImpl(`${PENDLE_API_BASE}/v1/sdk/${Number(chainId)}/markets/${market}/tokens`);
  if (!response?.ok) {
    throw new Error(`Pendle SDK market tokens failed: status=${response?.status || "unknown"}`);
  }
  return response.json();
}

export function buildSyntheticPendleExitQuote(market, { notionalUsd = EXIT_QUOTE_DEFAULT_NOTIONAL_USD } = {}) {
  const tvl = market?.details?.totalTvl ?? null;
  const impliedApy = market?.details?.impliedApy ?? null;
  const expiryMs = market?.expiry ? new Date(market.expiry).getTime() : null;
  // Prefer Pendle fair-value model (uses impliedApy + maturity) over raw TVL proxy.
  if (Number.isFinite(impliedApy) && impliedApy > 0 && Number.isFinite(expiryMs)) {
    const fv = buildPendleFairValueQuote({
      impliedApyDecimal: impliedApy,
      expiryMs,
      marketTvlUsd: tvl,
      notionalUsd,
    });
    if (fv && !fv.error) return fv;
  }
  if (!Number.isFinite(tvl) || tvl < EXIT_QUOTE_TVL_MIN_USD) return null;
  const slippageBps = Math.max(1, Math.round((notionalUsd / tvl) * 10_000));
  return {
    source: "tvl_proxy",
    outputUsd: notionalUsd,
    depthUsd: Math.min(tvl * 0.01, notionalUsd * 1000),
    slippageBps,
    costUsd: notionalUsd * (slippageBps / 10_000),
    notionalUsd,
    note: "Synthetic exit-quote from Pendle market TVL — signer must verify on-chain depth before broadcast",
  };
}

export async function buildPendleDirectCanaryCandidateOnChain(
  market,
  { chainId, chain, now = Date.now(), notionalUsd = EXIT_QUOTE_DEFAULT_NOTIONAL_USD } = {},
) {
  const candidate = buildPendleDirectCanaryCandidate(market, { chainId, now });
  if (!candidate) return null;
  const expiryMs = market?.expiry ? new Date(market.expiry).getTime() : null;
  const impliedApy = market?.details?.impliedApy ?? null;
  try {
    const onChainQuote = await buildPendleOnChainExitQuote({
      chain: chain || candidate.chain,
      marketAddress: market.address,
      impliedApyDecimal: impliedApy,
      expiryMs,
      marketTvlUsd: market?.details?.totalTvl ?? null,
      notionalUsd,
      now,
    });
    if (onChainQuote && !onChainQuote.error) {
      candidate.exitQuote = onChainQuote;
      candidate.protocolBinding = {
        ...candidate.protocolBinding,
        exitQuote: onChainQuote,
        ytExitQuote: onChainQuote,
      };
    }
  } catch {
    // keep synthetic fallback already attached in buildPendleDirectCanaryCandidate
  }
  return candidate;
}

export function buildPendleDirectCanaryCandidate(market, { chainId, now = Date.now() } = {}) {
  if (!market || typeof market !== "object") return null;
  const binding = buildPendleBindingFromMarket(market, { now });
  if (!binding) return null;
  const sdkTokens = market.sdkMarketTokens || market.hostedSdkTokens || null;
  const syInputTokenAddresses = tokenAddresses(market.inputTokens);
  const sdkInputTokenAddresses = tokenAddresses(sdkTokens?.tokensIn);
  const entryTokenAddresses = [
    ...new Set(
      [binding.assetAddress, ...syInputTokenAddresses, ...sdkInputTokenAddresses]
        .filter(Boolean)
        .map((value) => value.toLowerCase()),
    ),
  ];
  const family = classifyAssetFamily(market.name);
  const tvl = market?.details?.totalTvl ?? null;
  const impliedApy = market?.details?.impliedApy ?? null;
  const matHours = maturityHours(market.expiry, now);
  const exitQuote = buildSyntheticPendleExitQuote(market);
  const enrichedBinding = {
    ...binding,
    syInputTokenAddresses,
    sdkInputTokenAddresses,
    entryTokenAddresses,
    ...(exitQuote ? { exitQuote, ytExitQuote: exitQuote } : {}),
  };
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
    protocolBinding: enrichedBinding,
    sdkMarketTokens: sdkTokens,
    exitQuote,
  };
}

export async function buildPendleDirectCanaryFeedOnChain({
  snapshotsByChainId = {},
  now = Date.now(),
  minTvlByFamily = null,
  notionalUsd,
} = {}) {
  const tasks = [];
  for (const [chainIdKey, snapshot] of Object.entries(snapshotsByChainId)) {
    if (!snapshot || !Array.isArray(snapshot.markets)) continue;
    const chainId = Number(chainIdKey);
    const chain = chainName(chainId);
    for (const market of snapshot.markets) {
      tasks.push(
        buildPendleDirectCanaryCandidateOnChain(market, { chainId, chain, now, notionalUsd }).catch(() => null),
      );
    }
  }
  const candidates = (await Promise.all(tasks)).filter((c) => c != null);
  if (minTvlByFamily) {
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const floor = minTvlByFamily[candidates[i].family];
      if (Number.isFinite(floor) && candidates[i].tvlUsd != null && candidates[i].tvlUsd < floor) {
        candidates.splice(i, 1);
      }
    }
  }
  candidates.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return candidates;
}

export async function buildPendleDirectCanaryFeedWithSdkTokens({
  snapshotsByChainId = {},
  now = Date.now(),
  minTvlByFamily = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const candidates = [];
  for (const [chainIdKey, snapshot] of Object.entries(snapshotsByChainId)) {
    if (!snapshot || !Array.isArray(snapshot.markets)) continue;
    const chainId = Number(chainIdKey);
    const baseCandidates = buildPendleDirectCanaryFeed({
      snapshotsByChainId: { [chainId]: snapshot },
      now,
      minTvlByFamily,
    });
    const marketByAddress = new Map(
      snapshot.markets.map((market) => [normalizeTokenAddress(market?.address), market]).filter(([address]) => address),
    );
    for (const candidate of baseCandidates) {
      const market = marketByAddress.get(normalizeTokenAddress(candidate.poolAddress));
      if (!market) {
        candidates.push(candidate);
        continue;
      }
      let sdkMarketTokens = null;
      try {
        sdkMarketTokens = await fetchPendleMarketSdkTokens({
          chainId,
          marketAddress: market.address,
          fetchImpl,
        });
      } catch {
        sdkMarketTokens = null;
      }
      candidates.push(
        buildPendleDirectCanaryCandidate(sdkMarketTokens ? { ...market, sdkMarketTokens } : market, { chainId, now }) ||
          candidate,
      );
    }
  }
  candidates.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return candidates;
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

function directCanaryScore(candidate = {}) {
  let score = 0;
  if (FAMILY_TO_STRATEGY[candidate.family]) score += 20;
  if (Number.isFinite(candidate.tvlUsd) && candidate.tvlUsd >= 1_000_000) score += 10;
  if (candidate.maturity && candidate.exitQuote) score += 10;
  if (["base", "bsc", "avalanche", "sonic"].includes(candidate.chain)) score += 10;
  if (["stable_fixed_yield", "btc_fixed_yield", "eth_fixed_yield"].includes(candidate.family)) score += 5;
  return Math.round(score * 100) / 100;
}

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
    score: directCanaryScore(candidate),
    mappedStrategyId: FAMILY_TO_STRATEGY[candidate.family] || "pendle-yt-canary",
    executionSurface: "fixedYield",
    pendleInstrument: "yt",
    protocolBinding: candidate.protocolBinding,
    tokenSymbols: [candidate.assetSymbol].filter(Boolean),
    entryTokenSymbols: [candidate.assetSymbol].filter(Boolean),
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
  return candidates.map((c) => pendleDirectCandidateToOpportunity(c, options)).filter((o) => o != null);
}

export { findPendleMarket, resolvePendleMerklBinding };
