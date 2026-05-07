export const OOS_MIN_FOLD_COUNT = 12;

export const OOS_GATE_DEFAULTS = Object.freeze({
  deflatedSharpeMin: 1.0,
  maxDrawdownPctMax: 20,
  turnoverMax: 1.0,
  capacityUsdMin: 1_000,
  positiveFoldShareMin: 0.6,
  minFoldCount: OOS_MIN_FOLD_COUNT,
  confidenceZ: 1.96,
});

function freeze(value) {
  return Object.freeze(value);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function computeLowerBound(values, confidenceZ = OOS_GATE_DEFAULTS.confidenceZ) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const avg = mean(values);
  const stdDev = sampleStdDev(values);
  return avg - (confidenceZ * stdDev) / Math.sqrt(values.length);
}

export function evaluateOosGate({ foldResults = [], config = OOS_GATE_DEFAULTS } = {}) {
  const rows = Array.isArray(foldResults) ? foldResults.filter(Boolean) : [];
  const blockers = [];
  if (rows.length < config.minFoldCount) {
    blockers.push(`fold_count_below_min(${rows.length} < ${config.minFoldCount})`);
  }

  const sharpeSeries = rows.map((item) => Number(item.sharpe) || 0);
  const drawdownSeries = rows.map((item) => Number(item.maxDrawdownPct) || 0);
  const turnoverSeries = rows.map((item) => Number(item.turnover) || 0);
  const capacitySeries = rows.map((item) => Number(item.capacityUsd) || 0);
  const netSeries = rows.map((item) => Number(item.netReturn) || 0);

  const deflatedSharpeLowerBound = computeLowerBound(sharpeSeries, config.confidenceZ);
  const oosLowerBound = computeLowerBound(netSeries, config.confidenceZ);
  const maxDrawdownPct = drawdownSeries.length ? Math.max(...drawdownSeries) : 0;
  const turnover = turnoverSeries.length ? mean(turnoverSeries) : 0;
  const capacityUsd = capacitySeries.length ? Math.min(...capacitySeries) : 0;
  const positiveFoldCount = netSeries.filter((value) => value > 0).length;
  const positiveFoldShare = rows.length ? positiveFoldCount / rows.length : 0;

  if (deflatedSharpeLowerBound < config.deflatedSharpeMin) {
    blockers.push("deflated_sharpe_lower_bound_below_threshold");
  }
  if (maxDrawdownPct > config.maxDrawdownPctMax) {
    blockers.push("max_drawdown_exceeded");
  }
  if (turnover > config.turnoverMax) {
    blockers.push("turnover_exceeded");
  }
  if (capacityUsd < config.capacityUsdMin) {
    blockers.push("capacity_below_min");
  }
  if (positiveFoldShare < config.positiveFoldShareMin) {
    blockers.push("positive_fold_share_below_min");
  }

  return freeze({
    passed: blockers.length === 0,
    blockers: freeze(blockers),
    metrics: freeze({
      foldCount: rows.length,
      deflatedSharpeLowerBound,
      oosLowerBound,
      maxDrawdownPct,
      turnover,
      capacityUsd,
      positiveFoldCount,
      positiveFoldShare,
      netReturnLowerBound: oosLowerBound,
    }),
  });
}
