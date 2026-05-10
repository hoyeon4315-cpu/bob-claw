function hasBroadcastEvidence(record = {}) {
  return (
    Boolean(record.broadcast) ||
    ["broadcasted", "confirmed", "reverted"].includes(record.lifecycle?.stage || null)
  );
}

function recordTimestamp(record = {}) {
  return record.timestamp || record.observedAt || null;
}

export function replayAuditForCapitalGaps({ auditRecords = [], capitalAuditRecords = [] } = {}) {
  const unmatchedByStrategy = new Map();
  const matchedHashes = new Set(capitalAuditRecords.map((r) => r.intentHash).filter(Boolean));

  for (const record of auditRecords) {
    if (!hasBroadcastEvidence(record)) continue;
    if (!record.intentHash) continue;
    if (matchedHashes.has(record.intentHash)) continue;

    const strategyId = record.strategyId || "unknown";
    const existing = unmatchedByStrategy.get(strategyId);
    const ts = recordTimestamp(record);

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
