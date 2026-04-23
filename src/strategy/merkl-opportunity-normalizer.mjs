const BTC_SYMBOL_RE = /(btc|cbbtc|wbtc|wbtc\.oft|lbtc|unibtc|ebtc|fbtc|solvbtc|btcb|btc\.b|xsolvbtc)/i;
const STABLE_SYMBOL_RE = /^(usdc|usdt|usd0|usd₮0|usdc\.e|usdt\.e|dai|eurc|gho|rlusd|pyusd|usde|usds|ausd|usdt0|usdt0\.0|ousdt)$/i;
const ETH_SYMBOL_RE = /^(eth|weth|weth\.e|steth|wsteth|cbeth|reth|weeth|ezeth|rseth|meth)$/i;
const GOLD_SYMBOL_RE = /^(paxg|xaut|xau₮)$/i;
const RESERVE_SYMBOL_RE = /^(usdy|bib01|ousg|ustb|buidl|ustbl)$/i;
const OTHER_APPROVED_SYMBOL_RE = /^(sol|wsol|link|uni|aero|pendle|ena|ondo)$/i;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/u;
const MANAGED_VAULT_PROTOCOLS = new Set(["superform", "ichi"]);
import { resolveAaveMarketBinding } from "../defi/aave-market-addresses.mjs";

const DIRECT_LENDING_PROTOCOLS = new Set(["morpho", "aave", "euler", "moonwell", "venus", "bend", "avalon", "benqi"]);
const FIXED_YIELD_PROTOCOLS = new Set(["pendle"]);
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

function isAddress(value) {
  return ADDRESS_RE.test(String(value || "").trim());
}

function sameAddress(left, right) {
  return isAddress(left) && isAddress(right) && String(left).toLowerCase() === String(right).toLowerCase();
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

function tokenDetailsFromOpportunity(opportunity = {}) {
  return (opportunity.tokens || [])
    .filter((token) => token?.address)
    .map((token) => ({
      symbol: token?.displaySymbol || token?.symbol || null,
      address: token?.address || null,
      decimals: Number.isFinite(token?.decimals) ? token.decimals : null,
      verified: token?.verified === true,
      type: token?.type || null,
    }));
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

function hasEthExposure(tokenSymbols = [], text = "") {
  return tokenSymbols.some((symbol) => ETH_SYMBOL_RE.test(symbol)) || /\beth\b|\bweth\b|\bsteth\b|\bwsteth\b/i.test(text);
}

function hasGoldExposure(tokenSymbols = [], text = "") {
  return tokenSymbols.some((symbol) => GOLD_SYMBOL_RE.test(symbol)) || /\bpaxg\b|\bxaut\b/i.test(text);
}

function hasReserveExposure(tokenSymbols = [], text = "") {
  return tokenSymbols.some((symbol) => RESERVE_SYMBOL_RE.test(symbol)) || /\busdy\b|\bbib01\b|\bousg\b|\bbuidl\b/i.test(text);
}

function hasOtherBluechipExposure(tokenSymbols = [], text = "") {
  return (
    tokenSymbols.some((symbol) => OTHER_APPROVED_SYMBOL_RE.test(symbol)) ||
    /\bsol\b|\bwsol\b|\blink\b|\buni\b|\baero\b|\bpendle\b|\bena\b|\bondo\b/i.test(text)
  );
}

function detectAssetFamilies(tokenSymbols = [], text = "") {
  const families = [];
  if (hasBtcExposure(tokenSymbols, text)) families.push("btc_like");
  if (hasEthExposure(tokenSymbols, text)) families.push("eth_like");
  if (hasStableExposure(tokenSymbols, text)) families.push("stablecoin");
  if (hasGoldExposure(tokenSymbols, text)) families.push("tokenized_gold");
  if (hasReserveExposure(tokenSymbols, text)) families.push("tokenized_reserve");
  if (hasOtherBluechipExposure(tokenSymbols, text)) families.push("other_bluechip");
  return unique(families);
}

function managedVaultLike({ opportunity = {}, protocolId = "", text = "" } = {}) {
  if (MANAGED_VAULT_PROTOCOLS.has(protocolId)) return true;
  if (["morpho", "aave", "euler"].includes(protocolId) && lower(opportunity.action) === "borrow") return false;
  return /\bvault\b/i.test(text) && !DIRECT_LENDING_PROTOCOLS.has(protocolId);
}

function classifyFamily({ action = "", protocolId = "", tokenSymbols = [], text = "", assetFamilies = [], managedVault = false } = {}) {
  const upperAction = String(action || "").toUpperCase();
  const btc = assetFamilies.includes("btc_like");
  const eth = assetFamilies.includes("eth_like");
  const stable = assetFamilies.includes("stablecoin");
  const gold = assetFamilies.includes("tokenized_gold");
  const reserve = assetFamilies.includes("tokenized_reserve");
  const bluechip = assetFamilies.includes("other_bluechip");
  const lpLike = /liquidity|pool|amm|clamm|uniswap|quickswap|sushiswap|aerodrome|hydrex/i.test(text);
  const fixedYieldLike = FIXED_YIELD_PROTOCOLS.has(protocolId) || /\bpt[-_\s]|fixed yield|principal token|implied apy/i.test(text);
  const lendingLike = upperAction === "LEND" || upperAction === "SUPPLY" || upperAction === "HOLD";

  if (btc) {
    if (upperAction === "BORROW" && stable) return "btc_collateral_stable_borrow";
    if (managedVault) return "managed_btc_vault";
    if (fixedYieldLike) return "btc_fixed_yield";
    if (lpLike) return "stable_btc_lp";
    if (lendingLike && !stable) return "wrapped_btc_lending";
    return "btc_misc";
  }

  if (eth) {
    if (upperAction === "BORROW" && stable) return "eth_collateral_stable_borrow";
    if (fixedYieldLike) return "eth_fixed_yield";
    if (lendingLike || managedVault) return "eth_destination_lending";
  }

  if (stable) {
    if (fixedYieldLike) return "stable_fixed_yield";
    return "stable_treasury_carry";
  }

  if (gold) return "tokenized_gold_rotation";
  if (reserve) return "tokenized_reserve_sleeve";
  if (bluechip) return "other_bluechip_rotation";
  return "non_core_asset";
}

function mapToStrategy({ family = "", protocolId = "", chain = "", tokenSymbols = [], managedVault = false } = {}) {
  if (family === "btc_collateral_stable_borrow" && ["morpho", "aave", "euler"].includes(protocolId)) {
    return { strategyId: "recursive_stablecoin_lending_loop", executionSurface: "stableBorrow" };
  }
  if (family === "wrapped_btc_lending" && DIRECT_LENDING_PROTOCOLS.has(protocolId)) {
    return { strategyId: "recursive_wrapped_btc_lending_loop", executionSurface: "lending" };
  }
  if (family === "btc_fixed_yield" && protocolId === "pendle" && chain === "base" && tokenSymbols.some((symbol) => /lbtc/i.test(symbol))) {
    return { strategyId: "pendle-pt-lbtc-base", executionSurface: "fixedYield" };
  }
  if (
    family === "btc_fixed_yield" &&
    protocolId === "pendle" &&
    chain === "bsc" &&
    tokenSymbols.some((symbol) => /solvbtc|bbn/i.test(symbol))
  ) {
    return { strategyId: "pendle-pt-solvbtc-bbn-bsc", executionSurface: "fixedYield" };
  }
  if (family === "stable_btc_lp" && protocolId === "aerodrome" && chain === "base") {
    return { strategyId: "aerodrome-cl-base", executionSurface: "clLp" };
  }
  if (["eth_collateral_stable_borrow", "eth_destination_lending", "eth_fixed_yield"].includes(family)) {
    return {
      strategyId: "eth_destination_deployment",
      executionSurface:
        family === "eth_collateral_stable_borrow"
          ? "stableBorrow"
          : family === "eth_fixed_yield"
            ? "fixedYield"
            : "ethLending",
    };
  }
  if (["stable_treasury_carry", "stable_fixed_yield", "other_bluechip_rotation"].includes(family)) {
    return {
      strategyId: "gateway_native_asset_conversion_sleeve",
      executionSurface:
        family === "stable_fixed_yield"
          ? "fixedYield"
          : family === "stable_treasury_carry"
            ? "stableCarry"
            : "assetRotation",
    };
  }
  if (["tokenized_gold_rotation", "tokenized_reserve_sleeve"].includes(family)) {
    return { strategyId: "tokenized_reserve_sleeve", executionSurface: "reserveAllocation" };
  }
  return {
    strategyId: null,
    executionSurface:
      family === "stable_btc_lp"
        ? "clLp"
        : managedVault
          ? "managedVault"
          : family === "non_core_asset"
            ? "unknown"
            : "assetRotation",
  };
}

function tokenLooksLikeUnderlying(token = {}, assetFamilies = []) {
  const symbol = token.symbol || "";
  if (assetFamilies.includes("stablecoin") && STABLE_SYMBOL_RE.test(symbol)) return true;
  if (assetFamilies.includes("eth_like") && ETH_SYMBOL_RE.test(symbol)) return true;
  if (assetFamilies.includes("btc_like") && BTC_SYMBOL_RE.test(symbol)) return true;
  if (assetFamilies.includes("tokenized_gold") && GOLD_SYMBOL_RE.test(symbol)) return true;
  if (assetFamilies.includes("tokenized_reserve") && RESERVE_SYMBOL_RE.test(symbol)) return true;
  if (assetFamilies.includes("other_bluechip") && OTHER_APPROVED_SYMBOL_RE.test(symbol)) return true;
  return token.verified === true;
}

function chooseUnderlyingToken(tokens = [], { explorerAddress = null, assetFamilies = [] } = {}) {
  const candidates = tokens.filter((token) => isAddress(token.address) && !sameAddress(token.address, explorerAddress));
  return (
    candidates.find((token) => token.verified && tokenLooksLikeUnderlying(token, assetFamilies)) ||
    candidates.find((token) => tokenLooksLikeUnderlying(token, assetFamilies)) ||
    candidates.find((token) => token.verified) ||
    candidates[0] ||
    null
  );
}

function choosePositionToken(tokens = [], explorerAddress = null) {
  return tokens.find((token) => sameAddress(token.address, explorerAddress)) || null;
}

function buildProtocolBindingFromOpportunity({ opportunity = {}, protocolId = "", executionSurface = "", assetFamilies = [] } = {}) {
  const explorerAddress = isAddress(opportunity.explorerAddress) ? opportunity.explorerAddress : null;
  const tokens = tokenDetailsFromOpportunity(opportunity);
  const underlyingToken = chooseUnderlyingToken(tokens, { explorerAddress, assetFamilies });
  const positionToken = choosePositionToken(tokens, explorerAddress);

  if (["morpho", "euler", "yo", "summerfinance"].includes(protocolId)) {
    if (!explorerAddress || !underlyingToken?.address || sameAddress(explorerAddress, underlyingToken.address)) return null;
    return {
      source: "merkl_opportunity",
      vaultAddress: explorerAddress,
      assetAddress: underlyingToken.address,
      assetSymbol: underlyingToken.symbol,
      assetDecimals: underlyingToken.decimals,
      shareTokenAddress: positionToken?.address || explorerAddress,
      shareTokenSymbol: positionToken?.symbol || null,
      depositUrl: opportunity.depositUrl || null,
    };
  }

  if (["aave", "yei"].includes(protocolId)) {
    const assetToken = underlyingToken;
    const aToken =
      positionToken ||
      tokens.find((token) => /^a/i.test(token.symbol || "") && !sameAddress(token.address, assetToken?.address)) ||
      null;
    const marketBinding = resolveAaveMarketBinding({
      chain: opportunity?.chain?.name,
      depositUrl: opportunity.depositUrl,
    });
    if (!assetToken?.address && !aToken?.address) return null;
    return {
      source: "merkl_opportunity",
      assetAddress: assetToken?.address || null,
      assetSymbol: assetToken?.symbol || null,
      assetDecimals: assetToken?.decimals ?? null,
      aTokenAddress: aToken?.address || explorerAddress || null,
      aTokenSymbol: aToken?.symbol || null,
      marketName: marketBinding.marketName,
      poolAddress: marketBinding.poolAddress,
      poolAddressProviderAddress: marketBinding.poolAddressProviderAddress,
      depositUrl: opportunity.depositUrl || null,
    };
  }

  return null;
}

export function normalizeMerklOpportunity(opportunity = {}, { campaignsByOpportunity = new Map(), now = null } = {}) {
  const observedAt = now || new Date().toISOString();
  const nowMs = new Date(observedAt).getTime();
  const nowSeconds = Math.floor(nowMs / 1000);
  const chain = canonicalChainName(opportunity?.chain?.name || "");
  const protocolId = lower(opportunity?.protocol?.id || opportunity?.protocol?.name);
  const tokenSymbols = tokenSymbolsFromOpportunity(opportunity);
  const tokenDetails = tokenDetailsFromOpportunity(opportunity);
  const relatedCampaigns = campaignsByOpportunity.get(String(opportunity?.id || "")) || [];
  const rewardTypes = rewardTokenTypes(opportunity, relatedCampaigns);
  const rewardSymbols = rewardTokenSymbols(opportunity, relatedCampaigns);
  const text = [opportunity?.name, opportunity?.description, protocolId, opportunity?.type].filter(Boolean).join(" ");
  const managedVault = managedVaultLike({ opportunity, protocolId, text });
  const assetFamilies = detectAssetFamilies(tokenSymbols, text);
  const family = classifyFamily({
    action: opportunity?.action,
    protocolId,
    tokenSymbols,
    text,
    assetFamilies,
    managedVault,
  });
  const mapping = mapToStrategy({ family, protocolId, chain, tokenSymbols, managedVault });
  const protocolBinding = buildProtocolBindingFromOpportunity({
    opportunity,
    protocolId,
    executionSurface: mapping.executionSurface,
    assetFamilies,
  });
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
    identifier: opportunity?.identifier || null,
    depositUrl: opportunity?.depositUrl || null,
    explorerAddress: isAddress(opportunity?.explorerAddress) ? opportunity.explorerAddress : null,
    status: opportunity?.status || null,
    liveCampaigns: Number(opportunity?.liveCampaigns || 0),
    tokenSymbols,
    tokenDetails,
    rewardTokenSymbols: rewardSymbols,
    rewardTokenTypes: rewardTypes,
    hasPointRewards: rewardTypes.includes("POINT"),
    hasBtcExposure: hasBtcExposure(tokenSymbols, text),
    hasEthExposure: hasEthExposure(tokenSymbols, text),
    hasStableExposure: hasStableExposure(tokenSymbols, text),
    hasGoldExposure: hasGoldExposure(tokenSymbols, text),
    hasReserveExposure: hasReserveExposure(tokenSymbols, text),
    hasOtherBluechipExposure: hasOtherBluechipExposure(tokenSymbols, text),
    assetFamilies,
    hasSupportedAssetExposure: assetFamilies.length > 0,
    btcPaybackCompatible: assetFamilies.length > 0,
    family,
    managedVault,
    requiresRangeManagement: family === "stable_btc_lp",
    mappedStrategyId: mapping.strategyId,
    executionSurface: mapping.executionSurface,
    protocolBinding,
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
