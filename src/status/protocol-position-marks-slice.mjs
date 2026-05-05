import { freshnessForObservedAt } from "../treasury/protocol-position-mark-schema.mjs";
import {
  detectTransientDegradation,
  isTransientFailureMark,
} from "../treasury/protocol-position-ledger.mjs";

const ROLLING_1H_MS = 60 * 60 * 1000;
const ROLLING_3H_MS = 3 * 60 * 60 * 1000;
const ROLLING_24H_MS = 24 * 60 * 60 * 1000;
const ROLLING_7D_MS = 7 * 24 * 60 * 60 * 1000;
const STAGE_C_HYSTERESIS_THRESHOLD = 0.9;
const STAGE_C_HYSTERESIS_SUSTAIN_MS = 60 * 60 * 1000;

function observedAtMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundUsd(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function latestMarks(marks = []) {
  const latest = new Map();
  for (const mark of marks) {
    if (!mark?.positionId) continue;
    const current = latest.get(mark.positionId);
    if (!current || observedAtMs(mark.observedAt) >= observedAtMs(current.observedAt)) {
      latest.set(mark.positionId, mark);
    }
  }
  return [...latest.values()].sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));
}

function markFreshness(mark = {}, generatedAt) {
  if (mark.event === "position_mark_failed") return "failed";
  return mark.freshness || freshnessForObservedAt(mark.observedAt, generatedAt);
}

function isSuccessfulMarkedPosition(mark = {}) {
  return mark.event === "position_marked" && finiteNumber(mark.valueUsd) !== null;
}

function isVerifiedCurrentMark(mark = {}, generatedAt) {
  if (!isSuccessfulMarkedPosition(mark)) return false;
  const freshness = markFreshness(mark, generatedAt);
  return mark.confidence === "verified_current" || freshness === "fresh" || freshness === "recent";
}

function chainBucket(byChain, chain) {
  const key = chain || "unknown";
  byChain[key] ||= { valueUsd: 0, count: 0 };
  return byChain[key];
}

function attemptOutcome(mark = {}) {
  if (isSuccessfulMarkedPosition(mark)) return "success";
  if (mark.event === "position_mark_failed") return "failure";
  return null;
}

function marksInWindow(marks = [], generatedAt, windowMs) {
  const generatedAtMs = observedAtMs(generatedAt);
  return marks.filter((mark) => {
    const observed = observedAtMs(mark.observedAt);
    return Number.isFinite(observed) && observed >= generatedAtMs - windowMs && observed <= generatedAtMs;
  });
}

function rollingReliabilityWindow(marks = [], { generatedAt, windowMs } = {}) {
  const attempts = marksInWindow(marks, generatedAt, windowMs).filter((mark) => attemptOutcome(mark));
  const successCount = attempts.filter((mark) => attemptOutcome(mark) === "success").length;
  const failureCount = attempts.length - successCount;
  const transientCount = attempts.filter((mark) => mark.event === "position_mark_failed" && isTransientFailureMark(marks, mark)).length;
  return {
    attemptCount: attempts.length,
    successCount,
    failureCount,
    transientCount,
    refreshSuccessRatio: attempts.length > 0 ? successCount / attempts.length : null,
    transientFrequency: attempts.length > 0 ? transientCount / attempts.length : null,
    oldestObservedAt: attempts[0]?.observedAt || null,
    latestObservedAt: attempts.at(-1)?.observedAt || null,
  };
}

function attemptsForWindow(marks = [], { generatedAt, windowMs } = {}) {
  return marksInWindow(marks, generatedAt, windowMs)
    .filter((mark) => attemptOutcome(mark))
    .sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));
}

function failureClassForMark(mark = {}) {
  const failureKind = String(mark.failureKind || "").toLowerCase();
  const message = String(mark.message || "").toLowerCase();
  if (failureKind === "adapter_missing" || failureKind === "no_reader_no_adapter") return "binding_stale";
  if (failureKind === "inventory_drift" || /\binventory\b|zero[_ ]shares|no active position/u.test(message)) {
    return "inventory_drift";
  }
  if (
    failureKind === "rpc_failed" ||
    failureKind === "reader_throw" ||
    /missing revert data|call_exception|network|timeout|econn|server_error|rate limit|429/u.test(message)
  ) {
    return "rpc_transient";
  }
  if (failureKind === "adapter_error") return "reader_bug";
  return "other";
}

function incrementCount(map, key) {
  const normalized = key || "unknown";
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedCountEntries(map, keyName, total) {
  return [...map.entries()]
    .map(([key, count]) => ({
      [keyName]: key,
      failureCount: count,
      failureShare: total > 0 ? count / total : null,
    }))
    .sort((left, right) => {
      const countDelta = right.failureCount - left.failureCount;
      if (countDelta !== 0) return countDelta;
      return String(left[keyName]).localeCompare(String(right[keyName]));
    });
}

function topCountKey(map) {
  return sortedCountEntries(map, "key", [...map.values()].reduce((sum, value) => sum + value, 0))[0]?.key || null;
}

function messageSampleKey(mark = {}) {
  const message = String(mark.message || "").trim();
  if (!message) return null;
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function buildFailureAttributionWindow(marks = [], { generatedAt, windowMs } = {}) {
  const attempts = attemptsForWindow(marks, { generatedAt, windowMs });
  const failures = attempts.filter((mark) => mark.event === "position_mark_failed");
  const failureTotal = failures.length;
  const byPosition = new Map();
  const byChain = new Map();
  const byFailureKind = new Map();
  const byFailureClass = new Map();

  function ensureBucket(map, key, base = {}) {
    const normalized = key || "unknown";
    if (!map.has(normalized)) {
      map.set(normalized, {
        ...base,
        attemptCount: 0,
        successCount: 0,
        failureCount: 0,
        failureKindCounts: new Map(),
        failureClassCounts: new Map(),
        messageCounts: new Map(),
        latestFailureAt: null,
        latestSuccessAt: null,
      });
    }
    return map.get(normalized);
  }

  for (const mark of attempts) {
    const outcome = attemptOutcome(mark);
    const positionBucket = ensureBucket(byPosition, mark.positionId, {
      positionId: mark.positionId || "unknown",
      chain: mark.chain || null,
      protocolId: mark.protocolId || null,
      strategyId: mark.strategyId || null,
    });
    const chainBucket = ensureBucket(byChain, mark.chain, {
      chain: mark.chain || "unknown",
    });

    for (const bucket of [positionBucket, chainBucket]) {
      bucket.attemptCount += 1;
      if (outcome === "success") {
        bucket.successCount += 1;
        bucket.latestSuccessAt = mark.observedAt || bucket.latestSuccessAt;
      }
    }

    if (outcome !== "failure") continue;
    const failureKind = mark.failureKind || "unknown";
    const failureClass = failureClassForMark(mark);
    const sample = messageSampleKey(mark);
    incrementCount(byFailureKind, failureKind);
    incrementCount(byFailureClass, failureClass);
    for (const bucket of [positionBucket, chainBucket]) {
      bucket.failureCount += 1;
      bucket.latestFailureAt = mark.observedAt || bucket.latestFailureAt;
      incrementCount(bucket.failureKindCounts, failureKind);
      incrementCount(bucket.failureClassCounts, failureClass);
      if (sample) incrementCount(bucket.messageCounts, sample);
    }
  }

  function finishBucket(bucket, identityKey) {
    const failureKind = topCountKey(bucket.failureKindCounts);
    const failureClass = topCountKey(bucket.failureClassCounts);
    const entry = {
      [identityKey]: bucket[identityKey],
      attemptCount: bucket.attemptCount,
      successCount: bucket.successCount,
      failureCount: bucket.failureCount,
      successRatio: bucket.attemptCount > 0 ? bucket.successCount / bucket.attemptCount : null,
      failureShare: failureTotal > 0 ? bucket.failureCount / failureTotal : null,
      failureKind,
      failureClass,
      latestFailureAt: bucket.latestFailureAt,
      latestSuccessAt: bucket.latestSuccessAt,
      messageSamples: sortedCountEntries(bucket.messageCounts, "message", bucket.failureCount).slice(0, 3),
    };
    if (identityKey === "positionId") {
      entry.chain = bucket.chain;
      entry.protocolId = bucket.protocolId;
      entry.strategyId = bucket.strategyId;
    }
    return entry;
  }

  const positionEntries = [...byPosition.values()]
    .filter((bucket) => bucket.failureCount > 0)
    .map((bucket) => finishBucket(bucket, "positionId"))
    .sort((left, right) => {
      const countDelta = right.failureCount - left.failureCount;
      if (countDelta !== 0) return countDelta;
      return String(left.positionId).localeCompare(String(right.positionId));
    });

  const chainEntries = [...byChain.values()]
    .filter((bucket) => bucket.failureCount > 0)
    .map((bucket) => {
      const entry = finishBucket(bucket, "chain");
      delete entry.protocolId;
      delete entry.strategyId;
      return entry;
    })
    .sort((left, right) => {
      const countDelta = right.failureCount - left.failureCount;
      if (countDelta !== 0) return countDelta;
      return String(left.chain).localeCompare(String(right.chain));
    });

  return {
    windowMs,
    attemptCount: attempts.length,
    successCount: attempts.length - failureTotal,
    failureCount: failureTotal,
    byFailureKind: sortedCountEntries(byFailureKind, "failureKind", failureTotal),
    byFailureClass: sortedCountEntries(byFailureClass, "failureClass", failureTotal),
    byChain: chainEntries,
    byPosition: positionEntries,
  };
}

function successesNeededForThreshold({ attemptCount, successCount, threshold }) {
  if (!Number.isFinite(attemptCount) || attemptCount <= 0) return null;
  if (!Number.isFinite(successCount) || successCount < 0) return null;
  if (!Number.isFinite(threshold) || !(threshold > 0) || !(threshold < 1)) return null;
  const thresholdBps = Math.round(threshold * 10_000);
  const currentRatioBps = successCount * 10_000;
  if (currentRatioBps >= thresholdBps * attemptCount) return 0;
  const numerator = (thresholdBps * attemptCount) - currentRatioBps;
  const denominator = 10_000 - thresholdBps;
  return Math.max(1, Math.ceil(numerator / denominator));
}

function earliestThresholdRecoveryAtFromAging(attempts = [], { generatedAt, windowMs, threshold } = {}) {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  if (!Number.isFinite(threshold) || !(threshold > 0) || !Number.isFinite(windowMs) || windowMs <= 0) return null;
  const currentSuccessCount = attempts.filter((mark) => attemptOutcome(mark) === "success").length;
  if ((currentSuccessCount / attempts.length) >= threshold) return generatedAt || null;
  const dropTimestamps = [...new Set(attempts.map((mark) => observedAtMs(mark.observedAt)).filter(Number.isFinite))];
  for (const observedMs of dropTimestamps) {
    const candidateMs = observedMs + windowMs + 1;
    const remaining = attempts.filter((mark) => observedAtMs(mark.observedAt) >= candidateMs - windowMs);
    if (remaining.length === 0) continue;
    const remainingSuccessCount = remaining.filter((mark) => attemptOutcome(mark) === "success").length;
    if ((remainingSuccessCount / remaining.length) >= threshold) {
      return new Date(candidateMs).toISOString();
    }
  }
  return null;
}

function thresholdRecoveryWindow(marks = [], { generatedAt, windowMs, threshold } = {}) {
  const attempts = attemptsForWindow(marks, { generatedAt, windowMs });
  const successCount = attempts.filter((mark) => attemptOutcome(mark) === "success").length;
  const failureCount = attempts.length - successCount;
  return {
    threshold,
    attemptCount: attempts.length,
    successCount,
    failureCount,
    successesNeeded: successesNeededForThreshold({
      attemptCount: attempts.length,
      successCount,
      threshold,
    }),
    earliestRecoveryAt: earliestThresholdRecoveryAtFromAging(attempts, {
      generatedAt,
      windowMs,
      threshold,
    }),
  };
}

function latestAttemptMark(marks = [], predicate = () => true) {
  let latest = null;
  for (const mark of marks) {
    if (!attemptOutcome(mark) || !predicate(mark)) continue;
    if (!latest || observedAtMs(mark.observedAt) >= observedAtMs(latest.observedAt)) {
      latest = mark;
    }
  }
  return latest;
}

function refreshBelowThresholdSince(marks = [], {
  generatedAt,
  windowMs = ROLLING_24H_MS,
  threshold = STAGE_C_HYSTERESIS_THRESHOLD,
} = {}) {
  const attempts = marks
    .filter((mark) => attemptOutcome(mark))
    .sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));
  if (attempts.length === 0) return null;

  let start = 0;
  let successCount = 0;
  let attemptCount = 0;
  let belowSince = null;
  let latestRatio = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const mark = attempts[index];
    const currentMs = observedAtMs(mark.observedAt);
    attemptCount += 1;
    if (attemptOutcome(mark) === "success") successCount += 1;

    while (start <= index && observedAtMs(attempts[start].observedAt) < currentMs - windowMs) {
      attemptCount -= 1;
      if (attemptOutcome(attempts[start]) === "success") successCount -= 1;
      start += 1;
    }

    latestRatio = attemptCount > 0 ? successCount / attemptCount : null;
    if (Number.isFinite(latestRatio) && latestRatio < threshold) {
      belowSince ||= mark.observedAt || null;
    } else {
      belowSince = null;
    }
  }

  return Number.isFinite(latestRatio) && latestRatio < threshold ? belowSince : null;
}

export function buildProtocolPositionMarksSlice(
  marks = [],
  { generatedAt = new Date().toISOString(), activePositionIds = null } = {},
) {
  const activeIdSet = Array.isArray(activePositionIds) && activePositionIds.length > 0
    ? new Set(activePositionIds)
    : null;
  const scopedMarks = activeIdSet
    ? marks.filter((mark) => activeIdSet.has(mark?.positionId))
    : marks;
  const latest = latestMarks(marks)
    .filter((mark) => !activeIdSet || activeIdSet.has(mark.positionId));
  
  // Detect transient degradation: latest failure with recent prior success within grace window
  const latestMarkMap = new Map();
  for (const mark of latest) {
    latestMarkMap.set(mark.positionId, mark);
  }
  const transientDegradations = detectTransientDegradation(marks, latestMarkMap);
  
  const byChain = {};
  let totalMarkedUsd = 0;
  let markedPositionCount = 0;
  let failedPositionCount = 0;
  let stalePositionCount = 0;
  let expiredPositionCount = 0;
  let transientDegradedCount = 0;

  const items = latest.map((mark) => {
    const freshness = markFreshness(mark, generatedAt);
    const valueUsd = finiteNumber(mark.valueUsd);
    const successful = isSuccessfulMarkedPosition(mark);
    const isTransientDegraded = transientDegradations.has(mark.positionId);

    if (mark.event === "position_mark_failed" || freshness === "failed") {
      failedPositionCount += 1;
      if (isTransientDegraded) transientDegradedCount += 1;
    }
    if (freshness === "stale") stalePositionCount += 1;
    if (freshness === "expired") expiredPositionCount += 1;

    if (successful) {
      totalMarkedUsd += valueUsd;
      markedPositionCount += 1;
      const bucket = chainBucket(byChain, mark.chain);
      bucket.valueUsd += valueUsd;
      bucket.count += 1;
    }

    return {
      positionId: mark.positionId,
      event: mark.event || null,
      status: mark.status || null,
      chain: mark.chain || null,
      protocolId: mark.protocolId || null,
      opportunityId: mark.opportunityId || null,
      strategyId: mark.strategyId || null,
      valueUsd,
      valueBtc: finiteNumber(mark.valueBtc),
      observedAt: mark.observedAt || null,
      freshness,
      confidence: mark.confidence || null,
      markSource: mark.markSource || null,
      adapterId: mark.adapterId || null,
      failureKind: mark.failureKind || null,
      message: mark.message || null,
      isTransientDegraded,
    };
  });

  for (const bucket of Object.values(byChain)) {
    bucket.valueUsd = roundUsd(bucket.valueUsd);
  }

  const confidence =
    latest.length > 0 && latest.every((mark) => isVerifiedCurrentMark(mark, generatedAt))
      ? "verified_current"
      : "verified_minimum";

  const transientDegradedWarning = transientDegradedCount > 0
    ? {
        message: `${transientDegradedCount} protocol position mark(s) experienced transient RPC failures, but recent successful observations available.`,
        count: transientDegradedCount,
        observedAt: new Date().toISOString(),
      }
    : null;
  const rolling1h = rollingReliabilityWindow(scopedMarks, { generatedAt, windowMs: ROLLING_1H_MS });
  const rolling3h = rollingReliabilityWindow(scopedMarks, { generatedAt, windowMs: ROLLING_3H_MS });
  const rolling24h = rollingReliabilityWindow(scopedMarks, { generatedAt, windowMs: ROLLING_24H_MS });
  const rolling7d = rollingReliabilityWindow(scopedMarks, { generatedAt, windowMs: ROLLING_7D_MS });
  const failureAttribution24h = buildFailureAttributionWindow(scopedMarks, {
    generatedAt,
    windowMs: ROLLING_24H_MS,
  });
  const refreshBelow90Since = refreshBelowThresholdSince(scopedMarks, {
    generatedAt,
    windowMs: ROLLING_24H_MS,
    threshold: STAGE_C_HYSTERESIS_THRESHOLD,
  });
  const refreshBelow90SustainedFor1h =
    Boolean(refreshBelow90Since) &&
    observedAtMs(generatedAt) - observedAtMs(refreshBelow90Since) >= STAGE_C_HYSTERESIS_SUSTAIN_MS;
  const latestSuccess = latestAttemptMark(scopedMarks, (mark) => isSuccessfulMarkedPosition(mark));
  const latestFailure = latestAttemptMark(scopedMarks, (mark) => mark.event === "position_mark_failed");
  const recovery24hStageB = thresholdRecoveryWindow(scopedMarks, {
    generatedAt,
    windowMs: ROLLING_24H_MS,
    threshold: 0.95,
  });
  const recovery24hHysteresis = thresholdRecoveryWindow(scopedMarks, {
    generatedAt,
    windowMs: ROLLING_24H_MS,
    threshold: STAGE_C_HYSTERESIS_THRESHOLD,
  });

  return {
    schemaVersion: 2,
    generatedAt,
    markRecordCount: marks.length,
    latestPositionCount: latest.length,
    markedPositionCount,
    failedPositionCount,
    stalePositionCount,
    expiredPositionCount,
    transientDegradedCount,
    totalMarkedUsd: roundUsd(totalMarkedUsd),
    confidence,
    transientDegradedWarning,
    refreshSuccessRatio: {
      rolling1h: rolling1h.refreshSuccessRatio,
      rolling3h: rolling3h.refreshSuccessRatio,
      rolling24h: rolling24h.refreshSuccessRatio,
      rolling7d: rolling7d.refreshSuccessRatio,
    },
    transientFrequency: {
      rolling1h: rolling1h.transientFrequency,
      rolling3h: rolling3h.transientFrequency,
      rolling24h: rolling24h.transientFrequency,
      rolling7d: rolling7d.transientFrequency,
    },
    reliability: {
      rolling1h,
      rolling3h,
      rolling24h,
      rolling7d,
      hysteresis: {
        refreshBelow90Since,
        refreshBelow90SustainedFor1h,
        threshold: STAGE_C_HYSTERESIS_THRESHOLD,
        sustainMs: STAGE_C_HYSTERESIS_SUSTAIN_MS,
      },
      recovery24h: {
        stageB: recovery24hStageB,
        hysteresis: recovery24hHysteresis,
      },
      failureAttribution: {
        window24h: failureAttribution24h,
      },
      latestAttempt: {
        successObservedAt: latestSuccess?.observedAt || null,
        failureObservedAt: latestFailure?.observedAt || null,
        failureKind: latestFailure?.failureKind || null,
        failurePositionId: latestFailure?.positionId || null,
      },
    },
    byChain,
    items,
  };
}
