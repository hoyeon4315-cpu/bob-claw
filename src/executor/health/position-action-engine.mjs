// Position action engine — deterministic, no LLM.
// Emits per-position protective actions only: exit | unwind | pause | review.
// Rebalance recommendations are produced as `review` items addressed to
// capital/rebalancer.mjs (the only module allowed to issue rebalance intents).
//
// Pure function: takes positions + per-strategy positionActionPolicy + caps
// and returns a deduped list of action descriptors.

import { createHash } from "node:crypto";

export const ACTION_TYPES = Object.freeze(["exit", "unwind", "pause", "review"]);

const PRIORITY = {
  exit: 1,
  unwind: 2,
  pause: 3,
  review: 4,
};

function dedupeKey({ strategyId, positionId, type, reasonCode, windowBucket }) {
  const h = createHash("sha1").update([strategyId, positionId, type, reasonCode, windowBucket].join("|")).digest("hex");
  return h.slice(0, 16);
}

function windowBucket(now = new Date(), bucketMs = 5 * 60 * 1000) {
  return Math.floor(new Date(now).getTime() / bucketMs);
}

export function evaluatePosition({ position, policy = {}, now = new Date() }) {
  const actions = [];
  if (!position || !position.positionId) return actions;
  const reasons = [];

  const hf = Number(position.healthFactor);
  if (Number.isFinite(hf) && Number.isFinite(policy.minHealthFactor) && hf < policy.minHealthFactor) {
    reasons.push({ type: "exit", reasonCode: "hf_below_min", reason: `HF ${hf} < ${policy.minHealthFactor}` });
  } else if (Number.isFinite(hf) && Number.isFinite(policy.warnHealthFactor) && hf < policy.warnHealthFactor) {
    reasons.push({ type: "unwind", reasonCode: "hf_warn", reason: `HF ${hf} < warn ${policy.warnHealthFactor}` });
  }

  const expirySec = Number(position.expirySec);
  if (Number.isFinite(expirySec) && Number.isFinite(policy.exitBeforeExpirySec)) {
    const remaining = expirySec - Math.floor(new Date(now).getTime() / 1000);
    if (remaining <= 0) {
      reasons.push({ type: "exit", reasonCode: "expired", reason: `expired ${-remaining}s ago` });
    } else if (remaining <= policy.exitBeforeExpirySec) {
      reasons.push({ type: "exit", reasonCode: "expiry_window", reason: `expires in ${remaining}s` });
    }
  }

  if (Number.isFinite(position.timeInRangeRatio) && Number.isFinite(policy.minTimeInRangeRatio)) {
    if (position.timeInRangeRatio < policy.minTimeInRangeRatio) {
      reasons.push({ type: "review", reasonCode: "cl_out_of_range", reason: `tir ${position.timeInRangeRatio} < ${policy.minTimeInRangeRatio}` });
    }
  }

  if (Number.isFinite(position.aprDecayRatio) && Number.isFinite(policy.maxAprDecayRatio)) {
    if (position.aprDecayRatio > policy.maxAprDecayRatio) {
      reasons.push({ type: "unwind", reasonCode: "campaign_decay", reason: `apr decay ${position.aprDecayRatio} > ${policy.maxAprDecayRatio}` });
    }
  }

  if (Number.isFinite(position.tvlDrainRatio) && Number.isFinite(policy.maxTvlDrainRatio)) {
    if (position.tvlDrainRatio > policy.maxTvlDrainRatio) {
      reasons.push({ type: "pause", reasonCode: "tvl_drain", reason: `tvl drain ${position.tvlDrainRatio} > ${policy.maxTvlDrainRatio}` });
    }
  }

  const wb = windowBucket(now);
  for (const r of reasons) {
    actions.push({
      type: r.type,
      strategyId: position.strategyId || null,
      positionId: position.positionId,
      priority: PRIORITY[r.type],
      reasonCode: r.reasonCode,
      reason: r.reason,
      estimatedCostUsd: Number(position.estimatedExitCostUsd) || 0,
      estimatedRecoveryUsd: Number(position.valueUsd) || 0,
      dedupeKey: dedupeKey({ strategyId: position.strategyId || "", positionId: position.positionId, type: r.type, reasonCode: r.reasonCode, windowBucket: wb }),
    });
  }
  return actions;
}

export function planActions({ positions = [], policiesByStrategy = {}, now = new Date() } = {}) {
  const all = [];
  const seen = new Set();
  for (const p of positions) {
    const policy = policiesByStrategy[p.strategyId] || {};
    for (const a of evaluatePosition({ position: p, policy, now })) {
      if (seen.has(a.dedupeKey)) continue;
      seen.add(a.dedupeKey);
      all.push(a);
    }
  }
  all.sort((a, b) => a.priority - b.priority || String(a.positionId).localeCompare(String(b.positionId)));
  return all;
}
