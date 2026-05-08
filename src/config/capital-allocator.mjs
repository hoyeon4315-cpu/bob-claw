import { SMALL_CAPITAL_CAMPAIGN_MODE } from "./small-capital-campaign-mode.mjs";

export const CAPITAL_ALLOCATOR_POLICY = Object.freeze({
  exploitSharePct: 0.75,
  exploreSharePct: 0.25,
  exploreCandidateMaxUsd: 25,
  exploreMaxConcurrent: 4,
  exploreCooldownHours: 24,
  exploreReceiptFreshnessHours: 168,
  exploreMinSamples: 30,
  smallCapitalMicroTestHardCapPct: 0.10,
  smallCapitalMicroTestMaxUsd: SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.microMaxUsd,
  radarPerCanaryUsd: SMALL_CAPITAL_CAMPAIGN_MODE.radarLane.perCanaryUsd,
  perCampaignInitialUsd: SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.initialCampaignUsd,
  perUnprovenProtocolInitialUsd: SMALL_CAPITAL_CAMPAIGN_MODE.microEntry.maxNewProtocolInitialUsd,
});
