import { ACTIVE_SLEEVE_PROFILE_ID, resolveSleeveProfile } from "../config/sleeve-profile.mjs";
import { listStrategyCaps, resolveStrategyCapMatrix } from "../config/strategy-caps.mjs";

function compareStrategyId(left, right) {
  return String(left?.strategyId || "").localeCompare(String(right?.strategyId || ""));
}

export function buildSleeveProfileSlice({
  profileId = ACTIVE_SLEEVE_PROFILE_ID,
  generatedAt = new Date().toISOString(),
  strategies = listStrategyCaps(),
} = {}) {
  const profile = resolveSleeveProfile(profileId);
  const overrides = profile?.smallCapitalOverrides || {};
  const portfolioExposure = profile?.portfolioExposure || {};

  return {
    schemaVersion: 1,
    generatedAt,
    activeProfile: profile.id,
    profileLabel: profile.label || null,
    anchorPct: overrides.anchorTargetPct || null,
    opportunisticPct: overrides.opportunisticMaxPct ?? null,
    microTestPct: overrides.microMaxPct ?? null,
    btcFloorPct: profile.btcFloorPct ?? null,
    perProtocolMaxPct: portfolioExposure.maxProtocolSharePct ?? null,
    perChainMaxPct: profile?.diversification?.perChainMaxShare ?? null,
    resolvedStrategyCapMatrix: [...(strategies || [])]
      .sort(compareStrategyId)
      .map((strategy) => ({
        strategyId: strategy.strategyId || null,
        autoExecute: strategy.autoExecute === true,
        btcDenominated: strategy?.exposure?.btcDenominated === true,
        resolvedCaps: resolveStrategyCapMatrix(strategy, {
          profileId,
          includeRadarCaps: true,
        }),
      })),
  };
}
