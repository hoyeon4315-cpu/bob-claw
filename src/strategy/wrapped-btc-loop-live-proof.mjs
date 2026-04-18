function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numericPath(values = []) {
  return (values || []).filter(Number.isFinite).map((value) => round(value, 4));
}

function gasUsdForHashes(capitalAuditReport = null, txHashes = []) {
  const normalizedHashes = unique(txHashes);
  if (normalizedHashes.length === 0) return null;
  const transactions = Array.isArray(capitalAuditReport?.transactions) ? capitalAuditReport.transactions : [];
  const byHash = new Map(
    transactions
      .filter((item) => item?.txHash && Number.isFinite(item?.gasUsd))
      .map((item) => [item.txHash, item]),
  );
  const matched = normalizedHashes.map((hash) => byHash.get(hash)).filter(Boolean);
  if (matched.length !== normalizedHashes.length) return null;
  return round(matched.reduce((sum, item) => sum + item.gasUsd, 0), 6);
}

function missingExtendedReceiptFields(proof = null) {
  if (!proof) return [];
  return [
    (proof.observedHealthFactorPath || []).length > 0 ? null : "observedHealthFactorPath",
    (proof.observedLiquidationBufferPath || []).length > 0 ? null : "observedLiquidationBufferPath",
    Number.isFinite(proof.actualLoopFeesUsd) ? null : "actualLoopFeesUsd",
    Number.isFinite(proof.actualUnwindCostUsd) ? null : "actualUnwindCostUsd",
    Number.isFinite(proof.realizedNetCarryUsd) ? null : "realizedNetCarryUsd",
  ].filter(Boolean);
}

export const WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE = "wrapped-btc-loop-live-success-latest.json";

export function hydrateWrappedBtcLoopLiveProof({
  proof = null,
  capitalAuditReport = null,
} = {}) {
  if (!proof) return null;
  const hydrated = {
    ...proof,
    observedHealthFactorPath: numericPath(proof.observedHealthFactorPath || []),
    observedLiquidationBufferPath: numericPath(proof.observedLiquidationBufferPath || []),
    actualLoopFeesUsd: Number.isFinite(proof.actualLoopFeesUsd)
      ? round(proof.actualLoopFeesUsd)
      : gasUsdForHashes(capitalAuditReport, proof.entryTxHashes || []),
    actualUnwindCostUsd: Number.isFinite(proof.actualUnwindCostUsd)
      ? round(proof.actualUnwindCostUsd)
      : gasUsdForHashes(capitalAuditReport, proof.unwindTxHashes || []),
    realizedNetCarryUsd: Number.isFinite(proof.realizedNetCarryUsd) ? round(proof.realizedNetCarryUsd) : null,
  };
  const missingFields = missingExtendedReceiptFields(hydrated);
  return {
    ...hydrated,
    extendedReceiptContextReady: missingFields.length === 0,
    missingExtendedReceiptFields: missingFields,
    oosReceiptStatus:
      missingFields.length === 0
        ? "ingestable_extended_receipt_context_ready"
        : proof.oosReceiptStatus || "extended_receipt_context_pending",
  };
}

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

  return hydrateWrappedBtcLoopLiveProof({
    proof: {
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
    observedHealthFactorPath: numericPath(receiptContext?.observedHealthFactorPath || []),
    observedLiquidationBufferPath: numericPath(receiptContext?.observedLiquidationBufferPath || []),
    actualLoopFeesUsd: round(receiptContext?.actualLoopFeesUsd),
    actualUnwindCostUsd: round(receiptContext?.actualUnwindCostUsd),
    realizedNetCarryUsd: round(receiptContext?.realizedNetCarryUsd),
    receiptAutoIngest: {
      ran: result.receiptAutoIngest?.ran === true,
      reason: result.receiptAutoIngest?.reason || null,
    },
    oosReceiptStatus: result.receiptAutoIngest?.ran === true ? "ingested" : "extended_receipt_context_pending",
    },
  });
}

export function summarizeWrappedBtcLoopLiveProof(proof = null) {
  if (!proof) {
    return {
      proofRecorded: false,
      proofStatus: "missing",
      oosReceiptStatus: "missing",
      entryCount: 0,
      unwindCount: 0,
      extendedReceiptContextReady: false,
      missingExtendedReceiptFields: [],
    };
  }

  return {
    proofRecorded: proof.success === true && proof.proofStatus === "signer_backed_roundtrip_recorded",
    proofStatus: proof.proofStatus || null,
    oosReceiptStatus: proof.oosReceiptStatus || null,
    entryCount: proof.entryCount ?? 0,
    unwindCount: proof.unwindCount ?? 0,
    extendedReceiptContextReady: proof.extendedReceiptContextReady === true,
    missingExtendedReceiptFields: proof.missingExtendedReceiptFields || [],
  };
}
