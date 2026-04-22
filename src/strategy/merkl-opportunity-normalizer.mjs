const BTC_SYMBOL_RE = /(btc|cbbtc|wbtc|wbtc\.oft|lbtc|unibtc|ebtc|fbtc|solvbtc|btcb|btc\.b|xsolvbtc)/i;
const STABLE_SYMBOL_RE = /^(usdc|usdt|usd0|usd₮0|usdc\.e|usdt\.e|dai|eurc|gho|rlusd|pyusd|usde|usds|ausd|usdt0|usdt0\.0|ousdt)$/i;
const MANAGED_VAULT_PROTOCOLS = new Set(["superform", "ichi"]);
const DIRECT_LENDING_PROTOCOLS = new Set(["morpho", "aave", "euler", "moonwell", "venus", "bend", "avalon", "benqi"]);
const OPERATOR_HELD_STRATEGIES = new Set(["recursive_wrapped_btc_lending_loop"]);

const CHAIN_NAME_MAP = Object.freeze({
  ethereum: "ethereum",
  base: "base",
  bob: "bob",
  "bnb chain": "bsc",
  bnb: "bsc",
  avalanche: "avalanche",
  berachain: "bera",
  optimism: "optimism",
  sei: "sei",
  soneium: "soneium",
  sonic: "sonic",
  unichain: "unichain",
  "world chain": "world_chain",
  mantle: "mantle",
  monad: "monad",
  polygon: "polygon",
  arbitrum: "arbitrum",
  linea: "linea",
  ink: "ink",
  etherlink: "etherlink",
  plasma: "plasma",
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function unixSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function canonicalChainName(chainName = "") {
  const normalized = lower(chainName);
  return CHAIN_NAME_MAP[normalized] || normalized.replace(/\s+/g, "_");
}

function tokenSymbolsFromOpportunity(opportunity = {}) {
  return unique([
    ...(opportunity.tokens || []).map((token) => token?.displaySymbol || token?.symbol),
    ...((opportunity.rewardsRecord?.breakdowns || []).map((item) => item?.token?.displaySymbol || item?.token?.symbol)),
  ]);
}

function rewardTokenTypes(opportunity = {}, campaigns = []) {
  return unique([
    ...((opportunity.rewardsRecord?.breakdowns || []).map((item) => item?.token?.type)),
    ...(campaigns || []).map((item) => item?.rewardToken?.type),
  ]);
}

function rewardTokenSymbols(opportunity = {}, campaigns = []) {
  return unique([
    ...((opportunity.rewardsRecord?.breakdowns || []).map((item) => item?.token?.displaySymbol || item?.token?.symbol)),
    ...(campaigns || []).map((item) => item?.rewardToken?.symbol),
  ]);
}

function activeCampaignsForOpportunity(campaigns = [], nowSeconds) {
  return (campaigns || []).filter((item) => {
    const start = unixSeconds(item?.startTimestamp);
    const end = unixSeconds(item?.endTimestamp);
    return start && end && start <= nowSeconds && end >= nowSeconds;
  });
}

function latestCampaignEnd(opportunity = {}, campaigns = [], nowSeconds) {
  const activeCampaigns = activeCampaignsForOpportunity(campaigns, nowSeconds);
  const activeEnds = activeCampaigns.map((item) => unixSeconds(item?.endTimestamp)).filter(Boolean);
  if (activeEnds.length > 0) return Math.max(...activeEnds);
  return unixSeconds(opportunity.latestCampaignEnd);
}

function hasBtcExposure(tokenSymbols = [], text = "") {
  return tokenSymbols.some((symbol) => BTC_SYMBOL_RE.test(symbol)) || BTC_SYMBOL_RE.test(text);
}

function hasStableExposure(tokenSymbols = [], text = "") {
  return tokenSymbols.some((symbol) => STABLE_SYMBOL_RE.test(symbol)) || /\beurc\b/i.test(text);
}

function managedVaultLike({ opportunity = {}, protocolId = "", text = "" } = {}) {
  if (MANAGED_VAULT_PROTOCOLS.has(protocolId)) return true;
  if (["morpho", "aave", "euler"].includes(protocolId) && lower(opportunity.action) === "borrow") return false;
  return /\bvault\b/i.test(text) && !DIRECT_LENDING_PROTOCOLS.has(protocolId);
}

function classifyFamily({ action = "", protocolId = "", tokenSymbols = [], text = "", managedVault = false } = {}) {
  const upperAction = String(action || "").toUpperCase();
  const btc = hasBtcExposure(tokenSymbols, text);
  const stable = hasStableExposure(tokenSymbols, text);
  const lpLike = /liquidity|pool|amm|clamm|uniswap|quickswap|sushiswap|aerodrome|hydrex/i.test(text);

  if (!btc) return "non_btc";
  if (upperAction === "BORROW" && stable) return "btc_collateral_stable_borrow";
  if (managedVault) return "managed_btc_vault";
  if (lpLike) return "stable_btc_lp";
  if ((upperAction === "LEND" || upperAction === "SUPPLY" || upperAction === "HOLD") && !stable) return "wrapped_btc_lending";
  return "btc_misc";
}

function mapToStrategy({ family = "", protocolId = "", chain = "" } = {}) {
  if (family === "btc_collateral_stable_borrow" && ["morpho", "aave", "euler"].includes(protocolId)) {
    return { strategyId: "recursive_stablecoin_lending_loop", executionSurface: "stableBorrow" };
  }
  if (family === "wrapped_btc_lending" && DIRECT_LENDING_PROTOCOLS.has(protocolId)) {
    return { strategyId: "recursive_wrapped_btc_lending_loop", executionSurface: "lending" };
  }
  if (family === "stable_btc_lp" && protocolId === "aerodrome" && chain === "base") {
    return { strategyId: "aerodrome-cl-base", executionSurface: "clLp" };
  }
  return { strategyId: null, executionSurface: family === "stable_btc_lp" ? "clLp" : managedVaultLike ? "managedVault" : "unknown" };
}

export function normalizeMerklOpportunity(opportunity = {}, { campaignsByOpportunity = new Map(), now = null } = {}) {
  const observedAt = now || new Date().toISOString();
  const nowMs = new Date(observedAt).getTime();
  const nowSeconds = Math.floor(nowMs / 1000);
  const chain = canonicalChainName(opportunity?.chain?.name || "");
  const protocolId = lower(opportunity?.protocol?.id || opportunity?.protocol?.name);
  const tokenSymbols = tokenSymbolsFromOpportunity(opportunity);
  const relatedCampaigns = campaignsByOpportunity.get(String(opportunity?.id || "")) || [];
  const rewardTypes = rewardTokenTypes(opportunity, relatedCampaigns);
  const rewardSymbols = rewardTokenSymbols(opportunity, relatedCampaigns);
  const text = [opportunity?.name, opportunity?.description, protocolId, opportunity?.type].filter(Boolean).join(" ");
  const managedVault = managedVaultLike({ opportunity, protocolId, text });
  const family = classifyFamily({
    action: opportunity?.action,
    protocolId,
    tokenSymbols,
    text,
    managedVault,
  });
  const mapping = mapToStrategy({ family, protocolId, chain });
  const latestEnd = latestCampaignEnd(opportunity, relatedCampaigns, nowSeconds);
  const remainingHours = latestEnd ? Math.round((((latestEnd * 1000) - nowMs) / 3_600_000) * 100) / 100 : null;
  const aprPct = finite(opportunity?.apr);
  const nativeAprPct = finite(opportunity?.nativeAprRecord?.value);
  const incentiveAprPct =
    aprPct != null && nativeAprPct != null
      ? Math.max(0, Math.round((aprPct - nativeAprPct) * 100) / 100)
      : null;

  return {
    source: "merkl",
    observedAt,
    opportunityId: String(opportunity?.id || ""),
    chainId: opportunity?.chainId ?? null,
    chain,
    protocolId,
    protocolName: opportunity?.protocol?.name || null,
    type: opportunity?.type || null,
    action: opportunity?.action || null,
    name: opportunity?.name || null,
    description: opportunity?.description || null,
    status: opportunity?.status || null,
    liveCampaigns: Number(opportunity?.liveCampaigns || 0),
    tokenSymbols,
    rewardTokenSymbols: rewardSymbols,
    rewardTokenTypes: rewardTypes,
    hasPointRewards: rewardTypes.includes("POINT"),
    hasBtcExposure: hasBtcExposure(tokenSymbols, text),
    hasStableExposure: hasStableExposure(tokenSymbols, text),
    family,
    managedVault,
    requiresRangeManagement: family === "stable_btc_lp",
    mappedStrategyId: mapping.strategyId,
    executionSurface: mapping.executionSurface,
    operatorHold: OPERATOR_HELD_STRATEGIES.has(mapping.strategyId),
    tvlUsd: finite(opportunity?.tvl),
    aprPct,
    nativeAprPct,
    incentiveAprPct,
    latestCampaignEnd: latestEnd,
    campaignRemainingHours: remainingHours,
  };
}

export function normalizeMerklOpportunities(opportunities = [], { campaigns = [], now = null } = {}) {
  const campaignsByOpportunity = new Map();
  for (const campaign of campaigns || []) {
    const key = String(campaign?.opportunityId || campaign?.Opportunity?.id || "");
    if (!key) continue;
    const bucket = campaignsByOpportunity.get(key) || [];
    bucket.push(campaign);
    campaignsByOpportunity.set(key, bucket);
  }
  return (opportunities || []).map((item) => normalizeMerklOpportunity(item, { campaignsByOpportunity, now }));
}
