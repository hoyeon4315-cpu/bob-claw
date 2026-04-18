function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE = "wrapped-btc-loop-live-success-latest.json";

export function buildWrappedBtcLoopLiveProof({
  result = null,
  receiptContext = null,
  now = null,
} = {}) {
  if (!result || result.ok !== true) return null;

  const entryResults = Array.isArray(result.entryResults) ? result.entryResults : [];
  const unwindResults = Array.isArray(result.unwindResults) ? result.unwindResults : [];
  const entryTxHashes = unique(entryResults.map((item) => item.broadcast?.txHash).filter(Boolean));
  const unwindTxHashes = unique(unwindResults.map((item) => item.broadcast?.txHash).filter(Boolean));

  if (entryTxHashes.length === 0 || unwindTxHashes.length === 0) return null;

  return {
    schemaVersion: 1,
    observedAt: now || new Date().toISOString(),
    strategyId: result.strategyId || null,
    scenarioId: result.scenarioId || null,
    success: true,
    proofKind: "signer_backed_roundtrip",
    proofStatus: "signer_backed_roundtrip_recorded",
    perTradeCapUsdOverride: Number.isFinite(result.perTradeCapUsdOverride) ? result.perTradeCapUsdOverride : null,
    marketAssumptionsOverride: result.marketAssumptionsOverride || null,
    entryCount: entryResults.length,
    unwindCount: unwindResults.length,
    entryTxHashes,
    unwindTxHashes,
    actualLoopFeesUsd: round(receiptContext?.actualLoopFeesUsd),
    actualUnwindCostUsd: round(receiptContext?.actualUnwindCostUsd),
    realizedNetCarryUsd: round(receiptContext?.realizedNetCarryUsd),
    receiptAutoIngest: {
      ran: result.receiptAutoIngest?.ran === true,
      reason: result.receiptAutoIngest?.reason || null,
    },
    oosReceiptStatus: result.receiptAutoIngest?.ran === true ? "ingested" : "extended_receipt_context_pending",
  };
}

export function summarizeWrappedBtcLoopLiveProof(proof = null) {
  if (!proof) {
    return {
      proofRecorded: false,
      proofStatus: "missing",
      oosReceiptStatus: "missing",
      entryCount: 0,
      unwindCount: 0,
    };
  }

  return {
    proofRecorded: proof.success === true && proof.proofStatus === "signer_backed_roundtrip_recorded",
    proofStatus: proof.proofStatus || null,
    oosReceiptStatus: proof.oosReceiptStatus || null,
    entryCount: proof.entryCount ?? 0,
    unwindCount: proof.unwindCount ?? 0,
  };
}
