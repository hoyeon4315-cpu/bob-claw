function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function capLimitUsd(caps = {}) {
  const perTxUsd = finiteNumber(caps.perTxUsd);
  const chain = caps.chain || null;
  const perChainMap = caps.perChainUsd || {};
  const perChainUsd = chain
    ? finiteNumber(perChainMap[chain])
    : Math.max(...Object.values(perChainMap).map(finiteNumber).filter((value) => value !== null), Number.NEGATIVE_INFINITY);
  const candidates = [perTxUsd, perChainUsd].filter((value) => Number.isFinite(value));
  return candidates.length ? Math.min(...candidates) : null;
}

function roundedUsd(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function solveMinViableNotional({
  edgeBpsPerDay,
  roundTripCostUsd,
  slippageVarianceUsd = 0,
  varianceFloorUsd = 0,
  holdingPeriodDays = 1,
  caps = null,
} = {}) {
  const edge = finiteNumber(edgeBpsPerDay);
  const cost = finiteNumber(roundTripCostUsd);
  const slippageVariance = Math.max(0, finiteNumber(slippageVarianceUsd) ?? 0);
  const varianceFloor = Math.max(0, finiteNumber(varianceFloorUsd) ?? 0);
  const holdDays = finiteNumber(holdingPeriodDays);

  if (edge === null || cost === null || holdDays === null || holdDays <= 0) {
    return { minNotionalUsd: null, infeasible: true, reason: "missing_input" };
  }
  if (edge <= 0) {
    return { minNotionalUsd: null, infeasible: true, reason: "negative_or_zero_edge" };
  }
  if (cost <= 0) {
    return { minNotionalUsd: null, infeasible: true, reason: "cost_input_invalid" };
  }

  const edgeRate = edge / 10_000;
  const requiredUsd = cost + Math.max(slippageVariance, varianceFloor);
  const exactBoundary = requiredUsd / (edgeRate * holdDays);
  const minNotionalUsd = roundedUsd(exactBoundary + 0.000001);
  const limit = caps ? capLimitUsd(caps) : null;
  if (limit !== null && minNotionalUsd > limit) {
    return { minNotionalUsd, infeasible: true, reason: "floor_infeasible_at_committed_caps" };
  }
  return { minNotionalUsd, infeasible: false, reason: null };
}
