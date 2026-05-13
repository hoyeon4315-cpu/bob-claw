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

function signerRecordObservedAt(record = {}) {
  return record.timestamp || record.observedAt || record.lifecycle?.observedAt || null;
}

function signerRecordStage(record = {}) {
  return record.lifecycle?.stage || record.stage || null;
}

function signerIntent(record = {}) {
  return record.intent && typeof record.intent === "object" ? record.intent : {};
}

function signerIntentMetadata(record = {}) {
  const intent = signerIntent(record);
  return intent.metadata && typeof intent.metadata === "object" ? intent.metadata : {};
}

function signerProtocolId(record = {}) {
  const intent = signerIntent(record);
  const metadata = signerIntentMetadata(record);
  return metadata.protocolId || metadata.protocol || intent.protocolId || record.protocolId || null;
}

function signerBindingKind(record = {}) {
  const intent = signerIntent(record);
  const metadata = signerIntentMetadata(record);
  if (intent.intentType === "pendle_yt_entry" || intent.intentType === "pendle_yt_exit") {
    return "pendle_market_swap";
  }
  return metadata.bindingKind || intent.bindingKind || record.bindingKind || "erc4626_vault_supply_withdraw";
}

function signerShareTokenAddress(record = {}) {
  const intent = signerIntent(record);
  const metadata = signerIntentMetadata(record);
  if (intent.intentType === "pendle_yt_entry" || intent.intentType === "pendle_yt_exit") {
    return metadata.marketAddress || metadata.pendleMarketAddress || null;
  }
  return metadata.shareTokenAddress || metadata.vaultAddress || metadata.expectedTxTo || null;
}

function signerPositionAction(record = {}) {
  const intent = signerIntent(record);
  const metadata = signerIntentMetadata(record);
  const action = String(metadata.exposureAction || "").toLowerCase();
  if (action === "open") return "open";
  if (["close", "exit", "redeem", "withdraw"].includes(action)) return "close";
  if (intent.intentType === "erc4626_deposit" || intent.intentType === "pendle_yt_entry") return "open";
  if (intent.intentType === "erc4626_redeem" || intent.intentType === "pendle_yt_exit") return "close";
  return null;
}

function signerProtocolPositionFields(record = {}) {
  const intent = signerIntent(record);
  const metadata = signerIntentMetadata(record);
  return {
    intent,
    metadata,
    chain: record.chain || intent.chain || metadata.chain || null,
    protocolId: signerProtocolId(record),
    opportunityId: metadata.opportunityId || intent.opportunityId || record.opportunityId || null,
    bindingKind: signerBindingKind(record),
    shareTokenAddress: signerShareTokenAddress(record),
  };
}

function hasRequiredSignerProtocolFields(fields = {}) {
  return Boolean(
    fields.chain &&
      fields.protocolId &&
      fields.opportunityId &&
      fields.bindingKind &&
      fields.shareTokenAddress,
  );
}

function signerProtocolPositionEvent(record = {}) {
  const action = signerRecordStage(record) === "confirmed" ? signerPositionAction(record) : null;
  if (!action) return null;
  const fields = signerProtocolPositionFields(record);
  if (!hasRequiredSignerProtocolFields(fields)) return null;

  const observedAt = signerRecordObservedAt(record);
  const positionId = [
    "signer",
    fields.chain,
    fields.protocolId,
    fields.opportunityId,
    fields.bindingKind,
    String(fields.shareTokenAddress).toLowerCase(),
  ].join(":");

  return {
    event: action === "open" ? "position_opened" : "position_exit_confirmed",
    status: action === "open" ? "open" : "closed",
    observedAt,
    positionId,
    opportunityId: fields.opportunityId,
    strategyId: record.strategyId || fields.intent.strategyId || fields.metadata.strategyId || null,
    chain: fields.chain,
    protocolId: fields.protocolId,
    bindingKind: fields.bindingKind,
    amountUsd: finiteNumberOrNull(fields.intent.amountUsd ?? fields.metadata.capCheckAmountUsd),
    vaultAddress: fields.shareTokenAddress,
    shareTokenAddress: fields.shareTokenAddress,
    assetAddress: fields.metadata.assetAddress || fields.metadata.inputTokenAddress || null,
    marketAddress: fields.metadata.marketAddress || fields.metadata.pendleMarketAddress || fields.shareTokenAddress,
    name: fields.metadata.name || fields.metadata.marketLabel || `${fields.protocolId} ${fields.opportunityId}`,
    source: "signer_audit_confirmed_intent",
    sourceIntentHash: record.intentHash || null,
    sourceTxHash: record.lifecycle?.txHash || record.broadcast?.txHash || record.txHash || null,
    liveMarkRequired: true,
  };
}

export function protocolPositionEventsFromSignerAudit(records = []) {
  return records
    .map((record) => signerProtocolPositionEvent(record))
    .filter(Boolean)
    .sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));
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

function isRetryableFailure(failureKind) {
  return failureKind === "rpc_failed" || failureKind === "reader_throw";
}

function getRecentSuccessIfTransient(marks = [], latestMark) {
  if (!latestMark || latestMark.event !== "position_mark_failed" || !isRetryableFailure(latestMark.failureKind)) {
    return null;
  }

  const positionId = latestMark?.positionId;
  const latestFailureMs = observedAtMs(latestMark.observedAt);
  const GRACE_WINDOW_MS = 5 * 60 * 1000; // 5 min grace for isolated transient failures

  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark?.positionId !== positionId || !mark.observedAt) continue;
    if (mark.event !== "position_marked") continue;

    const successMs = observedAtMs(mark.observedAt);
    if (successMs >= latestFailureMs) continue; // must be before the failure
    if (latestFailureMs - successMs > GRACE_WINDOW_MS) break; // beyond grace window

    return mark;
  }
  return null;
}

export function isTransientFailureMark(marks = [], mark = null) {
  return Boolean(getRecentSuccessIfTransient(marks, mark));
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

export function detectTransientDegradation(marks = [], latestMarksByPosition = new Map()) {
  const transientByPosition = new Map();

  for (const [positionId, latestMark] of latestMarksByPosition.entries()) {
    const recentSuccess = getRecentSuccessIfTransient(marks, latestMark);
    if (recentSuccess) {
      transientByPosition.set(positionId, {
        positionId,
        latestFailure: latestMark,
        recentSuccess,
        failureKind: latestMark.failureKind,
        observedAt: latestMark.observedAt,
      });
    }
  }

  return transientByPosition;
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
