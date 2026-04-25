function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values = []) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function ageMs(observedAt = null, now = null) {
  if (!observedAt || !now) return null;
  const observed = new Date(observedAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(observed) || !Number.isFinite(current)) return null;
  return Math.max(0, current - observed);
}

function isFreshSample(sample = {}, { now = null, maxSampleAgeMs = null } = {}) {
  if (!Number.isFinite(maxSampleAgeMs) || maxSampleAgeMs <= 0) return Number.isFinite(sample?.priceUsd);
  const sampleAgeMs = ageMs(sample?.observedAt, now);
  if (sampleAgeMs == null) return Number.isFinite(sample?.priceUsd);
  return sampleAgeMs <= maxSampleAgeMs;
}

export function normalizeOraclePriceSample(sample = {}, options = {}) {
  const now = options.now || null;
  const normalized = {
    provider: sample?.provider ? String(sample.provider).toLowerCase() : "unknown",
    assetKey: sample?.assetKey || null,
    feedId: sample?.feedId || null,
    chain: sample?.chain || null,
    observedAt: sample?.observedAt || null,
    sourceType: sample?.sourceType || "reference",
    priceUsd: finite(sample?.priceUsd),
  };
  return {
    ...normalized,
    ageMs: ageMs(normalized.observedAt, now),
  };
}

export function buildOracleSanitySnapshot({
  assetKey = null,
  protocolPriceUsd = null,
  referenceSamples = [],
  now = null,
  driftAlertPct = null,
  maxSampleAgeMs = 300_000,
  minReferenceSampleCount = 1,
} = {}) {
  const normalizedSamples = (referenceSamples || [])
    .map((sample) => normalizeOraclePriceSample(sample, { now }))
    .filter((sample) => Number.isFinite(sample.priceUsd));
  const freshSamples = normalizedSamples.filter((sample) => isFreshSample(sample, { now, maxSampleAgeMs }));
  const referencePrices = freshSamples.map((sample) => sample.priceUsd);
  const referencePriceUsd = median(referencePrices);
  const minReferenceUsd = referencePrices.length ? Math.min(...referencePrices) : null;
  const maxReferenceUsd = referencePrices.length ? Math.max(...referencePrices) : null;
  const protocolUsd = finite(protocolPriceUsd);
  const protocolDriftPct =
    Number.isFinite(protocolUsd) && Number.isFinite(referencePriceUsd) && referencePriceUsd > 0
      ? round((Math.abs(protocolUsd - referencePriceUsd) / referencePriceUsd) * 100, 4)
      : null;
  const referenceSpreadPct =
    Number.isFinite(referencePriceUsd) && referencePriceUsd > 0 && Number.isFinite(minReferenceUsd) && Number.isFinite(maxReferenceUsd)
      ? round(((maxReferenceUsd - minReferenceUsd) / referencePriceUsd) * 100, 4)
      : null;
  const providers = [...new Set(freshSamples.map((sample) => sample.provider).filter(Boolean))];
  const minSamples = Number.isFinite(minReferenceSampleCount) ? Math.max(1, minReferenceSampleCount) : 1;

  let status = "healthy";
  if (!Number.isFinite(protocolUsd)) {
    status = "missing_protocol_price";
  } else if (freshSamples.length === 0) {
    status = "missing_reference_price";
  } else if (freshSamples.length < minSamples) {
    status = "insufficient_reference_coverage";
  } else if (Number.isFinite(protocolDriftPct) && Number.isFinite(driftAlertPct) && protocolDriftPct >= driftAlertPct) {
    status = "drift_above_trigger";
  }

  return {
    assetKey,
    status,
    protocolPriceUsd: protocolUsd,
    referencePriceUsd: round(referencePriceUsd, 4),
    protocolDriftPct,
    referenceSpreadPct,
    driftAlertPct: finite(driftAlertPct),
    freshSampleCount: freshSamples.length,
    totalSampleCount: normalizedSamples.length,
    providers,
    samples: freshSamples,
    comparisonBasis: Number.isFinite(referencePriceUsd) ? "median_reference_price" : null,
    observedAt: now || new Date().toISOString(),
  };
}
