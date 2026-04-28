// Pure trigger evaluator for the auto kill-switch.
// Inputs: audit-log records, oracle samples, heartbeat timestamp, config.
// Output: { triggered: boolean, triggers: [...], evaluatedAt }.
// The caller decides whether to write the kill-switch file (see
// `src/risk/auto-kill-events.mjs`). This module never touches the
// filesystem so it stays unit-testable and side-effect-free.

import { readFileSync } from "node:fs";
import { buildAutoKillConfig } from "../config/auto-kill.mjs";

function recordTimestampMs(record = {}) {
  const value = record.timestamp || record.observedAt || 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFailure(record = {}) {
  const stage = record.lifecycle?.stage || null;
  if (["rejected", "reverted", "error"].includes(stage)) return true;
  if (record.policyVerdict === "rejected" || record.policyVerdict === "errored") return true;
  return false;
}

function realizedLossUsd(record = {}) {
  const realized = record.realized || {};
  const value = Number(realized.netUsd ?? realized.netPnLUsd ?? 0);
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -value : 0;
}

export function evaluateCumulativeLoss({
  auditRecords = [],
  config,
  operatingCapitalUsd = null,
  nowMs,
}) {
  if (!config.enabled) return null;
  const cutoff = nowMs - config.windowMs;
  let lossUsd = 0;
  for (const record of auditRecords) {
    if (recordTimestampMs(record) < cutoff) continue;
    lossUsd += realizedLossUsd(record);
  }
  const fractionThreshold =
    Number.isFinite(operatingCapitalUsd) && operatingCapitalUsd > 0
      ? operatingCapitalUsd * config.operatingCapitalFractionFloor
      : Number.POSITIVE_INFINITY;
  const effectiveThreshold = Math.min(config.thresholdUsd, fractionThreshold);
  if (lossUsd < effectiveThreshold) return null;
  return {
    trigger: "cumulative_loss",
    lossUsd,
    thresholdUsd: effectiveThreshold,
    windowMs: config.windowMs,
  };
}

export function evaluateFailureBurst({ auditRecords = [], config, nowMs }) {
  if (!config.enabled) return null;
  const cutoff = nowMs - config.windowMs;
  const perStrategy = new Map();
  let totalFailures = 0;
  for (const record of auditRecords) {
    if (recordTimestampMs(record) < cutoff) continue;
    if (!isFailure(record)) continue;
    totalFailures += 1;
    const id = record.strategyId || "unknown";
    perStrategy.set(id, (perStrategy.get(id) || 0) + 1);
  }
  if (totalFailures >= config.failureCount) {
    return {
      trigger: "failure_burst_total",
      failureCount: totalFailures,
      threshold: config.failureCount,
      windowMs: config.windowMs,
    };
  }
  for (const [strategyId, count] of perStrategy) {
    if (count >= config.perStrategyFailureCount) {
      return {
        trigger: "failure_burst_per_strategy",
        strategyId,
        failureCount: count,
        threshold: config.perStrategyFailureCount,
        windowMs: config.windowMs,
      };
    }
  }
  return null;
}

export function evaluateOracleDivergence({ samples = [], config }) {
  if (!config.enabled) return null;
  if (!Array.isArray(samples) || samples.length < config.minSourceCount) return null;
  const prices = samples
    .map((sample) => Number(sample.priceUsd))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (prices.length < config.minSourceCount) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const divergence = (max - min) / min;
  if (divergence < config.maxDivergencePct) return null;
  return {
    trigger: "oracle_divergence",
    divergence,
    threshold: config.maxDivergencePct,
    minPriceUsd: min,
    maxPriceUsd: max,
    sources: samples.map((sample) => sample.source || "unknown"),
  };
}

export function evaluateHeartbeat({ heartbeatAtMs = null, config, nowMs }) {
  if (!config.enabled) return null;
  if (!Number.isFinite(heartbeatAtMs)) return null;
  const ageMs = nowMs - heartbeatAtMs;
  if (ageMs < config.maxAgeMs) return null;
  return {
    trigger: "heartbeat_stale",
    ageMs,
    threshold: config.maxAgeMs,
  };
}

export function evaluateRelativePriceMove({ priceSamples = [], config, nowMs = Date.now() }) {
  if (!config.enabled) return null;
  if (!Array.isArray(priceSamples) || priceSamples.length < 2) return null;
  const cutoff = nowMs - config.windowMs;
  const valid = priceSamples
    .filter((s) => Number.isFinite(s.timestamp) && Number.isFinite(s.priceUsd))
    .filter((s) => s.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (valid.length < 2) return null;
  const prices = valid.map((s) => s.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min <= 0) return null;
  const move = (max - min) / min;
  if (move <= config.maxMovePct) return null;
  return {
    trigger: "relative_price_move",
    pair: config.pair,
    move,
    threshold: config.maxMovePct,
    windowMs: config.windowMs,
    sampleCount: valid.length,
  };
}

export function evaluateClRangeHealth({ clStatus = {}, config }) {
  if (!config.enabled) return null;
  const { timeInRangePct24h, ilExceedsFeesHours } = clStatus;
  if (!Number.isFinite(timeInRangePct24h) && !Number.isFinite(ilExceedsFeesHours)) {
    return null;
  }
  if (Number.isFinite(timeInRangePct24h) && timeInRangePct24h < config.minTimeInRangePct24h) {
    return {
      trigger: "cl_range_health",
      reason: "time_in_range_low",
      timeInRangePct24h,
      threshold: config.minTimeInRangePct24h,
    };
  }
  if (
    Number.isFinite(ilExceedsFeesHours) &&
    ilExceedsFeesHours > config.maxIlExceedsFeesHours
  ) {
    return {
      trigger: "cl_range_health",
      reason: "il_exceeds_fees",
      ilExceedsFeesHours,
      threshold: config.maxIlExceedsFeesHours,
    };
  }
  return null;
}

export function evaluateProtocolIncident({ activeProtocols = [], config }) {
  if (!config.enabled) return null;
  let incidentList = config.incidentList || [];
  if (config.incidentFilePath) {
    try {
      const raw = readFileSync(config.incidentFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      incidentList = Array.isArray(parsed) ? parsed : [];
    } catch {
      return null; // file missing or unreadable → not evaluated
    }
  }
  if (!Array.isArray(incidentList) || incidentList.length === 0) return null;
  if (!Array.isArray(activeProtocols) || activeProtocols.length === 0) return null;
  const hit = activeProtocols.find((p) => incidentList.includes(p));
  if (!hit) return null;
  return {
    trigger: "protocol_incident",
    protocol: hit,
    incidentList,
  };
}

export function evaluateCampaignDecay({ campaignStatus = {}, config }) {
  if (!config.enabled) return null;
  const {
    entryAprPct,
    currentAprPct,
    entryTvlUsd,
    currentTvlUsd,
    rewardTokenEntryPriceUsd,
    rewardTokenCurrentPriceUsd,
  } = campaignStatus;
  let reason = null;
  let ratio = null;
  if (
    Number.isFinite(entryAprPct) &&
    Number.isFinite(currentAprPct) &&
    entryAprPct > 0
  ) {
    const aprRatio = currentAprPct / entryAprPct;
    if (aprRatio < 1 - config.aprDecayExitPct) {
      reason = "apr_decay";
      ratio = aprRatio;
    }
  }
  if (
    !reason &&
    Number.isFinite(entryTvlUsd) &&
    Number.isFinite(currentTvlUsd) &&
    entryTvlUsd > 0
  ) {
    const tvlRatio = currentTvlUsd / entryTvlUsd;
    if (tvlRatio < 1 - config.tvlDrainExitPct) {
      reason = "tvl_drain";
      ratio = tvlRatio;
    }
  }
  if (
    !reason &&
    Number.isFinite(rewardTokenEntryPriceUsd) &&
    Number.isFinite(rewardTokenCurrentPriceUsd) &&
    rewardTokenEntryPriceUsd > 0
  ) {
    const rewardRatio = rewardTokenCurrentPriceUsd / rewardTokenEntryPriceUsd;
    if (rewardRatio < 1 - config.rewardTokenDropExitPct) {
      reason = "reward_token_drop";
      ratio = rewardRatio;
    }
  }
  if (!reason) return null;
  return {
    trigger: "campaign_decay",
    reason,
    ratio,
    config,
  };
}

export function evaluateAutoKillTriggers({
  auditRecords = [],
  oracleSamples = [],
  heartbeatAtMs = null,
  operatingCapitalUsd = null,
  priceSamples = [],
  clStatus = {},
  activeProtocols = [],
  campaignStatus = {},
  config = buildAutoKillConfig(),
  now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const triggers = [];
  const lossTrigger = evaluateCumulativeLoss({
    auditRecords,
    config: config.cumulativeLoss,
    operatingCapitalUsd,
    nowMs,
  });
  if (lossTrigger) triggers.push(lossTrigger);
  const failureTrigger = evaluateFailureBurst({
    auditRecords,
    config: config.failureBurst,
    nowMs,
  });
  if (failureTrigger) triggers.push(failureTrigger);
  const oracleTrigger = evaluateOracleDivergence({
    samples: oracleSamples,
    config: config.oracleDivergence,
  });
  if (oracleTrigger) triggers.push(oracleTrigger);
  const heartbeatTrigger = evaluateHeartbeat({
    heartbeatAtMs,
    config: config.heartbeat,
    nowMs,
  });
  if (heartbeatTrigger) triggers.push(heartbeatTrigger);
  const priceTrigger = evaluateRelativePriceMove({
    priceSamples,
    config: config.relativePriceMove,
    nowMs,
  });
  if (priceTrigger) triggers.push(priceTrigger);
  const clTrigger = evaluateClRangeHealth({
    clStatus,
    config: config.clRangeHealth,
  });
  if (clTrigger) triggers.push(clTrigger);
  const incidentTrigger = evaluateProtocolIncident({
    activeProtocols,
    config: config.protocolIncident,
  });
  if (incidentTrigger) triggers.push(incidentTrigger);
  const decayTrigger = evaluateCampaignDecay({
    campaignStatus,
    config: config.campaignDecay,
  });
  if (decayTrigger) triggers.push(decayTrigger);
  return {
    evaluatedAt: new Date(nowMs).toISOString(),
    triggered: triggers.length > 0,
    triggers,
  };
}
