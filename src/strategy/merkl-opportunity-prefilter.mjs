import { MERKL_OPPORTUNITY_POLICY, chainEligibleForEntry, minTvlForFamily } from "../config/merkl-opportunity-policy.mjs";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function executionSurfaceSupported(surface, policy) {
  if (surface === "lending") return policy.entry.supportedExecutionSurfaces.lending;
  if (surface === "stableBorrow") return policy.entry.supportedExecutionSurfaces.stableBorrow;
  if (surface === "clLp") return policy.entry.supportedExecutionSurfaces.clLp;
  if (surface === "managedVault") return policy.entry.supportedExecutionSurfaces.managedVault;
  return false;
}

function buildOverfitFlags(opportunity, policy) {
  const flags = [];
  if ((opportunity.liveCampaigns || 0) <= 1) flags.push("single_campaign_surface");
  if (Number.isFinite(opportunity.campaignRemainingHours) && opportunity.campaignRemainingHours < policy.entry.minHoursRemainingForScaleUp) {
    flags.push("campaign_window_short_for_scale");
  }
  if (Number.isFinite(opportunity.tvlUsd) && Number.isFinite(opportunity.aprPct) && opportunity.tvlUsd < 1_000_000 && opportunity.aprPct >= 20) {
    flags.push("low_tvl_high_apr");
  }
  if (opportunity.hasPointRewards) flags.push("point_program_dependency");
  if (opportunity.nativeAprPct == null && Number.isFinite(opportunity.aprPct) && opportunity.aprPct >= 5) {
    flags.push("native_yield_unmeasured");
  }
  if (Number.isFinite(opportunity.incentiveAprPct) && Number.isFinite(opportunity.aprPct) && opportunity.aprPct > 0) {
    const share = opportunity.incentiveAprPct / opportunity.aprPct;
    if (share >= 0.7) flags.push("incentive_dominant");
  }
  return flags;
}

function hardBlockersForOpportunity(opportunity, policy) {
  const blockers = [];
  if (!opportunity.hasBtcExposure) blockers.push("non_btc_surface");
  if (opportunity.status !== "LIVE" || (opportunity.liveCampaigns || 0) < policy.entry.minLiveCampaignCount) blockers.push("campaign_not_live");
  if (opportunity.family === "non_btc") blockers.push("family_not_supported");
  if (policy.entry.hardRejectRewardTokenTypes.some((kind) => opportunity.rewardTokenTypes.includes(kind))) blockers.push("point_reward_program");
  if (Number.isFinite(opportunity.campaignRemainingHours) && opportunity.campaignRemainingHours < policy.entry.minHoursRemainingForNewEntry) {
    blockers.push("campaign_too_close_to_end");
  }
  if (Number.isFinite(opportunity.tvlUsd) && opportunity.tvlUsd < minTvlForFamily(opportunity.family, policy)) {
    blockers.push("tvl_below_family_floor");
  }
  return blockers;
}

function watchReasonsForOpportunity(opportunity, policy) {
  const reasons = [];
  if (!chainEligibleForEntry(opportunity.chain, policy)) reasons.push("chain_out_of_core_scope");
  if (!opportunity.mappedStrategyId) reasons.push("no_existing_strategy_mapping");
  if (!executionSurfaceSupported(opportunity.executionSurface, policy)) reasons.push("execution_surface_not_wired");
  if (opportunity.managedVault) reasons.push("managed_vault_transparency_gap");
  if (opportunity.requiresRangeManagement) reasons.push("range_management_required");
  if (opportunity.operatorHold) reasons.push("operator_hold");
  return reasons;
}

function scoreOpportunity(opportunity, { hardBlockers = [], watchReasons = [], overfitFlags = [] } = {}, policy) {
  const weights = policy.scoring;
  let score = 0;
  if (opportunity.hasBtcExposure) score += weights.btcDirectness;
  if (opportunity.mappedStrategyId) score += weights.supportedStrategyMapping;
  if (chainEligibleForEntry(opportunity.chain, policy)) score += weights.chainInCoreScope;
  if (Number.isFinite(opportunity.campaignRemainingHours) && opportunity.campaignRemainingHours >= policy.entry.minHoursRemainingForScaleUp) {
    score += weights.sufficientDuration;
  }
  if (Number.isFinite(opportunity.tvlUsd) && opportunity.tvlUsd >= minTvlForFamily(opportunity.family, policy)) {
    score += weights.sufficientTvl;
  }
  if (Number.isFinite(opportunity.nativeAprPct)) score += weights.nativeYieldKnown;
  if (!opportunity.hasPointRewards) score += weights.rewardTokenIsTransferable;

  if ((opportunity.liveCampaigns || 0) <= 1) score -= weights.singleCampaignPenalty;
  if (Number.isFinite(opportunity.campaignRemainingHours) && opportunity.campaignRemainingHours < policy.entry.minHoursRemainingForScaleUp) {
    score -= weights.shortDurationPenalty;
  }
  if (overfitFlags.includes("incentive_dominant")) score -= weights.incentiveDominancePenalty;
  if (overfitFlags.includes("low_tvl_high_apr")) score -= weights.lowTvlHighAprPenalty;
  if (opportunity.managedVault) score -= weights.managedVaultPenalty;
  if (watchReasons.includes("execution_surface_not_wired")) score -= weights.unsupportedExecutionSurfacePenalty;
  if (opportunity.operatorHold) score -= weights.operatorHoldPenalty;
  score -= hardBlockers.length * 20;
  score -= watchReasons.length * 6;
  return clamp(Math.round(score), 0, 100);
}

function overfitRiskLevel(flags = []) {
  if (flags.includes("point_program_dependency") || flags.includes("low_tvl_high_apr")) return "high";
  if (flags.includes("campaign_window_short_for_scale") || flags.includes("incentive_dominant")) return "medium";
  return flags.length ? "low" : "minimal";
}

export function evaluateMerklOpportunity(opportunity, { policy = MERKL_OPPORTUNITY_POLICY } = {}) {
  const hardBlockers = hardBlockersForOpportunity(opportunity, policy);
  const watchReasons = watchReasonsForOpportunity(opportunity, policy);
  const overfitFlags = buildOverfitFlags(opportunity, policy);
  const score = scoreOpportunity(opportunity, { hardBlockers, watchReasons, overfitFlags }, policy);
  const decision =
    hardBlockers.length > 0 ? "blocked" : watchReasons.length > 0 ? "watch" : "candidate";

  return {
    ...opportunity,
    decision,
    hardBlockers,
    watchReasons,
    overfitFlags,
    overfitRisk: overfitRiskLevel(overfitFlags),
    score,
    validationMode: decision === "candidate" ? "tiny_live_canary_only" : "research_only",
    dryRunRole: "preflight_only",
  };
}

export function evaluateMerklOpportunities(opportunities = [], { policy = MERKL_OPPORTUNITY_POLICY } = {}) {
  return (opportunities || []).map((item) => evaluateMerklOpportunity(item, { policy }));
}
