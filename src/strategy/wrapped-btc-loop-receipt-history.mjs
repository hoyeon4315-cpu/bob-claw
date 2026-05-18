function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const WRAPPED_BTC_LOOP_LIVE_INTENT_TYPE = "wrapped_btc_loop_entry";

export function buildWrappedBtcLoopReceiptHistory(strategyConfig = {}, dryRunReceipts = []) {
  const strategyId = strategyConfig.id || null;
  const chain = strategyConfig.chain || null;
  const receiptRecords = (dryRunReceipts || [])
    .filter(
      (record) =>
        record?.strategyId === strategyId &&
        record?.executionMode === "signer_backed_receipt" &&
        record?.result === "passed" &&
        Number.isFinite(record?.actualLoopFeesUsd) &&
        Number.isFinite(record?.actualUnwindCostUsd),
    )
    .map((record) => ({
      observedAt: record.observedAt || null,
      strategyId,
      chain,
      intentType: WRAPPED_BTC_LOOP_LIVE_INTENT_TYPE,
      realized: {
        actualKnownCostUsd: round((record.actualLoopFeesUsd ?? 0) + (record.actualUnwindCostUsd ?? 0), 4),
        realizedNetPnlUsd: round(record.realizedNetCarryUsd ?? null, 4),
      },
      metadata: {
        scenarioId: record.scenarioId || null,
        source: "wrapped_btc_loop_signer_backed_receipt",
      },
    }));
  return {
    receiptRecords,
    auditRecords: [],
  };
}
