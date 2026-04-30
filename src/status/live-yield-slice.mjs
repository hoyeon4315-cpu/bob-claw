const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestampMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function usdToSats(usd, btcUsd) {
  if (!Number.isFinite(usd) || !Number.isFinite(btcUsd) || btcUsd <= 0) return null;
  return Math.floor((usd / btcUsd) * 1e8);
}

function latestIso(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return timestampMs(right) > timestampMs(left) ? right : left;
}

function positionId(position = {}, index = 0) {
  return String(position.id || position.opportunityId || `${position.chain || "chain"}:${position.protocol || "protocol"}:${index}`);
}

export function buildLiveYieldSlice({
  merklActivePositions = null,
  btcUsd = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const asOfMs = timestampMs(generatedAt);
  const items = [];
  let totalCapUsd = 0;
  let weightedAprNumerator = 0;
  let estimatedYieldUsd = 0;
  let observedAt = null;

  const positions = Array.isArray(merklActivePositions?.items) ? merklActivePositions.items : [];
  positions.forEach((position, index) => {
    const capUsd = finiteNumber(position.capUsd);
    const aprPct = finiteNumber(position.aprPct);
    const openedAtMs = timestampMs(position.lastObservedAt);
    const hasYieldInputs =
      Number.isFinite(capUsd) &&
      capUsd > 0 &&
      Number.isFinite(aprPct) &&
      aprPct > 0 &&
      Number.isFinite(openedAtMs) &&
      Number.isFinite(asOfMs) &&
      asOfMs > openedAtMs;
    const elapsedYearFraction = hasYieldInputs ? (asOfMs - openedAtMs) / YEAR_MS : 0;
    const itemYieldUsd = hasYieldInputs ? capUsd * (aprPct / 100) * elapsedYearFraction : 0;

    if (Number.isFinite(capUsd) && capUsd > 0 && Number.isFinite(aprPct) && aprPct > 0) {
      totalCapUsd += capUsd;
      weightedAprNumerator += capUsd * aprPct;
    }
    estimatedYieldUsd += itemYieldUsd;
    observedAt = latestIso(observedAt, position.lastObservedAt || null);

    items.push(Object.freeze({
      id: positionId(position, index),
      opportunityId: position.opportunityId || null,
      label: position.label || null,
      chain: position.chain || null,
      protocol: position.protocol || null,
      capUsd: Number.isFinite(capUsd) ? capUsd : null,
      aprPct: Number.isFinite(aprPct) ? aprPct : null,
      estimatedYieldUsd: round(itemYieldUsd, 8),
      estimatedYieldSats: usdToSats(itemYieldUsd, btcUsd),
      lastObservedAt: position.lastObservedAt || null,
    }));
  });

  const weightedAprPct = totalCapUsd > 0 ? round(weightedAprNumerator / totalCapUsd, 4) : null;
  const annualizedYieldUsd = totalCapUsd > 0 && Number.isFinite(weightedAprPct)
    ? totalCapUsd * (weightedAprPct / 100)
    : 0;
  const roundedYieldUsd = round(estimatedYieldUsd, 8) ?? 0;
  const estimatedYieldSats = usdToSats(estimatedYieldUsd, btcUsd);
  const aprPositionCount = items.filter((item) => Number.isFinite(item.capUsd) && item.capUsd > 0 && Number.isFinite(item.aprPct)).length;
  const status = aprPositionCount > 0 ? "active" : (items.length > 0 ? "pending_apr" : "empty");

  return Object.freeze({
    schemaVersion: 1,
    generatedAt,
    source: "merkl_active_positions",
    status,
    basis: estimatedYieldSats > 0 || roundedYieldUsd > 0 ? "estimated" : null,
    positionCount: items.length,
    aprPositionCount,
    weightedAprPct,
    estimatedYieldUsd: roundedYieldUsd,
    estimatedYieldSats,
    annualizedYieldUsd: round(annualizedYieldUsd, 6) ?? 0,
    annualizedYieldSats: usdToSats(annualizedYieldUsd, btcUsd),
    observedAt,
    items: Object.freeze(items),
  });
}

export function liveYieldMetricFields(liveYield = null) {
  return Object.freeze({
    liveEstimatedYieldSats: finiteNumber(liveYield?.estimatedYieldSats),
    liveEstimatedYieldUsd: finiteNumber(liveYield?.estimatedYieldUsd),
    liveAnnualizedYieldSats: finiteNumber(liveYield?.annualizedYieldSats),
    liveAnnualizedYieldUsd: finiteNumber(liveYield?.annualizedYieldUsd),
    liveYieldAprPct: finiteNumber(liveYield?.weightedAprPct),
    liveYieldPositionCount: finiteNumber(liveYield?.positionCount) ?? 0,
    liveYieldObservedAt: liveYield?.observedAt || null,
    liveYieldBasis: liveYield?.basis || null,
  });
}
