// Position bleed detector — emits exit actions when cumulative gas
// accrual exceeds realized yield × bleedToYieldRatio.
//
// Compatible with position-action-engine.mjs action shape.

import { createHash } from "node:crypto";

const PRIORITY = {
  exit: 1,
  unwind: 2,
  pause: 3,
  review: 4,
};

export function featureEnabled(profile = {}) {
  return profile.positionBleedDetector !== false;
}

function dedupeKey({ strategyId, positionId, type, reasonCode, windowBucket }) {
  const h = createHash("sha1").update([strategyId, positionId, type, reasonCode, windowBucket].join("|")).digest("hex");
  return h.slice(0, 16);
}

function windowBucket(now = new Date(), bucketMs = 5 * 60 * 1000) {
  return Math.floor(new Date(now).getTime() / bucketMs);
}

export function evaluatePositionBleed({ position = {}, policy = {}, now = new Date() } = {}) {
  const actions = [];

  if (!position || !position.positionId) return actions;

  const cumulativeGasUsd = Number(position.cumulativeGasUsd);
  const realizedYieldUsd = Number(position.realizedYieldUsd);
  const bleedToYieldRatio = Number.isFinite(policy.bleedToYieldRatio) ? policy.bleedToYieldRatio : 1.0;

  if (!Number.isFinite(cumulativeGasUsd) || !Number.isFinite(realizedYieldUsd)) {
    return actions;
  }

  const threshold = realizedYieldUsd * bleedToYieldRatio;

  if (cumulativeGasUsd > threshold) {
    const wb = windowBucket(now);
    const strategyId = position.strategyId || "";
    const positionId = position.positionId;
    actions.push({
      type: "exit",
      strategyId: strategyId || null,
      positionId,
      priority: PRIORITY.exit,
      reasonCode: "position_bleed",
      reason: `cumulative gas $${cumulativeGasUsd.toFixed(4)} > yield $${realizedYieldUsd.toFixed(4)} × ratio ${bleedToYieldRatio}`,
      estimatedCostUsd: Number(position.estimatedExitCostUsd) || 0,
      estimatedRecoveryUsd: Number(position.valueUsd) || 0,
      dedupeKey: dedupeKey({ strategyId, positionId, type: "exit", reasonCode: "position_bleed", windowBucket: wb }),
    });
  }

  return actions;
}
