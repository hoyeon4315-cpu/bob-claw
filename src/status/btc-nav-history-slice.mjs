function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function buildBtcNavHistoryRecord({
  observedAt = new Date().toISOString(),
  totalUsd = null,
  btcUsd = null,
  totalBtc = null,
  source = "money_loop",
  attribution = null,
} = {}) {
  const resolvedBtcUsd = finiteNumber(btcUsd);
  const resolvedTotalUsd = finiteNumber(totalUsd);
  const resolvedTotalBtc = finiteNumber(totalBtc) ?? (
    resolvedBtcUsd && resolvedTotalUsd !== null ? resolvedTotalUsd / resolvedBtcUsd : null
  );
  return {
    schemaVersion: 1,
    observedAt,
    totalUsd: resolvedTotalUsd,
    btcUsd: resolvedBtcUsd,
    totalBtc: resolvedTotalBtc,
    source,
    attribution,
  };
}

export function buildBtcNavHistorySlice(records = [], { generatedAt = new Date().toISOString(), limit = 120 } = {}) {
  const clean = records
    .filter((record) => record && record.observedAt)
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
    .slice(-limit);
  const latest = clean.at(-1) || null;
  return {
    schemaVersion: 1,
    generatedAt,
    recordCount: records.length,
    returnedCount: clean.length,
    latest,
    series: clean,
  };
}
