import { PAYBACK_CONFIG } from "../../config/payback.mjs";

export function featureEnabled(profile = {}) {
  return profile.harvestScheduler !== false;
}

export function scheduleHarvests({ positions = [], policy = {}, now = new Date().toISOString() } = {}) {
  if (!featureEnabled(policy.profile)) {
    return { intents: [], summary: { scheduledCount: 0, skippedCount: positions.length } };
  }

  const nowMs = new Date(now).getTime();
  const intents = [];
  let skippedCount = 0;

  for (const pos of positions) {
    const nextHarvestAt = pos.nextHarvestAt;
    if (!nextHarvestAt) {
      skippedCount++;
      continue;
    }
    const harvestTime = new Date(nextHarvestAt).getTime();
    if (Number.isFinite(harvestTime) && harvestTime <= nowMs) {
      intents.push({
        intentType: "harvest",
        strategyId: pos.strategyId,
        chain: pos.chain,
        protocol: pos.protocol,
        positionId: pos.positionId,
        amountUsd: pos.estimatedRewardUsd ?? 0,
        observedAt: now,
        metadata: {
          harvestScheduler: true,
          nextHarvestAt,
        },
      });
    } else {
      skippedCount++;
    }
  }

  return {
    intents,
    summary: {
      scheduledCount: intents.length,
      skippedCount,
    },
  };
}
