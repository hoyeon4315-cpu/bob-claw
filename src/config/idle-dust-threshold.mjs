const DEFAULT_MIN_IDLE_USD = 5;
const DEFAULT_MIN_IDLE_AGE_MS = 72 * 60 * 60 * 1000;
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MIN_SAMPLES = 3;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function observedAt(record = {}) {
  return record.timestamp || record.observedAt || null;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function quantileNearestRank(values = [], percentile = 0.9) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

export function computeIdleDustThreshold({
  chain = null,
  auditRecords = [],
  now = new Date().toISOString(),
  defaultMinIdleUsd = DEFAULT_MIN_IDLE_USD,
  defaultMinIdleAgeMs = DEFAULT_MIN_IDLE_AGE_MS,
  multiplier = DEFAULT_MULTIPLIER,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  minSamples = DEFAULT_MIN_SAMPLES,
} = {}) {
  const chainKey = chain ? String(chain).toLowerCase() : null;
  const nowMs = timestampMs(now) ?? Date.now();
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  const samples = auditRecords
    .filter((record) => {
      const recordChain = record.chain || record.intent?.chain || null;
      if (chainKey && String(recordChain || "").toLowerCase() !== chainKey) return false;
      const ts = timestampMs(observedAt(record));
      if (!Number.isFinite(ts) || ts < nowMs - lookbackMs) return false;
      return true;
    })
    .map((record) => finite(record.realized?.actualKnownCostUsd ?? record.execution?.actualKnownCostUsd))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (samples.length < minSamples) {
    return {
      minIdleUsd: defaultMinIdleUsd,
      minIdleAgeMs: defaultMinIdleAgeMs,
      sampleCount: samples.length,
      evidenceSource: "default_insufficient_recent_samples",
    };
  }

  const p90RoundTripCostUsd = quantileNearestRank(samples, 0.9);
  const measuredMinIdleUsd = p90RoundTripCostUsd * multiplier;
  return {
    minIdleUsd: Math.max(defaultMinIdleUsd, measuredMinIdleUsd),
    minIdleAgeMs: defaultMinIdleAgeMs,
    sampleCount: samples.length,
    p90RoundTripCostUsd,
    multiplier,
    evidenceSource: "signer_audit_p90_roundtrip_30d",
  };
}
