const ZERO_RAW = "0";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rawBigInt(value) {
  if (value === undefined || value === null || value === "") return 0n;
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

function rawString(value) {
  return rawBigInt(value).toString();
}

function rawUnitsToNumber(value, decimals = 18) {
  const numericDecimals = Number.isInteger(decimals) && decimals >= 0 ? decimals : 18;
  return Number(rawBigInt(value)) / (10 ** numericDecimals);
}

function usdValue(amount, priceUsd) {
  if (!Number.isFinite(amount) || !Number.isFinite(priceUsd)) return null;
  return amount * priceUsd;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function chainKey(chainId) {
  return String(chainId);
}

function chainOptionValue(value, chainId) {
  if (!value) return null;
  return value[chainId] ?? value[chainKey(chainId)] ?? null;
}

function sumNumber(rows = [], field) {
  return rows.reduce((sum, row) => sum + (Number.isFinite(row?.[field]) ? row[field] : 0), 0);
}

function statusFor({ claimableRaw, pendingRaw }) {
  if (claimableRaw > 0n) return "claimable";
  if (pendingRaw > 0n) return "pending";
  return "empty";
}

function normalizeReward(chainEntry = {}, reward = {}, { observedAt }) {
  const token = reward.token || {};
  const tokenDecimals = Number.isInteger(token.decimals) ? token.decimals : 18;
  const tokenPriceUsd = finiteNumber(token.price);
  const amountRaw = rawString(reward.amount);
  const claimedRaw = rawString(reward.claimed);
  const pendingRaw = rawString(reward.pending);
  const claimableRawBigInt = rawBigInt(amountRaw) > rawBigInt(claimedRaw)
    ? rawBigInt(amountRaw) - rawBigInt(claimedRaw)
    : 0n;
  const claimableRaw = claimableRawBigInt.toString();
  const amount = rawUnitsToNumber(amountRaw, tokenDecimals);
  const claimed = rawUnitsToNumber(claimedRaw, tokenDecimals);
  const claimable = rawUnitsToNumber(claimableRaw, tokenDecimals);
  const pending = rawUnitsToNumber(pendingRaw, tokenDecimals);
  const campaignIds = unique(asArray(reward.breakdowns).map((breakdown) =>
    breakdown?.campaignId || breakdown?.campaign?.id || breakdown?.campaign
  ));

  return {
    chainId: finiteNumber(chainEntry.chain?.id ?? reward.chainId ?? token.chainId),
    chainName: chainEntry.chain?.name || reward.chain?.name || null,
    distributionChainId: finiteNumber(reward.distributionChainId ?? token.chainId ?? chainEntry.chain?.id),
    recipient: reward.recipient || null,
    tokenAddress: token.address || null,
    tokenSymbol: token.symbol || null,
    tokenDecimals,
    tokenPriceUsd,
    amountRaw,
    claimedRaw,
    claimableRaw,
    pendingRaw,
    amount,
    claimed,
    claimable,
    pending,
    amountUsd: usdValue(amount, tokenPriceUsd),
    claimedUsd: usdValue(claimed, tokenPriceUsd),
    claimableUsd: usdValue(claimable, tokenPriceUsd),
    pendingUsd: usdValue(pending, tokenPriceUsd),
    root: reward.root || null,
    proofCount: asArray(reward.proofs).length,
    breakdownCount: asArray(reward.breakdowns).length,
    campaignIds,
    isClaimable: claimableRawBigInt > 0n,
    status: statusFor({ claimableRaw: claimableRawBigInt, pendingRaw: rawBigInt(pendingRaw) }),
    observedAt,
  };
}

export function buildMerklUserRewardsUrl({
  apiBase = "https://api.merkl.xyz",
  address,
  chainIds = [],
  reloadChainId = null,
} = {}) {
  if (!address) throw new Error("address is required");
  const base = apiBase.endsWith("/") ? apiBase : `${apiBase}/`;
  const url = new URL(`v4/users/${address}/rewards`, base);
  const chainIdList = asArray(chainIds).filter((chainId) => chainId !== null && chainId !== undefined);
  if (chainIdList.length > 0) url.searchParams.set("chainId", chainIdList.join(","));
  if (reloadChainId !== null && reloadChainId !== undefined) {
    url.searchParams.set("reloadChainId", String(reloadChainId));
  }
  return url.toString();
}

export function normalizeMerklUserRewardsPayload(payload = [], { observedAt = new Date().toISOString() } = {}) {
  return asArray(payload)
    .flatMap((chainEntry) => asArray(chainEntry?.rewards).map((reward) => normalizeReward(chainEntry, reward, { observedAt })))
    .filter((row) => row.chainId !== null && row.tokenAddress)
    .sort((a, b) =>
      (b.claimableUsd || 0) - (a.claimableUsd || 0) ||
      String(a.chainId).localeCompare(String(b.chainId)) ||
      String(a.tokenSymbol || "").localeCompare(String(b.tokenSymbol || ""))
    );
}

function buildClaimPlan(rows = [], {
  minClaimUsd = 0,
  maxClaimCostUsdByChainId = {},
  distributorsByChainId = {},
} = {}) {
  const byChain = new Map();
  for (const row of rows.filter((item) => item?.isClaimable)) {
    const key = chainKey(row.chainId);
    const current = byChain.get(key) || {
      chainId: row.chainId,
      chainName: row.chainName || null,
      claimableUsd: 0,
      pendingUsd: 0,
      rewardCount: 0,
      tokenSymbols: [],
    };
    current.claimableUsd += Number.isFinite(row.claimableUsd) ? row.claimableUsd : 0;
    current.pendingUsd += Number.isFinite(row.pendingUsd) ? row.pendingUsd : 0;
    current.rewardCount += 1;
    if (row.tokenSymbol && !current.tokenSymbols.includes(row.tokenSymbol)) current.tokenSymbols.push(row.tokenSymbol);
    byChain.set(key, current);
  }

  const chains = [...byChain.values()].map((chain) => {
    const distributorAddress = chainOptionValue(distributorsByChainId, chain.chainId);
    const estimatedClaimCostUsd = finiteNumber(chainOptionValue(maxClaimCostUsdByChainId, chain.chainId));
    const blockers = [];
    if (chain.claimableUsd < minClaimUsd) blockers.push("claimable_below_min_usd");
    if (!distributorAddress) blockers.push("distributor_address_missing");
    if (Number.isFinite(estimatedClaimCostUsd) && estimatedClaimCostUsd >= chain.claimableUsd) {
      blockers.push("claim_cost_exceeds_claimable");
    }
    return {
      ...chain,
      status: blockers.length > 0 ? "blocked" : "ready",
      distributorAddress: distributorAddress || null,
      estimatedClaimCostUsd,
      blockers,
    };
  }).sort((a, b) =>
    (a.status === "ready" ? -1 : 1) - (b.status === "ready" ? -1 : 1) ||
    (b.claimableUsd || 0) - (a.claimableUsd || 0) ||
    String(a.chainId).localeCompare(String(b.chainId))
  );

  const readyChains = chains.filter((chain) => chain.status === "ready");
  const blockedChains = chains.filter((chain) => chain.status === "blocked");
  return {
    status: readyChains.length > 0 ? "ready" : blockedChains.length > 0 ? "blocked" : "empty",
    readyChainCount: readyChains.length,
    blockedChainCount: blockedChains.length,
    totalReadyClaimableUsd: sumNumber(readyChains, "claimableUsd"),
    chains,
  };
}

export function summarizeMerklUserRewards(rows = [], options = {}) {
  const byChain = {};
  for (const row of rows) {
    const key = chainKey(row.chainId);
    const current = byChain[key] || {
      chainId: row.chainId,
      chainName: row.chainName || null,
      rewardCount: 0,
      claimableRewardCount: 0,
      totalClaimableUsd: 0,
      totalPendingUsd: 0,
    };
    current.rewardCount += 1;
    if (row.isClaimable) current.claimableRewardCount += 1;
    current.totalClaimableUsd += Number.isFinite(row.claimableUsd) ? row.claimableUsd : 0;
    current.totalPendingUsd += Number.isFinite(row.pendingUsd) ? row.pendingUsd : 0;
    byChain[key] = current;
  }

  return {
    rewardCount: rows.length,
    claimableRewardCount: rows.filter((row) => row.isClaimable).length,
    totalClaimableUsd: sumNumber(rows, "claimableUsd"),
    totalPendingUsd: sumNumber(rows, "pendingUsd"),
    byChain: Object.fromEntries(Object.entries(byChain).sort(([left], [right]) => Number(left) - Number(right))),
    claimPlan: buildClaimPlan(rows, options),
  };
}

function sliceStatus(summary = {}) {
  if ((summary.rewardCount || 0) <= 0) return "empty";
  if (summary.claimPlan?.readyChainCount > 0) return "claim_ready";
  if ((summary.claimableRewardCount || 0) > 0) return "claim_blocked";
  if ((summary.totalPendingUsd || 0) > 0) return "pending";
  return "empty";
}

export function buildMerklUserRewardsSlice(rows = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const summary = summarizeMerklUserRewards(rows, options);
  const topRewards = [...rows]
    .sort((a, b) => (b.claimableUsd || 0) - (a.claimableUsd || 0))
    .slice(0, options.limit || 5)
    .map((row) => ({
      chainId: row.chainId,
      chainName: row.chainName,
      tokenAddress: row.tokenAddress,
      tokenSymbol: row.tokenSymbol,
      tokenPriceUsd: row.tokenPriceUsd,
      claimable: row.claimable,
      pending: row.pending,
      claimableUsd: row.claimableUsd,
      pendingUsd: row.pendingUsd,
      proofCount: row.proofCount,
      campaignIds: row.campaignIds,
      observedAt: row.observedAt,
    }));

  return {
    schemaVersion: 1,
    generatedAt,
    observedAt: rows[0]?.observedAt || null,
    source: "merkl_user_rewards",
    status: sliceStatus(summary),
    ...summary,
    topRewards,
  };
}

export function emptyMerklUserRewardsSlice({ generatedAt = new Date().toISOString(), observedAt = null } = {}) {
  return {
    schemaVersion: 1,
    generatedAt,
    observedAt,
    source: "merkl_user_rewards",
    status: "empty",
    rewardCount: 0,
    claimableRewardCount: 0,
    totalClaimableUsd: 0,
    totalPendingUsd: 0,
    byChain: {},
    claimPlan: {
      status: "empty",
      readyChainCount: 0,
      blockedChainCount: 0,
      totalReadyClaimableUsd: 0,
      chains: [],
    },
    topRewards: [],
  };
}

export const EMPTY_MERKL_USER_REWARD_ROW = Object.freeze({
  amountRaw: ZERO_RAW,
  claimedRaw: ZERO_RAW,
  claimableRaw: ZERO_RAW,
  pendingRaw: ZERO_RAW,
});
