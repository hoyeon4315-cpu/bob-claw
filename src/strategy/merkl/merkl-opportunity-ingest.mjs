import { config } from "../../config/env.mjs";
import { MERKL_OPPORTUNITY_POLICY } from "../../config/merkl-opportunity-policy.mjs";
import { fetchMerklUniverse } from "../../watch/merkl-opportunity-watch.mjs";
import { normalizeMerklOpportunities } from "../merkl-opportunity-normalizer.mjs";

function mapAggressiveOpportunity(opportunity = {}) {
  return {
    ...opportunity,
    remainingHours: opportunity.campaignRemainingHours ?? null,
    incentiveUsdPerDay:
      Number.isFinite(opportunity.incentiveAprPct) && Number.isFinite(opportunity.tvlUsd)
        ? ((opportunity.incentiveAprPct / 100) * opportunity.tvlUsd) / 365
        : 0,
    protocol: opportunity.protocolId || opportunity.protocolName || null,
  };
}

export async function getLatestMerklOpportunities({ limit = 500, now = null } = {}) {
  const universe = await fetchMerklUniverse({
    apiBase: config.merklApiBase,
    opportunityPageSize: MERKL_OPPORTUNITY_POLICY.api.opportunityPageSize,
    campaignPageSize: MERKL_OPPORTUNITY_POLICY.api.campaignPageSize,
    maxOpportunityPages: MERKL_OPPORTUNITY_POLICY.api.maxOpportunityPages,
    maxCampaignPages: MERKL_OPPORTUNITY_POLICY.api.maxCampaignPages,
    timeoutMs: MERKL_OPPORTUNITY_POLICY.api.requestTimeoutMs,
  });

  return normalizeMerklOpportunities(universe.opportunities, {
    campaigns: universe.campaigns,
    now,
  })
    .map(mapAggressiveOpportunity)
    .slice(0, limit);
}
