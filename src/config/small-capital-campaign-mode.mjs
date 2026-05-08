// Small-capital campaign-aware operating mode policy.
// Durable rules, not current APR numbers.
// Commit-only changes. Runtime overrides are forbidden by AGENTS.md.

import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "./gateway-destinations.mjs";
import { NON_PRIMARY_ENTRY_EV_POLICY } from "./sizing.mjs";
import {
  effectiveBudgetMapUsd,
  effectiveBudgetUsd,
  operatingCapitalScaleBand,
} from "./operating-capital-scale.mjs";

const CHAIN_PROFILE_REVIEW_BY = "2026-05-16";

export const SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE = Object.freeze({
  opportunisticMaxUsd: 125,
  microMaxUsd: 50,
  initialCampaignUsd: 35,
  maxCampaignUsd: 80,
  initialMicroUsd: 10,
  maxMicroUsd: 35,
});

export const SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE = Object.freeze({
  mode: NON_PRIMARY_ENTRY_EV_POLICY.mode,
  minEdgeFloorUsd: NON_PRIMARY_ENTRY_EV_POLICY.minEdgeFloorUsd,
  minEdgePctOfNotional: NON_PRIMARY_ENTRY_EV_POLICY.minEdgePctOfNotional,
  sampleUncertainty: NON_PRIMARY_ENTRY_EV_POLICY.sampleUncertainty,
  reEvaluateEveryDays: NON_PRIMARY_ENTRY_EV_POLICY.reEvaluateEveryDays,
  expiresAt: NON_PRIMARY_ENTRY_EV_POLICY.expiresAt,
});

export const SMALL_CAPITAL_RADAR_CAPS_BASELINE = Object.freeze({
  perCanaryUsd: 30,
  perDayUsd: 90,
  cumulativeOpenUsd: 200,
  maxConcurrentOpen: 6,
});

export const AGGRESSIVE_DEFAULT_BUDGETS_USD_BASELINE = Object.freeze({
  opportunisticMaxUsd: 220,
  microMaxUsd: 80,
  initialCampaignUsd: 50,
  maxCampaignUsd: 140,
  initialMicroUsd: 15,
  maxMicroUsd: 60,
});

export const AGGRESSIVE_NON_PRIMARY_ENTRY_BASELINE = Object.freeze({
  mode: NON_PRIMARY_ENTRY_EV_POLICY.mode,
  minEdgeFloorUsd: NON_PRIMARY_ENTRY_EV_POLICY.minEdgeFloorUsd,
  minEdgePctOfNotional: NON_PRIMARY_ENTRY_EV_POLICY.minEdgePctOfNotional,
  sampleUncertainty: NON_PRIMARY_ENTRY_EV_POLICY.sampleUncertainty,
  reEvaluateEveryDays: NON_PRIMARY_ENTRY_EV_POLICY.reEvaluateEveryDays,
  expiresAt: NON_PRIMARY_ENTRY_EV_POLICY.expiresAt,
});

function freezeChainProfile(profile) {
  return Object.freeze({ ...profile });
}

const CURRENT_EVIDENCE_PRIMARY_CHAIN_PROFILES = Object.freeze({
  base: freezeChainProfile({
    role: "primary",
    maxSharePct: 0.70,
    evidenceStatus: "current_evidence_primary",
    evidenceSource: "live receipts, low same-chain cost, current inventory, and supported executor paths",
    reviewBy: CHAIN_PROFILE_REVIEW_BY,
  }),
});

const DEFAULT_CANDIDATE_CHAIN_PROFILE = freezeChainProfile({
  role: "candidate",
  maxSharePct: null,
  evidenceStatus: "candidate_pending_evidence",
  evidenceSource: "official Gateway destination awaiting receipt-backed primary-chain evidence",
  reviewBy: CHAIN_PROFILE_REVIEW_BY,
});

export const SMALL_CAPITAL_CHAIN_PROFILES = Object.freeze(Object.fromEntries(
  OFFICIAL_GATEWAY_DESTINATION_CHAINS.map((chain) => [
    chain,
    CURRENT_EVIDENCE_PRIMARY_CHAIN_PROFILES[chain] ?? DEFAULT_CANDIDATE_CHAIN_PROFILE,
  ]),
));

export const SMALL_CAPITAL_CAMPAIGN_MODE = Object.freeze({
  profileId: "small_capital_campaign_mode_v1",
  executionStage: "aggressive_non_auto_cap_small_cap_v1",
  autoCapRaise: false,
  enabled: true,
  autoMicroTest: true,
  capitalThresholdUsd: 1_000,
  transportEffectivePerDayUsd: 200,
  transportEffectiveMaxDailyLossUsd: 100,
  anchorTargetPct: Object.freeze({ min: 0.55, max: 0.70 }),
  opportunisticMaxPct: 0.30,
  microMaxPct: 0.10,
  defaultBudgetsUsd: SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE,
  defaultBudgetsUsdBaseline: SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE,
  chainSelection: Object.freeze({
    mode: "evidence_led_primary_chains",
    primaryMaxSharePct: 0.70,
    defaultCandidateRole: "candidate",
    reviewCadenceHours: 14 * 24,
    chainProfiles: SMALL_CAPITAL_CHAIN_PROFILES,
  }),
  nonPrimaryEntry: SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE,
  nonPrimaryEntryBaseline: SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE,
  nonPrimaryEntryEvPolicy: NON_PRIMARY_ENTRY_EV_POLICY,
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
  radarLane: Object.freeze({
    enabled: true,
    perCanaryUsd: SMALL_CAPITAL_RADAR_CAPS_BASELINE.perCanaryUsd,
    perDayUsd: SMALL_CAPITAL_RADAR_CAPS_BASELINE.perDayUsd,
    cumulativeOpenUsd: SMALL_CAPITAL_RADAR_CAPS_BASELINE.cumulativeOpenUsd,
    maxConcurrentOpen: SMALL_CAPITAL_RADAR_CAPS_BASELINE.maxConcurrentOpen,
    minRealizedPnlBufferUsd: 0,
    realizedDailyLossLockUsd: 25,
    newProtocolFirstEntryUsd: 10,
    capGraduationUsd: Object.freeze([10, 25, 50, 80, 100]),
  }),
  radarCapsBaseline: SMALL_CAPITAL_RADAR_CAPS_BASELINE,
  canaryGraduation: Object.freeze({
    enabled: true,
    rungsUsd: Object.freeze([5, 10, 25, 50, 80]),
    maxAutoGraduatedUsd: 80,
    ethereumMinRungUsd: 25,
    minDeliveredForSecondRung: 1,
    minDeliveredForThirdRung: 2,
    minPositiveRealizedForThirdRung: 1,
    minPositiveRealizedForFourthRung: 2,
    minDistinctWindowsForFourthRung: 2,
    minPositiveRealizedForFifthRung: 3,
    minDistinctWindowsForFifthRung: 2,
    realizedLossWindowMs: 24 * 60 * 60 * 1000,
    realizedDailyLossLockUsd: 25,
    maxSubstantiveFailures: 2,
    noTxSentIsNeutral: true,
  }),
});

export function effectiveDefaultBudgetsUsd({
  operatingCapitalUsd,
  policy = SMALL_CAPITAL_CAMPAIGN_MODE,
} = {}) {
  return effectiveBudgetMapUsd(policy.defaultBudgetsUsdBaseline || policy.defaultBudgetsUsd, operatingCapitalUsd);
}

export function effectiveNonPrimaryEntry({
  operatingCapitalUsd,
  policy = SMALL_CAPITAL_CAMPAIGN_MODE,
} = {}) {
  const baseline = policy.nonPrimaryEntryBaseline || policy.nonPrimaryEntry || {};
  void operatingCapitalUsd;
  return Object.freeze({ ...baseline });
}

export function effectiveRadarCaps({
  operatingCapitalUsd,
  policy = SMALL_CAPITAL_CAMPAIGN_MODE,
} = {}) {
  const baseline = policy.radarCapsBaseline || {
    perCanaryUsd: policy.radarLane?.perCanaryUsd,
    perDayUsd: policy.radarLane?.perDayUsd,
    cumulativeOpenUsd: policy.radarLane?.cumulativeOpenUsd,
    maxConcurrentOpen: policy.radarLane?.maxConcurrentOpen,
  };
  return Object.freeze({
    perCanaryUsd: effectiveBudgetUsd(baseline.perCanaryUsd, operatingCapitalUsd),
    perDayUsd: effectiveBudgetUsd(baseline.perDayUsd, operatingCapitalUsd),
    cumulativeOpenUsd: effectiveBudgetUsd(baseline.cumulativeOpenUsd, operatingCapitalUsd),
    maxConcurrentOpen: baseline.maxConcurrentOpen,
  });
}

export function resolveEffectiveSmallCapitalBudgets({
  operatingCapitalUsd = 1_000,
  policy = SMALL_CAPITAL_CAMPAIGN_MODE,
} = {}) {
  const band = operatingCapitalScaleBand(operatingCapitalUsd);
  return Object.freeze({
    operatingCapitalUsd: Number.isFinite(Number(operatingCapitalUsd)) ? Number(operatingCapitalUsd) : null,
    capitalScaleBandId: band.bandId,
    capitalScaleMultiplier: band.multiplier,
    nominalBudgets: Object.freeze({
      defaultBudgetsUsd: policy.defaultBudgetsUsdBaseline || policy.defaultBudgetsUsd,
      nonPrimaryEntry: policy.nonPrimaryEntryBaseline || policy.nonPrimaryEntry,
      radarCaps: policy.radarCapsBaseline || {
        perCanaryUsd: policy.radarLane?.perCanaryUsd,
        perDayUsd: policy.radarLane?.perDayUsd,
        cumulativeOpenUsd: policy.radarLane?.cumulativeOpenUsd,
        maxConcurrentOpen: policy.radarLane?.maxConcurrentOpen,
      },
    }),
    effectiveBudgets: Object.freeze({
      defaultBudgetsUsd: effectiveDefaultBudgetsUsd({ operatingCapitalUsd, policy }),
      nonPrimaryEntry: effectiveNonPrimaryEntry({ operatingCapitalUsd, policy }),
      radarCaps: effectiveRadarCaps({ operatingCapitalUsd, policy }),
    }),
  });
}

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

export function chainProfileFor(chain, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  const id = String(chain ?? "").toLowerCase();
  return policy.chainSelection?.chainProfiles?.[id] ?? null;
}

export function isEvidencePrimaryChain(chain, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return chainProfileFor(chain, policy)?.role === "primary";
}

export function evidencePrimaryChainIds(policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return Object.entries(policy.chainSelection?.chainProfiles ?? {})
    .filter(([, profile]) => profile?.role === "primary")
    .map(([chain]) => chain);
}

export function evidencePrimaryChainShareOverrides(policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return Object.freeze(Object.fromEntries(
    Object.entries(policy.chainSelection?.chainProfiles ?? {})
      .filter(([, profile]) => profile?.role === "primary")
      .filter(([, profile]) => Number.isFinite(profile.maxSharePct) && profile.maxSharePct > 0)
      .map(([chain, profile]) => [chain, profile.maxSharePct]),
  ));
}
