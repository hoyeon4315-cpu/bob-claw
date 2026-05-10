function positionKey(position = {}) {
  return position.positionId || [
    position.chain || "unknown",
    position.protocolId || position.protocol || "unknown",
    position.poolKey || position.vaultAddress || position.marketAddress || "unknown",
  ].join(":");
}

function observedAtMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : 0;
}

function latestByPosition(positions = []) {
  const latest = new Map();
  for (const position of positions) {
    const key = positionKey(position);
    const current = latest.get(key);
    if (!current || observedAtMs(position.observedAt) >= observedAtMs(current.observedAt)) {
      latest.set(key, { ...position, positionId: key });
    }
  }
  return latest;
}

function auditPositionIds(auditRecords = []) {
  const ids = new Set();
  for (const record of auditRecords) {
    const id =
      record?.intent?.positionId ||
      record?.metadata?.positionId ||
      record?.positionId ||
      record?.lifecycle?.positionId ||
      null;
    if (id) ids.add(id);
  }
  return ids;
}

function matchesReader(position = {}, reader = {}) {
  if (reader.positionId && position.positionId === reader.positionId) return true;
  if (reader.chain && position.chain !== reader.chain) return false;
  if (reader.protocolId && position.protocolId !== reader.protocolId) return false;
  if (reader.protocol && position.protocol !== reader.protocol) return false;
  return Boolean(reader.chain || reader.protocolId || reader.protocol);
}

function staleFallbackPosition(position = {}, reader = {}, now) {
  return {
    ...position,
    visibilityStatus: "stale_reader_fallback",
    stale: true,
    staleness: {
      reason: "reader_failed_last_known_preserved",
      lastObservedAt: position.observedAt || null,
      failedAt: now,
    },
    readerError: reader.error || { message: reader.message || "reader failed" },
    source: "last_known_position",
  };
}

export function buildUniversalPositionSnapshot({
  readerResults = [],
  lastKnownPositions = [],
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const latestKnown = latestByPosition(lastKnownPositions);
  const auditIds = auditPositionIds(auditRecords);
  const positions = new Map();
  const sourceHealth = [];
  const errors = [];

  for (const reader of readerResults) {
    sourceHealth.push({
      source: reader.source || reader.readerId || null,
      chain: reader.chain || null,
      protocolId: reader.protocolId || reader.protocol || null,
      ok: reader.ok !== false,
      error: reader.ok === false ? reader.error || { message: reader.message || "reader failed" } : null,
    });

    if (reader.ok === false) {
      errors.push({
        source: reader.source || null,
        chain: reader.chain || null,
        protocolId: reader.protocolId || null,
        error: reader.error || { message: reader.message || "reader failed" },
      });
      for (const known of latestKnown.values()) {
        if (!matchesReader(known, reader)) continue;
        positions.set(known.positionId, staleFallbackPosition(known, reader, now));
      }
      continue;
    }

    for (const position of reader.positions || []) {
      const key = positionKey(position);
      positions.set(key, {
        ...position,
        positionId: key,
        visibilityStatus: "live_reader_current",
        stale: false,
        observedAt: position.observedAt || reader.observedAt || now,
        source: reader.source || "reader",
      });
    }
  }

  for (const known of latestKnown.values()) {
    if (!positions.has(known.positionId)) {
      positions.set(known.positionId, {
        ...known,
        visibilityStatus: "last_known_unread",
        stale: true,
        staleness: {
          reason: "no_reader_result_last_known_preserved",
          lastObservedAt: known.observedAt || null,
          failedAt: now,
        },
        source: "last_known_position",
      });
    }
  }

  const materialized = [...positions.values()].map((position) => ({
    ...position,
    auditBacked: auditIds.has(position.positionId),
  }));

  return {
    schemaVersion: 1,
    generatedAt: now,
    positionCount: materialized.length,
    stalePositionCount: materialized.filter((position) => position.stale).length,
    readerFailureCount: sourceHealth.filter((source) => source.ok === false).length,
    positions: materialized.sort((left, right) => String(left.positionId).localeCompare(String(right.positionId))),
    sourceHealth,
    errors,
  };
}
