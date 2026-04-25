// Pure trigger evaluator for the auto kill-switch.
// Inputs: audit-log records, oracle samples, heartbeat timestamp, config.
// Output: { triggered: boolean, triggers: [...], evaluatedAt }.
// The caller decides whether to write the kill-switch file (see
// `src/risk/auto-kill-events.mjs`). This module never touches the
// filesystem so it stays unit-testable and side-effect-free.

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

export function evaluateAutoKillTriggers({
  auditRecords = [],
  oracleSamples = [],
  heartbeatAtMs = null,
  operatingCapitalUsd = null,
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
  return {
    evaluatedAt: new Date(nowMs).toISOString(),
    triggered: triggers.length > 0,
    triggers,
  };
}
