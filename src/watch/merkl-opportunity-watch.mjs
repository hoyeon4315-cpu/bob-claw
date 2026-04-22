import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function unixSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function hoursUntil(endTimestamp, nowMs) {
  const endSeconds = unixSeconds(endTimestamp);
  if (!endSeconds) return null;
  return Math.round((((endSeconds * 1000) - nowMs) / 3_600_000) * 100) / 100;
}

function summarizeOpportunity(item, nowMs) {
  return {
    id: String(item?.id || ""),
    chainId: item?.chainId ?? null,
    chainName: item?.chain?.name || null,
    protocol: item?.protocol?.id || item?.protocol?.name || null,
    type: item?.type || null,
    action: item?.action || null,
    status: item?.status || null,
    liveCampaigns: Number(item?.liveCampaigns || 0),
    tvl: finite(item?.tvl),
    apr: finite(item?.apr),
    nativeApr: finite(item?.nativeAprRecord?.value),
    earliestCampaignEnd: unixSeconds(item?.earliestCampaignEnd),
    latestCampaignEnd: unixSeconds(item?.latestCampaignEnd),
    hoursRemaining: hoursUntil(item?.latestCampaignEnd, nowMs),
  };
}

function summarizeCampaign(item) {
  return {
    id: String(item?.id || ""),
    opportunityId: String(item?.opportunityId || item?.Opportunity?.id || ""),
    campaignId: item?.campaignId || null,
    type: item?.type || null,
    creatorAddress: item?.creatorAddress || null,
    startTimestamp: unixSeconds(item?.startTimestamp),
    endTimestamp: unixSeconds(item?.endTimestamp),
    distributionChainId: item?.distributionChainId ?? null,
    rewardTokenType: item?.rewardToken?.type || null,
    rewardTokenSymbol: item?.rewardToken?.symbol || null,
    status: item?.campaignStatus?.status || null,
  };
}

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Merkl API ${response.status} for ${url}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

async function fetchPaginatedEndpoint({
  apiBase,
  path,
  itemsPerPage,
  maxPages,
  extraQuery = "",
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  const pages = [];
  for (let page = 0; page < maxPages; page += 1) {
    const separator = extraQuery ? "&" : "";
    const url = `${apiBase}${path}?items=${itemsPerPage}&page=${page}${separator}${extraQuery}`;
    const batch = await fetchJson(url, { fetchImpl, timeoutMs });
    if (!Array.isArray(batch) || batch.length === 0) break;
    pages.push(...batch);
    if (batch.length < itemsPerPage) break;
  }
  return pages;
}

function countsBy(items, selector) {
  return (items || []).reduce((acc, item) => {
    const key = selector(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function summarizeForHash(items = []) {
  return items
    .map((item) => JSON.stringify(item))
    .sort()
    .join("\n");
}

export async function fetchMerklUniverse({
  apiBase,
  opportunityPageSize,
  campaignPageSize,
  maxOpportunityPages,
  maxCampaignPages,
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  const [opportunities, campaigns] = await Promise.all([
    fetchPaginatedEndpoint({
      apiBase,
      path: "/v4/opportunities",
      itemsPerPage: opportunityPageSize,
      maxPages: maxOpportunityPages,
      fetchImpl,
      timeoutMs,
    }),
    fetchPaginatedEndpoint({
      apiBase,
      path: "/v4/campaigns",
      itemsPerPage: campaignPageSize,
      maxPages: maxCampaignPages,
      extraQuery: "withOpportunity=true",
      fetchImpl,
      timeoutMs,
    }),
  ]);
  return { opportunities, campaigns };
}

export function buildMerklUniverseSnapshot({ opportunities = [], campaigns = [], now = null } = {}) {
  const observedAt = now || new Date().toISOString();
  const nowMs = new Date(observedAt).getTime();
  const opportunityItems = opportunities.map((item) => summarizeOpportunity(item, nowMs));
  const campaignItems = campaigns.map(summarizeCampaign);
  const expiringSoonIds = opportunityItems
    .filter((item) => item.liveCampaigns > 0 && Number.isFinite(item.hoursRemaining) && item.hoursRemaining <= 48 && item.hoursRemaining >= 0)
    .map((item) => item.id)
    .sort();

  return {
    observedAt,
    opportunityCount: opportunityItems.length,
    campaignCount: campaignItems.length,
    liveOpportunityCount: opportunityItems.filter((item) => item.status === "LIVE" && item.liveCampaigns > 0).length,
    expiringSoonCount: expiringSoonIds.length,
    expiringSoonIds,
    opportunities: opportunityItems.sort((left, right) => left.id.localeCompare(right.id)),
    campaigns: campaignItems.sort((left, right) => left.id.localeCompare(right.id)),
    chains: Object.keys(countsBy(opportunityItems, (item) => item.chainName)).sort(),
    protocols: Object.keys(countsBy(opportunityItems, (item) => item.protocol)).sort(),
    opportunityHash: sha256(summarizeForHash(opportunityItems)),
    campaignHash: sha256(summarizeForHash(campaignItems)),
  };
}

function diffIds(previousItems = [], currentItems = []) {
  const previous = new Set(previousItems);
  const current = new Set(currentItems);
  return {
    added: [...current].filter((item) => !previous.has(item)).sort(),
    removed: [...previous].filter((item) => !current.has(item)).sort(),
  };
}

export function diffMerklUniverseSnapshots(previous = null, current = null) {
  if (!previous) {
    return {
      changed: true,
      reason: "initial_snapshot",
      addedOpportunityIds: current?.opportunities?.map((item) => item.id) || [],
      removedOpportunityIds: [],
      statusChangedIds: [],
      newlyExpiringIds: current?.expiringSoonIds || [],
      noLongerExpiringIds: [],
      newlyLiveIds: current?.opportunities?.filter((item) => item.status === "LIVE" && item.liveCampaigns > 0).map((item) => item.id) || [],
      endedIds: [],
    };
  }

  const previousById = new Map((previous.opportunities || []).map((item) => [item.id, item]));
  const currentById = new Map((current.opportunities || []).map((item) => [item.id, item]));
  const sharedIds = [...currentById.keys()].filter((id) => previousById.has(id)).sort();
  const statusChangedIds = sharedIds.filter((id) => {
    const left = previousById.get(id);
    const right = currentById.get(id);
    return left.status !== right.status || left.liveCampaigns !== right.liveCampaigns;
  });
  const aprMovedIds = sharedIds.filter((id) => {
    const left = previousById.get(id);
    const right = currentById.get(id);
    const leftApr = Number(left.apr || 0);
    const rightApr = Number(right.apr || 0);
    return Math.abs(rightApr - leftApr) >= 5;
  });
  const tvlMovedIds = sharedIds.filter((id) => {
    const left = previousById.get(id);
    const right = currentById.get(id);
    const leftTvl = Number(left.tvl || 0);
    const rightTvl = Number(right.tvl || 0);
    if (leftTvl <= 0 || rightTvl <= 0) return false;
    return Math.abs(rightTvl - leftTvl) / Math.max(leftTvl, rightTvl) >= 0.3;
  });
  const expiringDiff = diffIds(previous.expiringSoonIds || [], current.expiringSoonIds || []);
  const opportunityDiff = diffIds(
    (previous.opportunities || []).map((item) => item.id),
    (current.opportunities || []).map((item) => item.id),
  );
  const newlyLiveIds = sharedIds.filter((id) => {
    const left = previousById.get(id);
    const right = currentById.get(id);
    return !(left.status === "LIVE" && left.liveCampaigns > 0) && right.status === "LIVE" && right.liveCampaigns > 0;
  });
  const endedIds = sharedIds.filter((id) => {
    const left = previousById.get(id);
    const right = currentById.get(id);
    return left.status === "LIVE" && left.liveCampaigns > 0 && !(right.status === "LIVE" && right.liveCampaigns > 0);
  });

  return {
    changed:
      previous.opportunityHash !== current.opportunityHash ||
      previous.campaignHash !== current.campaignHash,
    reason: "comparison",
    addedOpportunityIds: opportunityDiff.added,
    removedOpportunityIds: opportunityDiff.removed,
    statusChangedIds,
    aprMovedIds,
    tvlMovedIds,
    newlyExpiringIds: expiringDiff.added,
    noLongerExpiringIds: expiringDiff.removed,
    newlyLiveIds,
    endedIds,
  };
}

export async function runMerklOpportunityWatch({
  apiBase,
  opportunityPageSize,
  campaignPageSize,
  maxOpportunityPages,
  maxCampaignPages,
  previousSnapshot = null,
  now = null,
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  const observedAt = now || new Date().toISOString();
  const universe = await fetchMerklUniverse({
    apiBase,
    opportunityPageSize,
    campaignPageSize,
    maxOpportunityPages,
    maxCampaignPages,
    fetchImpl,
    timeoutMs,
  });
  const snapshot = buildMerklUniverseSnapshot({
    opportunities: universe.opportunities,
    campaigns: universe.campaigns,
    now: observedAt,
  });
  const diff = diffMerklUniverseSnapshots(previousSnapshot, snapshot);
  return {
    observedAt,
    snapshot,
    diff,
    updateDetected: Boolean(diff.changed),
    rawCounts: {
      opportunities: universe.opportunities.length,
      campaigns: universe.campaigns.length,
    },
    opportunities: universe.opportunities,
    campaigns: universe.campaigns,
  };
}
