function hasBroadcastEvidence(record = {}) {
  return (
    Boolean(record.broadcast) || ["broadcasted", "confirmed", "reverted"].includes(record.lifecycle?.stage || null)
  );
}

function isApprovalOnlyHelper(record = {}) {
  const intent = record.intent || {};
  return intent.intentType === "approve_exact";
}

function recordTimestamp(record = {}) {
  return record.timestamp || record.observedAt || null;
}

function latestBackfillActivationAt(records = []) {
  return (
    records
      .filter((record) => String(record.source || "").includes("backfill"))
      .map((record) => record.observedAt || record.timestamp || null)
      .filter(Boolean)
      .sort()
      .at(-1) || null
  );
}

function hasClosedCapitalAuditRecord(record = {}) {
  if (!record?.intentHash) return false;
  if (record.validation && record.validation.ok === false) return false;
  if (record.status && !["closed", "reconciled", "final_failed"].includes(record.status)) return false;
  if (record.reconciliationStatus && !["reconciled", "failed", "final_failed"].includes(record.reconciliationStatus))
    return false;
  return true;
}

export function replayAuditForCapitalGaps({ auditRecords = [], capitalAuditRecords = [] } = {}) {
  const unmatchedByStrategy = new Map();
  const matchedHashes = new Set(
    capitalAuditRecords
      .filter(hasClosedCapitalAuditRecord)
      .map((r) => r.intentHash)
      .filter(Boolean),
  );
  const seenUnmatched = new Set();
  const backfillActivationAt = latestBackfillActivationAt(capitalAuditRecords);

  for (const record of auditRecords) {
    if (!hasBroadcastEvidence(record)) continue;
    if (isApprovalOnlyHelper(record)) continue;
    const gapKey =
      record.intentHash ||
      `missing_intent_hash:${record.strategyId || "unknown"}:${record.lifecycle?.txHash || record.broadcast?.txHash || record.txHash || recordTimestamp(record) || "unknown"}`;
    if (matchedHashes.has(record.intentHash)) continue;
    if (seenUnmatched.has(gapKey)) continue;
    seenUnmatched.add(gapKey);

    const strategyId = record.strategyId || "unknown";
    const existing = unmatchedByStrategy.get(strategyId);
    const ts = recordTimestamp(record);
    if (backfillActivationAt && ts && ts < backfillActivationAt) continue;

    if (!existing) {
      unmatchedByStrategy.set(strategyId, {
        strategyId,
        unmatchedCount: 1,
        latestUnmatchedAt: ts,
      });
    } else {
      existing.unmatchedCount += 1;
      if (ts && (!existing.latestUnmatchedAt || ts > existing.latestUnmatchedAt)) {
        existing.latestUnmatchedAt = ts;
      }
    }
  }

  return {
    flaggedStrategies: Array.from(unmatchedByStrategy.values()),
  };
}
