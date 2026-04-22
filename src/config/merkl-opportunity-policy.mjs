export const MERKL_OPPORTUNITY_POLICY = Object.freeze({
  profileId: "aggressive_but_bounded_v1",
  api: Object.freeze({
    opportunityPageSize: 100,
    campaignPageSize: 100,
    maxOpportunityPages: 4,
    maxCampaignPages: 4,
    requestTimeoutMs: 15_000,
  }),
  entry: Object.freeze({
    minHoursRemainingForNewEntry: 36,
    minHoursRemainingForScaleUp: 96,
    rotationLookaheadHours: 48,
    eligibleEntryChains: Object.freeze([
      "ethereum",
      "base",
      "bob",
      "bsc",
      "avalanche",
      "bera",
      "optimism",
      "sei",
      "soneium",
      "sonic",
      "unichain",
    ]),
    minLiveCampaignCount: 1,
    minTvlUsdByFamily: Object.freeze({
      btc_collateral_stable_borrow: 1_000_000,
      wrapped_btc_lending: 750_000,
      stable_btc_lp: 2_500_000,
      managed_btc_vault: 5_000_000,
      btc_misc: 2_000_000,
      unknown: 2_500_000,
    }),
    supportedExecutionSurfaces: Object.freeze({
      lending: true,
      stableBorrow: true,
      clLp: false,
      managedVault: false,
    }),
    hardRejectRewardTokenTypes: Object.freeze(["POINT"]),
  }),
  scoring: Object.freeze({
    btcDirectness: 25,
    supportedStrategyMapping: 20,
    chainInCoreScope: 12,
    sufficientDuration: 10,
    sufficientTvl: 10,
    nativeYieldKnown: 8,
    rewardTokenIsTransferable: 8,
    singleCampaignPenalty: 6,
    shortDurationPenalty: 10,
    incentiveDominancePenalty: 8,
    lowTvlHighAprPenalty: 12,
    managedVaultPenalty: 10,
    unsupportedExecutionSurfacePenalty: 20,
    operatorHoldPenalty: 100,
  }),
});

export function minTvlForFamily(family, policy = MERKL_OPPORTUNITY_POLICY) {
  return policy.entry.minTvlUsdByFamily[family] ?? policy.entry.minTvlUsdByFamily.unknown;
}

export function chainEligibleForEntry(chain, policy = MERKL_OPPORTUNITY_POLICY) {
  return policy.entry.eligibleEntryChains.includes(chain);
}
