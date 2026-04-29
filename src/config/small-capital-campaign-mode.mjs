// Small-capital campaign-aware operating mode policy.
// Durable rules, not current APR numbers.
// Commit-only changes. Runtime overrides are forbidden by AGENTS.md.

export const SMALL_CAPITAL_CAMPAIGN_MODE = Object.freeze({
  profileId: "small_capital_campaign_mode_v1",
  enabled: true,
  autoMicroTest: true,
  capitalThresholdUsd: 1_000,
  anchorTargetPct: Object.freeze({ min: 0.65, max: 0.80 }),
  opportunisticMaxPct: 0.20,
  microMaxPct: 0.06,
  defaultBudgetsUsd: Object.freeze({
    opportunisticMaxUsd: 80,
    microMaxUsd: 30,
    initialCampaignUsd: 25,
    maxCampaignUsd: 50,
    initialMicroUsd: 10,
    maxMicroUsd: 25,
  }),
  baseFirstChains: Object.freeze(["base", "optimism"]),
  nonBaseEntry: Object.freeze({
    minNetProfitUsd: 10,
    minNetProfitPctOfPosition: 0.05,
  }),
  rewardHaircuts: Object.freeze({
    stable: 0.0,
    liquidBluechip: 0.25,
    defaultRewardToken: 0.50,
    preTgeOrPoints: 0.85,
  }),
  campaignEntry: Object.freeze({
    minHoursRemaining: 24,
    realizedNetBufferUsd: 3,
    maxGasAndClaimPctOfExpectedReward: 0.20,
    aprDecayExitPct: 0.50,
    tvlDrainExitPct: 0.30,
    rewardTokenDropExitPct: 0.25,
  }),
  microEntry: Object.freeze({
    minSafetyScore: 70,
    maxNewProtocolInitialUsd: 10,
    maxNewProtocolAfterProofUsd: 25,
    observationHoursBeforeScale: 48,
  }),
  clRisk: Object.freeze({
    maxEthBtcMove7dPct: 0.15,
    minTimeInRangePct24h: 0.80,
    exitWhenIlExceedsFeesHours: 24,
  }),
  protocolConcentration: Object.freeze({
    defaultMaxPct: 0.25,
    venueMaxPctWithLiveMonitor: 0.50,
  }),
});

export function isSmallCapitalMode(activeCapitalUsd, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  if (!policy.enabled) return false;
  return Number(activeCapitalUsd) < policy.capitalThresholdUsd;
}

export function effectiveAnchorBudgetUsd(totalCapitalUsd, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return totalCapitalUsd * policy.anchorTargetPct.max;
}

export function effectiveOpportunisticBudgetUsd(totalCapitalUsd, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return Math.min(
    totalCapitalUsd * policy.opportunisticMaxPct,
    policy.defaultBudgetsUsd.opportunisticMaxUsd
  );
}

export function effectiveMicroBudgetUsd(totalCapitalUsd, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return Math.min(
    totalCapitalUsd * policy.microMaxPct,
    policy.defaultBudgetsUsd.microMaxUsd
  );
}

export function applyRewardHaircut(tokenType, displayedValueUsd, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  const haircut = policy.rewardHaircuts[tokenType] ?? policy.rewardHaircuts.defaultRewardToken;
  return displayedValueUsd * (1 - haircut);
}
