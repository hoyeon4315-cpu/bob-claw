import { buildEvCostModel } from "../../executor/policy/ev-gate.mjs";
import { EXECUTION_EV_COST_POLICY } from "../../config/sizing.mjs";

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

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function quantileNearestRank(values = [], percentile = 0.9) {
  const usable = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!usable.length) return null;
  const rank = Math.max(1, Math.ceil(percentile * usable.length));
  return usable[Math.min(usable.length - 1, rank - 1)];
}

function stddev(values = []) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return 0;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const variance = usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / usable.length;
  return Math.sqrt(variance);
}

function observedAt(record = {}) {
  return record.observedAt || record.timestamp || record.createdAt || null;
}

function recordStrategyId(record = {}) {
  return normalizeString(record.strategyId || record.metadata?.strategyId || record.intent?.strategyId);
}

function recordCostUsd(record = {}) {
  return finiteNumber(record.realized?.actualKnownCostUsd) ??
    finiteNumber(record.realizedCostUsd) ??
    finiteNumber(record.costUsd) ??
    finiteNumber(record.knownCostUsd) ??
    finiteNumber(record.routeContext?.knownCostUsd);
}

function recordEdgeUsd(record = {}) {
  const gross = finiteNumber(record.realized?.realizedGrossPnlUsd) ??
    finiteNumber(record.realizedGrossPnlUsd);
  if (gross !== null) return gross;
  const net = finiteNumber(record.realized?.realizedNetPnlUsd) ??
    finiteNumber(record.realizedNetPnlUsd);
  const cost = recordCostUsd(record);
  if (net !== null && cost !== null) return net + cost;
  return net ??
    finiteNumber(record.routeContext?.estimatedNetPnlUsd) ??
    finiteNumber(record.expectedNetUsd);
}

function recordNotionalUsd(record = {}) {
  return finiteNumber(record.notionalUsd) ??
    finiteNumber(record.amountUsd) ??
    finiteNumber(record.intent?.amountUsd) ??
    finiteNumber(record.routeContext?.inputUsd);
}

function recordHoldingDays(record = {}) {
  return Math.max(1 / 24, finiteNumber(record.holdingPeriodDays) ?? finiteNumber(record.holdDays) ?? 1);
}

function rowForStrategy(strategyTickStatus = null, strategyId) {
  return (strategyTickStatus?.strategies || []).find((row) => row.strategyId === strategyId) || null;
}

function observedNotionalUsd(row = null) {
  return finiteNumber(row?.observedNotionalUsd) ??
    finiteNumber(row?.currentNotionalUsd) ??
    finiteNumber(row?.deployedNotionalUsd) ??
    finiteNumber(row?.scoredAllocation?.allocatedUsd) ??
    0;
}

function samplesForStrategy(receiptRecords = [], strategyId) {
  return receiptRecords
    .filter((record) => recordStrategyId(record) === strategyId)
    .map((record) => {
      const notionalUsd = recordNotionalUsd(record);
      const edgeUsd = recordEdgeUsd(record);
      const holdingDays = recordHoldingDays(record);
      const edgeBpsPerDay =
        notionalUsd !== null && notionalUsd > 0 && edgeUsd !== null
          ? (edgeUsd / notionalUsd) * 10_000 / holdingDays
          : null;
      return {
        observedAt: observedAt(record),
        timestampMs: timestampMs(observedAt(record)) ?? 0,
        costUsd: recordCostUsd(record),
        edgeBpsPerDay,
      };
    })
    .filter((sample) => sample.costUsd !== null || sample.edgeBpsPerDay !== null);
}

function latestReceiptAt(samples = []) {
  return samples.map((sample) => sample.observedAt).filter(Boolean).sort().at(-1) || null;
}

function isStale(lastReceiptAt, now, freshnessMaxAgeDays) {
  if (!lastReceiptAt) return true;
  const lastMs = timestampMs(lastReceiptAt);
  const nowMs = timestampMs(now);
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - lastMs > freshnessMaxAgeDays * 86_400_000;
}

function costFromModel(costModel, strategyId) {
  const entries = (costModel?.entries || []).filter((entry) => entry.strategyId === strategyId);
  if (!entries.length) return null;
  return Math.max(...entries.map((entry) => finiteNumber(entry.p90CostUsd)).filter((value) => value !== null));
}

function latestEvidenceRecord(records = [], strategyId, evidenceClass) {
  return [...(records || [])]
    .filter((record) => record?.strategyId === strategyId && record.evidenceClass === evidenceClass)
    .sort((left, right) => new Date(right.lastSimAt || 0) - new Date(left.lastSimAt || 0))[0] || null;
}

function latestSiblingProxyRecord(records = [], strategyId) {
  return [...(records || [])]
    .filter((record) => record?.strategyId === strategyId && record.evidenceClass === "sibling_proxy")
    .sort((left, right) => String(left.borrowedFromStrategyId || "").localeCompare(String(right.borrowedFromStrategyId || "")))[0] || null;
}

export function buildStrategyEdgeSnapshots({
  strategies = [],
  receiptRecords = [],
  auditRecords = [],
  strategyTickStatus = null,
  shadowEdgeRecords = [],
  siblingProxyRecords = [],
  now = new Date().toISOString(),
  policy = EXECUTION_EV_COST_POLICY,
  freshnessMaxAgeDays = policy.lookbackDays ?? 14,
} = {}) {
  const minSamples = finiteNumber(policy.minSamples) ?? EXECUTION_EV_COST_POLICY.minSamples;
  const varianceFloorUsd = finiteNumber(policy.minProfitFloorUsd) ?? EXECUTION_EV_COST_POLICY.minProfitFloorUsd;
  const costModel = buildEvCostModel({ receiptRecords, auditRecords, now, policy });
  return (strategies || [])
    .filter((strategy) => strategy?.autoExecute === true)
    .map((strategy) => {
      const strategyId = strategy.strategyId;
      const samples = samplesForStrategy(receiptRecords, strategyId);
      const costs = samples.map((sample) => sample.costUsd).filter(Number.isFinite);
      const edges = samples.map((sample) => sample.edgeBpsPerDay).filter(Number.isFinite);
      const lastReceiptAt = latestReceiptAt(samples);
      const sampleCount = Math.max(costs.length, edges.length);
      const row = rowForStrategy(strategyTickStatus, strategyId);
      const modelCost = costFromModel(costModel, strategyId);
      const hasReceiptEvidence = edges.length > 0 || costs.length > 0;
      const yieldShadow = !hasReceiptEvidence ? latestEvidenceRecord(shadowEdgeRecords, strategyId, "yield_shadow") : null;
      const shadow = !hasReceiptEvidence && !yieldShadow ? latestEvidenceRecord(shadowEdgeRecords, strategyId, "shadow") : null;
      const proxy = !hasReceiptEvidence && !yieldShadow && !shadow ? latestSiblingProxyRecord(siblingProxyRecords, strategyId) : null;
      const transportOneShot = !hasReceiptEvidence && !yieldShadow && !shadow && !proxy
        ? latestEvidenceRecord(shadowEdgeRecords, strategyId, "transport_one_shot")
        : null;
      const evidenceRecord = yieldShadow || shadow || proxy || transportOneShot || null;
      const evidenceClass = hasReceiptEvidence ? "receipt" : evidenceRecord?.evidenceClass || "missing_input";
      const evidenceConfidence = evidenceClass === "receipt" ? 1 : finiteNumber(evidenceRecord?.confidence) ?? null;
      const evidenceSampleCount = hasReceiptEvidence
        ? sampleCount
        : finiteNumber(evidenceRecord?.sampleCount) ?? (proxy ? 1 : 0);
      const evidenceObservedAt = hasReceiptEvidence
        ? lastReceiptAt
        : evidenceRecord?.lastSimAt || proxy?.borrowedFromObservedAt || null;
      return {
        strategyId,
        chain: row?.chain || evidenceRecord?.chain || proxy?.chain || Object.keys(strategy?.caps?.perChainUsd || {})[0] || null,
        familyId: strategy.familyId || strategy.exposure?.assetFamily || evidenceRecord?.family || null,
        protocols: Array.isArray(strategy.exposure?.protocols) ? [...strategy.exposure.protocols] : [],
        evidenceClass,
        evidenceConfidence,
        evidenceSource:
          evidenceClass === "sibling_proxy"
            ? {
                borrowedFromStrategyId: proxy.borrowedFromStrategyId,
                borrowedFromChain: proxy.borrowedFromChain,
              }
            : null,
        measuredEdgeBpsPerDay: hasReceiptEvidence
          ? edges.length
            ? edges.reduce((sum, value) => sum + value, 0) / edges.length
            : null
          : finiteNumber(evidenceRecord?.estimatedEdgeBpsPerDay ?? proxy?.proxyEdgeBpsPerDay),
        measuredRoundTripCostUsd: hasReceiptEvidence
          ? modelCost ?? quantileNearestRank(costs, policy.costPercentile ?? 0.9)
          : finiteNumber(evidenceRecord?.estimatedRoundTripCostUsd ?? proxy?.proxyRoundTripCostUsd),
        slippageVarianceUsd: hasReceiptEvidence ? stddev(costs) : 0,
        varianceFloorUsd,
        observedNotionalUsd: observedNotionalUsd(row),
        freshness: {
          lastReceiptAt,
          sampleCount: evidenceSampleCount,
          isThin: evidenceSampleCount < minSamples || isStale(evidenceObservedAt, now, freshnessMaxAgeDays),
        },
      };
    });
}
