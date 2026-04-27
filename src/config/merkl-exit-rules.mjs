export const MERKL_EXIT_RULES = Object.freeze({
  profileId: "opportunity_exit_v2",
  realizedAprRatioExit: 0.5,
  rewardTokenDropPct: 0.25,
  volumeDropPct24h: 0.7,
  aprDecayPct: 0.50,
  aprDecayWindowHours: 6,
  tvlDrainPct: 0.30,
  tvlDrainWindowHours: 4,
  positionDrawdownPct: 0.12,
  rewardTokenDropWindowHours: 6,
  campaignEndsHarvestHours: 6,
  ilPct: 0.08,
  stableLegDepegBps: 80,
  gasBurnExitRatio: 0.25,
  scoreDecayPct: 0.30,
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

export function evaluateExitRules({
  position = {},
  current = {},
  rules: rulesInput = {},
} = {}) {
  const rules = merklExitRules(rulesInput);
  const triggers = [];
  const metrics = {};

  const entryApr = finite(position.entryAprPct ?? position.aprPctAtEntry);
  const currentApr = finite(current.aprPct ?? current.nativeAprPct);
  if (entryApr != null && currentApr != null && entryApr > 0) {
    const decay = Math.max(0, (entryApr - currentApr) / entryApr);
    metrics.aprDecayPct = decay;
    if (decay >= rules.aprDecayPct) triggers.push("apr_decay_50pct_6h");
  }

  const entryTvl = finite(position.tvlUsdAtEntry ?? position.entryTvlUsd);
  const currentTvl = finite(current.tvlUsd);
  if (entryTvl != null && currentTvl != null && entryTvl > 0) {
    const drain = Math.max(0, (entryTvl - currentTvl) / entryTvl);
    metrics.tvlDrainPct = drain;
    if (drain >= rules.tvlDrainPct) triggers.push("tvl_drain_30pct_4h");
  }

  const entryValue = finite(position.valueUsdAtEntry ?? position.entryValueUsd);
  const currentValue = finite(current.valueUsd ?? current.positionUsd);
  if (entryValue != null && currentValue != null && entryValue > 0) {
    const drawdown = Math.max(0, (entryValue - currentValue) / entryValue);
    metrics.positionDrawdownPct = drawdown;
    if (drawdown >= rules.positionDrawdownPct) triggers.push("position_drawdown_12pct");
  }

  const entryRewardPrice = finite(position.rewardTokenPriceUsdAtEntry);
  const currentRewardPrice = finite(current.rewardTokenPriceUsd);
  if (entryRewardPrice != null && currentRewardPrice != null && entryRewardPrice > 0) {
    const dropPct = Math.max(0, (entryRewardPrice - currentRewardPrice) / entryRewardPrice);
    metrics.rewardTokenDropPct = dropPct;
    if (dropPct >= rules.rewardTokenDropPct) triggers.push("reward_token_drop_25pct_6h");
  }

  const campaignRemainingHours = finite(current.campaignRemainingHours);
  if (campaignRemainingHours != null && campaignRemainingHours >= 0) {
    metrics.campaignRemainingHours = campaignRemainingHours;
    if (campaignRemainingHours <= rules.campaignEndsHarvestHours) {
      triggers.push("campaign_ends_6h_harvest");
    }
  }

  const ilPct = finite(current.ilPct ?? current.impermanentLossPct);
  if (ilPct != null && ilPct > 0) {
    metrics.ilPct = ilPct;
    if (ilPct >= rules.ilPct) triggers.push("il_8pct_lp");
  }

  const stableLegDepegBps = finite(current.stableLegDepegBps ?? current.depegBps);
  if (stableLegDepegBps != null && stableLegDepegBps > 0) {
    metrics.stableLegDepegBps = stableLegDepegBps;
    if (stableLegDepegBps >= rules.stableLegDepegBps) triggers.push("stable_leg_depeg_80bps");
  }

  const realizedGasUsd = finite(current.realizedGasUsd ?? current.cumulativeGasUsd);
  const realizedRewardUsd = finite(current.realizedRewardUsd ?? current.harvestedRewardUsd);
  if (realizedGasUsd != null && realizedRewardUsd != null && realizedRewardUsd > 0) {
    const ratio = realizedGasUsd / realizedRewardUsd;
    metrics.gasBurnRatio = ratio;
    if (ratio >= rules.gasBurnExitRatio) triggers.push("gas_burn_exit");
  }

  const entryScore = finite(position.scoreAtEntry ?? position.entryScore);
  const currentScore = finite(current.score);
  if (entryScore != null && currentScore != null && entryScore > 0) {
    const decay = Math.max(0, (entryScore - currentScore) / entryScore);
    metrics.scoreDecayPct = decay;
    if (decay >= rules.scoreDecayPct) triggers.push("score_decay_30pct");
  }

  return {
    policyProfile: rules.profileId,
    triggers,
    metrics,
  };
}
