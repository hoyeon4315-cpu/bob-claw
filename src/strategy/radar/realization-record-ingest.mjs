import { validateOpportunityRealizationRecord } from "./schema/index.mjs";

function satsSum(records = []) {
  return records.reduce((total, record) => {
    try {
      return total + BigInt(record.netRealizedPnlSats || 0);
    } catch {
      return total;
    }
  }, 0n).toString();
}

function usdSum(records = []) {
  return records.reduce((total, record) => {
    const value = Number(record.netRealizedPnlUsd);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

function realizedPnlValue(record = {}) {
  const usd = Number(record.netRealizedPnlUsd);
  if (Number.isFinite(usd)) return usd;
  const sats = Number(record.netRealizedPnlSats);
  return Number.isFinite(sats) ? sats : null;
}

export function buildOpportunityRealizationRecord(input = {}) {
  const result = validateOpportunityRealizationRecord(input);
  return {
    ok: result.ok,
    blockers: result.blockers,
    record: result.value,
  };
}

export function summarizeRealizationRecords(records = []) {
  const strategyRealizedRecords = records.filter((record) => record.lifecycle?.strategyRealized === true);
  const strategyRealizedCount = strategyRealizedRecords.length;
  const paybackDeliveredCount = records.filter((record) => record.lifecycle?.paybackDelivered === true).length;
  const positiveRealizedPnlCount = strategyRealizedRecords
    .filter((record) => {
      const value = realizedPnlValue(record);
      return value !== null && value > 0;
    })
    .length;
  return {
    recordCount: records.length,
    strategyRealizedCount,
    positiveRealizedPnlCount,
    paybackDeliveredCount,
    pendingPaybackDeliveryCount: Math.max(0, strategyRealizedCount - paybackDeliveredCount),
    totalNetRealizedPnlUsd: usdSum(strategyRealizedRecords),
    totalNetRealizedPnlSats: satsSum(strategyRealizedRecords),
  };
}
