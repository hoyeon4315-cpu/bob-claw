function observedAtMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function isClosePositionEvent(event = {}) {
  return event.event === "position_exit_confirmed" || event.status === "closed";
}

function positionEventObservedAtMs(event = {}) {
  const ms = observedAtMs(event.observedAt);
  if (ms === Number.NEGATIVE_INFINITY && isClosePositionEvent(event)) {
    return Number.POSITIVE_INFINITY;
  }
  return ms;
}

function positionEventPriority(event = {}) {
  return isClosePositionEvent(event) ? 1 : 0;
}

function isLaterOrEqualPositionEvent(candidate, current) {
  const candidateMs = positionEventObservedAtMs(candidate);
  const currentMs = positionEventObservedAtMs(current);
  if (candidateMs !== currentMs) return candidateMs > currentMs;
  return positionEventPriority(candidate) >= positionEventPriority(current);
}

function isOpenPositionEvent(event = {}) {
  if (isClosePositionEvent(event)) return false;
  return event.status === "open" || event.event === "position_opened";
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function protocolPositionAccountKey(event = {}) {
  const shareToken = event.shareTokenAddress || event.vaultAddress || null;
  if (!event.chain || !event.protocolId || !event.opportunityId || !event.bindingKind || !shareToken) return null;
  return [
    "protocol",
    event.chain,
    event.protocolId,
    event.opportunityId,
    event.bindingKind,
    String(shareToken).toLowerCase(),
  ].join(":");
}

function cloneJsonEvent(event) {
  if (event === null || event === undefined) return event;
  return JSON.parse(JSON.stringify(event));
}

function malformedMarkFailure(mark) {
  return {
    event: "position_mark_failed",
    positionId: mark.positionId,
    observedAt: mark.observedAt || null,
    failureKind: "invalid_mark_value_usd",
    message: "Latest successful protocol position mark has non-finite valueUsd",
    mark: cloneJsonEvent(mark),
  };
}

export function activeProtocolPositions(events = []) {
  const latestByPosition = new Map();

  for (const event of events) {
    const positionId = event?.positionId;
    if (!positionId) continue;

    const current = latestByPosition.get(positionId);
    if (!current || isLaterOrEqualPositionEvent(event, current)) {
      latestByPosition.set(positionId, event);
    }
  }

  const active = [...latestByPosition.values()]
    .filter((event) => isOpenPositionEvent(event))
    .sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));

  const grouped = new Map();
  const passthrough = [];

  for (const event of active) {
    const key = protocolPositionAccountKey(event);
    if (!key) {
      passthrough.push(event);
      continue;
    }
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...event,
        positionId: key,
        logicalPositionId: key,
        sourcePositionIds: [event.positionId],
        sourcePositionCount: 1,
        amountUsd: finiteNumberOrNull(event.amountUsd) ?? 0,
      });
      continue;
    }

    const latest = isLaterOrEqualPositionEvent(event, current) ? event : current;
    grouped.set(key, {
      ...current,
      ...latest,
      positionId: key,
      logicalPositionId: key,
      sourcePositionIds: [...current.sourcePositionIds, event.positionId],
      sourcePositionCount: current.sourcePositionCount + 1,
      amountUsd: (finiteNumberOrNull(current.amountUsd) ?? 0) + (finiteNumberOrNull(event.amountUsd) ?? 0),
    });
  }

  return [...passthrough, ...grouped.values()]
    .sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));
}

export function latestProtocolMarksByPosition(marks = []) {
  const latest = new Map();

  for (const mark of marks) {
    const positionId = mark?.positionId;
    if (!positionId) continue;

    const current = latest.get(positionId);
    if (!current || observedAtMs(mark.observedAt) >= observedAtMs(current.observedAt)) {
      latest.set(positionId, mark);
    }
  }

  return latest;
}

export function mergeProtocolMarksIntoPositions(positions = [], marksByPosition = new Map()) {
  return positions.map((position) => {
    const mark = marksByPosition.get(position?.positionId);
    if (!mark) return { ...position };

    if (mark.event === "position_mark_failed") {
      return { ...position, markFailure: cloneJsonEvent(mark) };
    }

    const markUsd = finiteNumberOrNull(mark.valueUsd);
    if (markUsd === null) {
      return { ...position, markFailure: malformedMarkFailure(mark) };
    }

    const valueBtc = finiteNumberOrNull(mark.valueBtc);
    const markClone = cloneJsonEvent(mark);

    return {
      ...position,
      markUsd,
      valueUsd: markUsd,
      currentValueUsd: markUsd,
      valueBtc: valueBtc === null ? position.valueBtc : valueBtc,
      markObservedAt: mark.observedAt || null,
      markSource: "protocol_position_mark",
      markFreshness: mark.freshness || null,
      markConfidence: mark.confidence || null,
      mark: markClone,
    };
  });
}
