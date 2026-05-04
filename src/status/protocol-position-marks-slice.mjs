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
  const rolling1h = rollingReliabilityWindow(marks, { generatedAt, windowMs: ROLLING_1H_MS });
  const rolling3h = rollingReliabilityWindow(marks, { generatedAt, windowMs: ROLLING_3H_MS });
  const rolling24h = rollingReliabilityWindow(marks, { generatedAt, windowMs: ROLLING_24H_MS });
  const rolling7d = rollingReliabilityWindow(marks, { generatedAt, windowMs: ROLLING_7D_MS });
  const refreshBelow90Since = refreshBelowThresholdSince(marks, {
    generatedAt,
    windowMs: ROLLING_24H_MS,
    threshold: STAGE_C_HYSTERESIS_THRESHOLD,
  });
  const refreshBelow90SustainedFor1h =
    Boolean(refreshBelow90Since) &&
    observedAtMs(generatedAt) - observedAtMs(refreshBelow90Since) >= STAGE_C_HYSTERESIS_SUSTAIN_MS;
  const latestSuccess = latestAttemptMark(marks, (mark) => isSuccessfulMarkedPosition(mark));
  const latestFailure = latestAttemptMark(marks, (mark) => mark.event === "position_mark_failed");

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
