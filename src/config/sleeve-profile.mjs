import {
  AGGRESSIVE_DEFAULT_BUDGETS_USD_BASELINE,
  AGGRESSIVE_NON_PRIMARY_ENTRY_BASELINE,
  SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE,
  SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE,
  SMALL_CAPITAL_RADAR_CAPS_BASELINE,
} from "./small-capital-campaign-mode.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function minFiniteNumber(candidates = []) {
  const finiteValues = candidates.filter(isFiniteNumber);
  return finiteValues.length > 0 ? Math.min(...finiteValues) : null;
}

function clampFiniteNumber(baseValue, ceilings = []) {
  if (!isFiniteNumber(baseValue)) return null;
  return minFiniteNumber([baseValue, ...ceilings]);
}

function resolveProfilePerChainCap(perChainUsd = {}, chain) {
  if (!chain) return null;
  const direct = perChainUsd?.[chain];
  return isFiniteNumber(direct) ? direct : (isFiniteNumber(perChainUsd?.default) ? perChainUsd.default : null);
}

export const SLEEVE_PROFILES = deepFreeze({
  smallCapital_v1: {
    id: "smallCapital_v1",
    label: "Current small-capital sleeve",
    btcFloorPct: 0.20,
    nonBtcMaxPct: 0.80,
    capital: {
      canaryStartUsdMin: 20,
      canaryStartUsdMax: 50,
      reserveChain: "base",
      reserveChainTargetWalletShare: 0.8,
      reserveConcentrationToleranceUsd: 0.5,
      maxIdleCapitalPerChainUsd: 60,
      fragmentationDragPct: 0.005,
      maxRefillCost24hUsd: 12,
    },
    smallCapitalOverrides: {
      profileId: "small_capital_campaign_mode_v1",
      executionStage: "aggressive_non_auto_cap_small_cap_v1",
      anchorTargetPct: { min: 0.55, max: 0.70 },
      opportunisticMaxPct: 0.30,
      microMaxPct: 0.10,
      defaultBudgetsUsd: SMALL_CAPITAL_DEFAULT_BUDGETS_USD_BASELINE,
      chainSelection: {
        primaryMaxSharePct: 0.70,
      },
      nonPrimaryEntry: SMALL_CAPITAL_NON_PRIMARY_ENTRY_BASELINE,
      protocolConcentration: {
        defaultMaxPct: 0.25,
        venueMaxPctWithLiveMonitor: 0.50,
      },
    },
    strategyCapCeilings: {
      onlyNonBtc: true,
      perTxUsd: 150,
      perDayUsd: 300,
      tinyLivePerTxUsd: 50,
      perChainUsd: {
        default: 150,
        base: 200,
        ethereum: 125,
        bob: 75,
      },
    },
    diversification: {
      perStrategyMaxShare: 0.25,
      perChainMaxShare: 0.35,
      perProtocolMaxShare: 0.30,
      hhiMax: 0.30,
      bobL2DirectMaxShare: 0.10,
      minSharesForHhi: 2,
    },
    portfolioExposure: {
      profileId: "aggressive_non_btc_payback_v1",
      maxProtocolSharePct: 0.25,
      maxDefaultChainSharePct: 0.20,
      chainSharePct: {
        ethereum: 0.50,
        bob: 0.10,
      },
      minBtcDenominatedSharePct: 0.20,
      maxNonBtcDenominatedSharePct: 0.80,
    },
    radarCaps: SMALL_CAPITAL_RADAR_CAPS_BASELINE,
  },
  aggressive_v1: {
    id: "aggressive_v1",
    label: "Aggressive non-BTC sleeve",
    btcFloorPct: 0.20,
    nonBtcMaxPct: 0.80,
    capital: {
      canaryStartUsdMin: 25,
      canaryStartUsdMax: 80,
      reserveChain: "base",
      reserveChainTargetWalletShare: 0.8,
      reserveConcentrationToleranceUsd: 0.5,
      maxIdleCapitalPerChainUsd: 120,
      fragmentationDragPct: 0.005,
      maxRefillCost24hUsd: 18,
    },
    smallCapitalOverrides: {
      profileId: "small_capital_campaign_mode_aggressive_v1",
      executionStage: "aggressive_non_btc_allocation_v1",
      anchorTargetPct: { min: 0.20, max: 0.45 },
      opportunisticMaxPct: 0.55,
      microMaxPct: 0.15,
      defaultBudgetsUsd: AGGRESSIVE_DEFAULT_BUDGETS_USD_BASELINE,
      chainSelection: {
        primaryMaxSharePct: 0.80,
      },
      nonPrimaryEntry: AGGRESSIVE_NON_PRIMARY_ENTRY_BASELINE,
      protocolConcentration: {
        defaultMaxPct: 0.30,
        venueMaxPctWithLiveMonitor: 0.55,
      },
    },
    strategyCapCeilings: {
      onlyNonBtc: true,
      perTxUsd: 200,
      perDayUsd: 600,
      tinyLivePerTxUsd: 100,
      perChainUsd: {
        default: 300,
        base: 400,
        ethereum: 250,
        bob: 125,
      },
    },
    diversification: {
      perStrategyMaxShare: 0.30,
      perChainMaxShare: 0.45,
      perProtocolMaxShare: 0.35,
      hhiMax: 0.35,
      bobL2DirectMaxShare: 0.15,
      minSharesForHhi: 2,
    },
    portfolioExposure: {
      profileId: "aggressive_non_btc_payback_v1",
      maxProtocolSharePct: 0.30,
      maxDefaultChainSharePct: 0.25,
      chainSharePct: {
        ethereum: 0.60,
        bob: 0.15,
      },
      minBtcDenominatedSharePct: 0.20,
      maxNonBtcDenominatedSharePct: 0.80,
    },
    radarCaps: SMALL_CAPITAL_RADAR_CAPS_BASELINE,
  },
});

// Commit-only profile selector. Switching profiles must be a committed diff.
export const ACTIVE_SLEEVE_PROFILE_ID = "smallCapital_v1";
export const ACTIVE_SLEEVE_PROFILE = SLEEVE_PROFILES[ACTIVE_SLEEVE_PROFILE_ID];

export function resolveSleeveProfile(profileId = ACTIVE_SLEEVE_PROFILE_ID) {
  return SLEEVE_PROFILES[profileId] || ACTIVE_SLEEVE_PROFILE;
}

export function resolveProfileCapMatrix(
  strategy = {},
  { profileId = ACTIVE_SLEEVE_PROFILE_ID, includeRadarCaps = false } = {},
) {
  if (!strategy) return null;

  const profile = resolveSleeveProfile(profileId);
  const profileCaps = profile?.strategyCapCeilings || null;
  const applyProfileCaps =
    profileCaps &&
    (profileCaps.onlyNonBtc !== true || strategy?.exposure?.btcDenominated !== true);
  const activeProfileCaps = applyProfileCaps ? profileCaps : null;
  const radarCaps = includeRadarCaps ? (profile?.radarCaps || null) : null;

  const chainKeys = new Set(Object.keys(strategy?.caps?.perChainUsd || {}));
  chainKeys.delete("default");

  const perChainUsd = Object.fromEntries(
    [...chainKeys]
      .map((chain) => [
        chain,
        clampFiniteNumber(
          strategy?.caps?.perChainUsd?.[chain],
          [resolveProfilePerChainCap(activeProfileCaps?.perChainUsd, chain)],
        ),
      ])
      .filter(([, value]) => isFiniteNumber(value)),
  );

  return {
    strategyId: strategy.strategyId || null,
    profileId: profile.id,
    profileCapApplied: Boolean(activeProfileCaps),
    perTxUsd: clampFiniteNumber(strategy?.caps?.perTxUsd, [activeProfileCaps?.perTxUsd]),
    perDayUsd: clampFiniteNumber(strategy?.caps?.perDayUsd, [activeProfileCaps?.perDayUsd]),
    tinyLivePerTxUsd: clampFiniteNumber(
      strategy?.caps?.tinyLivePerTxUsd,
      [activeProfileCaps?.tinyLivePerTxUsd],
    ),
    perChainUsd,
    radarCaps: radarCaps
      ? {
          perCanaryUsd: minFiniteNumber([radarCaps.perCanaryUsd, activeProfileCaps?.tinyLivePerTxUsd]),
          perDayUsd: minFiniteNumber([radarCaps.perDayUsd, activeProfileCaps?.perDayUsd]),
          cumulativeOpenUsd: isFiniteNumber(radarCaps.cumulativeOpenUsd) ? radarCaps.cumulativeOpenUsd : null,
          maxConcurrentOpen: Number.isInteger(radarCaps.maxConcurrentOpen) ? radarCaps.maxConcurrentOpen : null,
        }
      : null,
  };
}
