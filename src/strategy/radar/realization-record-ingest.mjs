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

export function buildOpportunityRealizationRecord(input = {}) {
  const result = validateOpportunityRealizationRecord(input);
  return {
    ok: result.ok,
    blockers: result.blockers,
    record: result.value,
  };
}

export function summarizeRealizationRecords(records = []) {
  const strategyRealizedCount = records.filter((record) => record.lifecycle?.strategyRealized === true).length;
  const paybackDeliveredCount = records.filter((record) => record.lifecycle?.paybackDelivered === true).length;
  return {
    recordCount: records.length,
    strategyRealizedCount,
    paybackDeliveredCount,
    pendingPaybackDeliveryCount: Math.max(0, strategyRealizedCount - paybackDeliveredCount),
    totalNetRealizedPnlSats: satsSum(records.filter((record) => record.lifecycle?.strategyRealized === true)),
  };
}
