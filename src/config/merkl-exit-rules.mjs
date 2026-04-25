export const MERKL_EXIT_RULES = Object.freeze({
  profileId: "merkl_underperform_exit_v1",
  realizedAprRatioExit: 0.5,
  rewardTokenDropPct: 0.5,
  volumeDropPct24h: 0.7,
});

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function merklExitRules(overrides = {}) {
  return {
    ...MERKL_EXIT_RULES,
    ...overrides,
  };
}

export function evaluateMerklUnderperformExit({
  position = {},
  queueItem = {},
  rules: rulesInput = {},
} = {}) {
  const rules = merklExitRules(rulesInput);
  const triggers = [];
  const metrics = {};

  const entryApr = finite(position.entryAprPct ?? position.aprPctAtEntry ?? position.nativeAprPctAtEntry);
  const currentApr = finite(queueItem.nativeAprPct ?? queueItem.aprPct);
  if (entryApr != null && currentApr != null && entryApr > 0) {
    const ratio = currentApr / entryApr;
    metrics.aprRatio = ratio;
    if (ratio < rules.realizedAprRatioExit) triggers.push("realized_apr_below_entry_ratio");
  }

  const entryRewardPrice = finite(position.rewardTokenPriceUsdAtEntry);
  const currentRewardPrice = finite(queueItem.rewardTokenPriceUsd);
  if (entryRewardPrice != null && currentRewardPrice != null && entryRewardPrice > 0) {
    const dropPct = Math.max(0, (entryRewardPrice - currentRewardPrice) / entryRewardPrice);
    metrics.rewardTokenDropPct = dropPct;
    if (dropPct >= rules.rewardTokenDropPct) triggers.push("reward_token_price_drop");
  }

  const entryVolume = finite(position.volume24hUsdAtEntry);
  const currentVolume = finite(queueItem.volume24hUsd);
  if (entryVolume != null && currentVolume != null && entryVolume > 0) {
    const dropPct = Math.max(0, (entryVolume - currentVolume) / entryVolume);
    metrics.volumeDropPct24h = dropPct;
    if (dropPct >= rules.volumeDropPct24h) triggers.push("volume_24h_drop");
  }

  return {
    policyProfile: rules.profileId,
    triggers,
    metrics,
  };
}
