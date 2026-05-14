import {
  MERKL_OPPORTUNITY_POLICY,
  chainEligibleForEntry,
  minTvlForFamily,
  selectMerklOpportunityPolicy,
} from "../config/merkl-opportunity-policy.mjs";

function bandFromApr(aprPct, thresholds = {}) {
  if (!Number.isFinite(aprPct)) return "low";
  if (aprPct >= (thresholds.ultra ?? Number.POSITIVE_INFINITY)) return "ultra";
  if (aprPct >= (thresholds.high ?? Number.POSITIVE_INFINITY)) return "high";
  if (aprPct >= (thresholds.mid ?? Number.POSITIVE_INFINITY)) return "mid";
  return "low";
}

function executionSurfaceSupported(surface, policy) {
  if (surface === "lending") return policy.entry.supportedExecutionSurfaces.lending;
  if (surface === "stableBorrow") return policy.entry.supportedExecutionSurfaces.stableBorrow;
  if (surface === "clLp") return policy.entry.supportedExecutionSurfaces.clLp;
  if (surface === "managedVault") return policy.entry.supportedExecutionSurfaces.managedVault;
  if (surface === "ethLending") return policy.entry.supportedExecutionSurfaces.ethLending;
  if (surface === "stableCarry") return policy.entry.supportedExecutionSurfaces.stableCarry;
  if (surface === "fixedYield") return policy.entry.supportedExecutionSurfaces.fixedYield;
  if (surface === "reserveAllocation") return policy.entry.supportedExecutionSurfaces.reserveAllocation;
  if (surface === "assetRotation") return policy.entry.supportedExecutionSurfaces.assetRotation;
  return false;
}

function buildOverfitFlags(opportunity, policy) {
  const flags = [];
  if ((opportunity.liveCampaigns || 0) <= 1) flags.push("single_campaign_surface");
  if (
    Number.isFinite(opportunity.campaignRemainingHours) &&
    opportunity.campaignRemainingHours < policy.entry.minHoursRemainingForScaleUp
  ) {
    flags.push("campaign_window_short_for_scale");
  }
  if (
    Number.isFinite(opportunity.tvlUsd) &&
    Number.isFinite(opportunity.aprPct) &&
    opportunity.tvlUsd < 1_000_000 &&
    opportunity.aprPct >= 20
  ) {
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
  if (!opportunity.btcPaybackCompatible) blockers.push("btc_return_path_not_supported");
  if (opportunity.status !== "LIVE" || (opportunity.liveCampaigns || 0) < policy.entry.minLiveCampaignCount)
    blockers.push("campaign_not_live");
  if (opportunity.family === "non_core_asset") blockers.push("family_not_supported");
  if (policy.entry.hardRejectRewardTokenTypes.some((kind) => opportunity.rewardTokenTypes.includes(kind)))
    blockers.push("point_reward_program");
  if (
    Number.isFinite(opportunity.campaignRemainingHours) &&
    opportunity.campaignRemainingHours < policy.entry.minHoursRemainingForNewEntry
  ) {
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
  if (opportunity.btcPaybackCompatible) score += weights.btcPaybackCompatibility;
  if (opportunity.hasBtcExposure) score += weights.directBtcExposure;
  if (opportunity.hasSupportedAssetExposure) score += weights.coreAssetFamily;
  if (opportunity.mappedStrategyId) score += weights.supportedStrategyMapping;
  if (chainEligibleForEntry(opportunity.chain, policy)) score += weights.chainInCoreScope;
  if (
    Number.isFinite(opportunity.campaignRemainingHours) &&
    opportunity.campaignRemainingHours >= policy.entry.minHoursRemainingForScaleUp
  ) {
    score += weights.sufficientDuration;
  }
  if (Number.isFinite(opportunity.tvlUsd) && opportunity.tvlUsd >= minTvlForFamily(opportunity.family, policy)) {
    score += weights.sufficientTvl;
  }
  const aprBand = bandFromApr(opportunity.aprPct, weights.aprBandThresholds);
  score += weights.aprBandPoints?.[aprBand] ?? 0;
  if (Number.isFinite(opportunity.nativeAprPct)) score += weights.nativeYieldKnown;
  if (!opportunity.hasPointRewards) score += weights.rewardTokenIsTransferable;

  if ((opportunity.liveCampaigns || 0) <= 1) score -= weights.singleCampaignPenalty;
  if (
    Number.isFinite(opportunity.campaignRemainingHours) &&
    opportunity.campaignRemainingHours < policy.entry.minHoursRemainingForScaleUp
  ) {
    score -= weights.shortDurationPenalty;
  }
  if (overfitFlags.includes("incentive_dominant")) score -= weights.incentiveDominancePenalty;
  if (overfitFlags.includes("low_tvl_high_apr")) score -= weights.lowTvlHighAprPenalty;
  if (opportunity.managedVault) score -= weights.managedVaultPenalty;
  if (watchReasons.includes("execution_surface_not_wired")) score -= weights.unsupportedExecutionSurfacePenalty;
  if (opportunity.operatorHold) score -= weights.operatorHoldPenalty;
  score -= hardBlockers.length * 20;
  score -= watchReasons.length * 6;
  return Math.max(0, Math.round(score));
}

function overfitRiskLevel(flags = []) {
  if (flags.includes("point_program_dependency") || flags.includes("low_tvl_high_apr")) return "high";
  if (flags.includes("campaign_window_short_for_scale") || flags.includes("incentive_dominant")) return "medium";
  return flags.length ? "low" : "minimal";
}

function operatingCapitalExplicitlyUnavailable(options = {}) {
  return (
    Object.hasOwn(options, "operatingCapitalUsd") &&
    (options.operatingCapitalUsd == null || !Number.isFinite(Number(options.operatingCapitalUsd)))
  );
}

export function evaluateMerklOpportunity(opportunity, options = {}) {
  const { policy, operatingCapitalUsd } = options;
  const resolvedPolicy = policy || selectMerklOpportunityPolicy(operatingCapitalUsd);
  const hardBlockers = hardBlockersForOpportunity(opportunity, resolvedPolicy);
  if (operatingCapitalExplicitlyUnavailable(options)) hardBlockers.push("operating_capital_unavailable");
  const watchReasons = watchReasonsForOpportunity(opportunity, resolvedPolicy);
  const overfitFlags = buildOverfitFlags(opportunity, resolvedPolicy);
  const score = scoreOpportunity(opportunity, { hardBlockers, watchReasons, overfitFlags }, resolvedPolicy);
  const decision = hardBlockers.length > 0 ? "blocked" : watchReasons.length > 0 ? "watch" : "candidate";

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

export function evaluateMerklOpportunities(opportunities = [], { policy, operatingCapitalUsd } = {}) {
  const resolvedPolicy = policy || selectMerklOpportunityPolicy(operatingCapitalUsd);
  return (opportunities || []).map((item) =>
    evaluateMerklOpportunity(item, { policy: resolvedPolicy, operatingCapitalUsd }),
  );
}
