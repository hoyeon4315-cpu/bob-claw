const FRESH_MS = 90 * 1000;
const RECENT_MS = 10 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;

const NUMERIC_FIELDS = [
  "assetAmount",
  "assetDecimals",
  "assetPriceUsd",
  "underlyingAssetPriceUsd",
  "btcPriceUsd",
  "valueUsd",
  "valueBtc",
  "debtAmount",
  "debtPriceUsd",
  "debtValueUsd",
  "rewardAmount",
  "rewardPriceUsd",
  "rewardValueUsd",
  "externalReferenceUsd",
  "externalReferenceGapUsd",
];

const UNPRICED_VALUATION_KINDS = new Set(["unpriced", "proxy"]);

const RAW_BALANCE_FIELDS = ["shareBalance", "assetBalance", "debtBalance", "rewardBalance"];

function parseTime(value) {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rawBalanceStringOrNull(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function cleanUndefinedEntries(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function sanitizeJsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return cleanUndefinedEntries(
      Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeJsonValue(nestedValue)])),
    );
  }
  return value;
}

export function freshnessForObservedAt(observedAt, now = new Date()) {
  const observedMillis = parseTime(observedAt);
  const nowMillis = parseTime(now);
  if (observedMillis === null || nowMillis === null) return "failed";

  const ageMs = nowMillis - observedMillis;
  if (ageMs < 0) return "failed";
  if (ageMs <= FRESH_MS) return "fresh";
  if (ageMs <= RECENT_MS) return "recent";
  if (ageMs <= STALE_MS) return "stale";
  return "expired";
}

export function protocolMarkKey(mark = {}) {
  if (mark.positionId) return mark.positionId;
  return [mark.chain, mark.opportunityId, mark.shareTokenAddress || mark.assetAddress].join(":");
}

function coerceFieldTypes(normalized) {
  for (const field of NUMERIC_FIELDS) {
    if (field in normalized) normalized[field] = finiteNumberOrNull(normalized[field]);
  }
  for (const field of RAW_BALANCE_FIELDS) {
    if (field in normalized) normalized[field] = rawBalanceStringOrNull(normalized[field]);
  }
}

function deriveValueUsd(normalized) {
  if ("valueUsd" in normalized && normalized.valueUsd !== null) return;
  const assetAmount = finiteNumberOrNull(normalized.assetAmount);
  const assetPriceUsd = finiteNumberOrNull(normalized.assetPriceUsd);
  normalized.valueUsd = assetAmount !== null && assetPriceUsd !== null ? assetAmount * assetPriceUsd : null;
}

function deriveValueBtc(normalized) {
  if ("valueBtc" in normalized && normalized.valueBtc !== null) return;
  const valueUsd = finiteNumberOrNull(normalized.valueUsd);
  const btcPriceUsd = finiteNumberOrNull(normalized.btcPriceUsd);
  normalized.valueBtc = valueUsd !== null && btcPriceUsd !== null && btcPriceUsd > 0 ? valueUsd / btcPriceUsd : null;
}

function applyFreshnessAndConfidence(normalized, observedAt, now, { unpriced = false } = {}) {
  normalized.freshness = freshnessForObservedAt(observedAt, now);
  if (normalized.freshness === "failed") {
    normalized.confidence = "adapter_missing";
    return;
  }
  if (unpriced) {
    normalized.confidence = "unpriced_observation";
    return;
  }
  normalized.confidence =
    normalized.freshness === "fresh" || normalized.freshness === "recent" ? "verified_current" : "verified_minimum";
}

function finalizeUnpricedMark(normalized, observedAt, now) {
  normalized.assetPriceUsd = null;
  normalized.valueUsd = null;
  normalized.valueBtc = null;
  applyFreshnessAndConfidence(normalized, observedAt, now, { unpriced: true });
  return sanitizeJsonValue(cleanUndefinedEntries(normalized));
}

function finalizeFailedMark(normalized) {
  normalized.freshness = "failed";
  normalized.confidence = "adapter_missing";
  normalized.valueUsd = null;
  normalized.valueBtc = null;
  return sanitizeJsonValue(cleanUndefinedEntries(normalized));
}

export function normalizeProtocolPositionMark(input = {}, { now = new Date() } = {}) {
  const nowMillis = parseTime(now);
  const nowIso = nowMillis === null ? new Date().toISOString() : new Date(nowMillis).toISOString();
  const event = input.event || "position_marked";
  const observedAt = input.observedAt || nowIso;
  const normalized = {
    ...input,
    schemaVersion: 1,
    event,
    status: input.status || "open",
    observedAt,
  };

  coerceFieldTypes(normalized);

  if (UNPRICED_VALUATION_KINDS.has(normalized.valuationKind || null)) {
    return finalizeUnpricedMark(normalized, observedAt, now);
  }

  deriveValueUsd(normalized);
  deriveValueBtc(normalized);

  if (event === "position_mark_failed") {
    return finalizeFailedMark(normalized);
  }

  applyFreshnessAndConfidence(normalized, observedAt, now);
  return sanitizeJsonValue(cleanUndefinedEntries(normalized));
}
