import { freshnessForObservedAt } from "../treasury/protocol-position-mark-schema.mjs";

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

export function buildProtocolPositionMarksSlice(
  marks = [],
  { generatedAt = new Date().toISOString(), activePositionIds = null } = {},
) {
  const activeIdSet = Array.isArray(activePositionIds) && activePositionIds.length > 0
    ? new Set(activePositionIds)
    : null;
  const latest = latestMarks(marks)
    .filter((mark) => !activeIdSet || activeIdSet.has(mark.positionId));
  const byChain = {};
  let totalMarkedUsd = 0;
  let markedPositionCount = 0;
  let failedPositionCount = 0;
  let stalePositionCount = 0;
  let expiredPositionCount = 0;

  const items = latest.map((mark) => {
    const freshness = markFreshness(mark, generatedAt);
    const valueUsd = finiteNumber(mark.valueUsd);
    const successful = isSuccessfulMarkedPosition(mark);

    if (mark.event === "position_mark_failed" || freshness === "failed") failedPositionCount += 1;
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
    };
  });

  for (const bucket of Object.values(byChain)) {
    bucket.valueUsd = roundUsd(bucket.valueUsd);
  }

  const confidence =
    latest.length > 0 && latest.every((mark) => isVerifiedCurrentMark(mark, generatedAt))
      ? "verified_current"
      : "verified_minimum";

  return {
    schemaVersion: 1,
    generatedAt,
    markRecordCount: marks.length,
    latestPositionCount: latest.length,
    markedPositionCount,
    failedPositionCount,
    stalePositionCount,
    expiredPositionCount,
    totalMarkedUsd: roundUsd(totalMarkedUsd),
    confidence,
    byChain,
    items,
  };
}
