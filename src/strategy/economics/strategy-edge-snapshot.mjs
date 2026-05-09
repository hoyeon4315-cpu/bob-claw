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

function recordPnlUsd(record = {}) {
  return finiteNumber(record.realized?.realizedNetPnlUsd) ??
    finiteNumber(record.realizedNetPnlUsd) ??
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
      const pnlUsd = recordPnlUsd(record);
      const holdingDays = recordHoldingDays(record);
      const edgeBpsPerDay =
        notionalUsd !== null && notionalUsd > 0 && pnlUsd !== null
          ? (pnlUsd / notionalUsd) * 10_000 / holdingDays
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

export function buildStrategyEdgeSnapshots({
  strategies = [],
  receiptRecords = [],
  auditRecords = [],
  strategyTickStatus = null,
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
      return {
        strategyId,
        measuredEdgeBpsPerDay: edges.length
          ? edges.reduce((sum, value) => sum + value, 0) / edges.length
          : null,
        measuredRoundTripCostUsd: modelCost ?? quantileNearestRank(costs, policy.costPercentile ?? 0.9),
        slippageVarianceUsd: stddev(costs),
        varianceFloorUsd,
        observedNotionalUsd: observedNotionalUsd(row),
        freshness: {
          lastReceiptAt,
          sampleCount,
          isThin: sampleCount < minSamples || isStale(lastReceiptAt, now, freshnessMaxAgeDays),
        },
      };
    });
}
