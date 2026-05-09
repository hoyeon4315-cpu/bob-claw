function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function round(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function quantileNearestRank(values = [], percentile = 0.9) {
  const usable = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!usable.length) return null;
  const rank = Math.max(1, Math.ceil(percentile * usable.length));
  return usable[Math.min(usable.length - 1, rank - 1)];
}

function observedAt(record = {}) {
  return normalizeString(record.observedAt || record.timestamp || record.createdAt);
}

function recordStrategyId(record = {}) {
  return normalizeString(record.strategyId || record.metadata?.strategyId || record.intent?.strategyId);
}

function recordChain(record = {}) {
  return normalizeString(record.chain || record.dstChain || record.route?.dstChain || record.intent?.chain);
}

function recordFamily(record = {}) {
  return normalizeString(record.family || record.familyId || record.metadata?.familyId || record.intent?.familyId);
}

function recordNotionalUsd(record = {}) {
  return finiteNumber(record.notionalUsd ?? record.amountUsd ?? record.positionUsd ?? record.routeContext?.inputUsd);
}

function recordEdgeUsd(record = {}) {
  return finiteNumber(
    record.estimatedNetUsd ??
      record.executableNetEdgeUsd ??
      record.netEdgeUsd ??
      record.expectedNetUsd ??
      record.routeContext?.estimatedNetPnlUsd,
  );
}

function recordCostUsd(record = {}) {
  return finiteNumber(
    record.estimatedRoundTripCostUsd ??
      record.estimatedGasUsd ??
      record.gasUsd ??
      record.costUsd ??
      record.routeContext?.knownCostUsd,
  );
}

function isSuccessfulShadow(record = {}) {
  return record.status === "simulated_ok" || record.ok === true || record.executionStatus === "succeeded";
}

export function buildShadowEdgeRecords({
  simulationRuns = [],
  confidence = 0.5,
} = {}) {
  const buckets = new Map();
  for (const record of simulationRuns || []) {
    if (!isSuccessfulShadow(record)) continue;
    const strategyId = recordStrategyId(record);
    const chain = recordChain(record);
    const notionalUsd = recordNotionalUsd(record);
    const edgeUsd = recordEdgeUsd(record);
    if (!strategyId || !(notionalUsd > 0) || edgeUsd === null) continue;
    const family = recordFamily(record);
    const key = `${strategyId}:${chain || "unknown"}:${family || "unknown"}`;
    const sample = {
      strategyId,
      chain,
      family,
      observedAt: observedAt(record),
      edgeBpsPerDay: (edgeUsd / notionalUsd) * 10_000,
      costUsd: recordCostUsd(record),
    };
    const samples = buckets.get(key) || [];
    samples.push(sample);
    buckets.set(key, samples);
  }

  return [...buckets.values()]
    .map((samples) => {
      const first = samples[0];
      const edges = samples.map((sample) => sample.edgeBpsPerDay).filter(Number.isFinite);
      const costs = samples.map((sample) => sample.costUsd).filter(Number.isFinite);
      return {
        strategyId: first.strategyId,
        chain: first.chain,
        family: first.family,
        evidenceClass: "shadow",
        estimatedEdgeBpsPerDay: round(edges.reduce((sum, value) => sum + value, 0) / edges.length),
        estimatedRoundTripCostUsd: quantileNearestRank(costs, 0.9),
        sampleCount: samples.length,
        lastSimAt: samples.map((sample) => sample.observedAt).filter(Boolean).sort().at(-1) || null,
        confidence,
      };
    })
    .sort((left, right) => left.strategyId.localeCompare(right.strategyId) || String(left.chain).localeCompare(String(right.chain)));
}
