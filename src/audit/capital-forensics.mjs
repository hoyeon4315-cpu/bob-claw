import { buildReceiptLedgerSummary } from "../ledger/receipt-reconciliation.mjs";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inventoryTotalUsd(record = {}) {
  return finiteNumber(record.totals?.totalUsd)
    ?? finiteNumber(record.totalUsd)
    ?? finiteNumber(record.summary?.itemizedWalletUsd)
    ?? finiteNumber(record.summary?.estimatedWalletUsd)
    ?? null;
}

function inventoryWalletUsd(record = {}) {
  return finiteNumber(record.totals?.tokenUsd)
    ?? finiteNumber(record.summary?.estimatedWalletUsd)
    ?? null;
}

function inventoryProtocolUsd(record = {}) {
  return finiteNumber(record.totals?.protocolUsd) ?? 0;
}

function observedAtMs(record = {}) {
  const parsed = new Date(record.observedAt || record.generatedAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function scanErrorCount(record = {}) {
  return Number(record.summary?.scanErrorCount ?? record.scanErrors?.length ?? 0) || 0;
}

function walletCoverage(record = {}) {
  return record.summary?.walletCoverage || record.walletCoverage || null;
}

function unknownAssetBalanceCount(record = {}) {
  return Number(record.summary?.unknownAssetBalanceCount ?? record.unknownAssetBalanceCount ?? 0) || 0;
}

function isFullRpcInventory(record = {}) {
  return walletCoverage(record) === "full_rpc" && scanErrorCount(record) === 0 && unknownAssetBalanceCount(record) === 0;
}

function isExternalReference(record = {}) {
  const source = String(record.source || "");
  return (
    source.includes("external") ||
    walletCoverage(record) === "full_external" ||
    walletCoverage(record) === "full_external_stale" ||
    Number.isFinite(record.summary?.externalTotalPortfolioUsd) ||
    Number.isFinite(record.summary?.externalUnclassifiedUsd)
  );
}

function normalizedAssetKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.:-]/g, "");
}

function protocolPositionKeys(record = {}) {
  const keys = new Set();
  for (const position of record.protocolPositions || []) {
    for (const value of [
      position.symbol,
      position.ticker,
      position.asset,
      position.assetSymbol,
      position.token,
      position.tokenSymbol,
      position.shareTokenSymbol,
      position.tokenAddress,
      position.shareTokenAddress,
      position.contractAddress,
    ]) {
      const key = normalizedAssetKey(value);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function hasProtocolShareDoubleCountRisk(record = {}) {
  if (!Array.isArray(record.protocolPositions) || record.protocolPositions.length === 0) return false;
  const positionKeys = protocolPositionKeys(record);
  if (positionKeys.size === 0) return false;

  return (record.tokenBalances || []).some((token) => {
    if (token?.countedInWalletTotal === false) return false;
    if (token?.trackingStatus !== "protocol_reader_covered") return false;
    if ((finiteNumber(token.estimatedUsd) ?? 0) <= 0) return false;
    return [
      token.ticker,
      token.symbol,
      token.name,
      token.tokenAddress,
      token.contractAddress,
      token.address,
    ].some((value) => positionKeys.has(normalizedAssetKey(value)));
  });
}

function inventorySnapshot(record = null) {
  if (!record) return null;
  return {
    observedAt: record.observedAt || record.generatedAt || null,
    totalUsd: inventoryTotalUsd(record),
    walletUsd: inventoryWalletUsd(record),
    protocolUsd: inventoryProtocolUsd(record),
    walletCoverage: walletCoverage(record),
    scanErrorCount: scanErrorCount(record),
    unknownAssetBalanceCount: unknownAssetBalanceCount(record),
    source: record.source || null,
  };
}

function latestInventory(records = []) {
  const sorted = [...records].filter((record) => Number.isFinite(inventoryTotalUsd(record))).sort((a, b) => observedAtMs(b) - observedAtMs(a));
  return sorted.find(isFullRpcInventory) || sorted[0] || null;
}

function maxBy(records = [], valueFn) {
  let best = null;
  let bestValue = -Infinity;
  for (const record of records) {
    const value = valueFn(record);
    if (!Number.isFinite(value)) continue;
    if (value > bestValue || (value === bestValue && observedAtMs(record) > observedAtMs(best))) {
      best = record;
      bestValue = value;
    }
  }
  return best;
}

function dailyLastSnapshots(records = []) {
  const byDay = new Map();
  for (const record of records) {
    if (!record?.observedAt) continue;
    const day = String(record.observedAt).slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || observedAtMs(record) > observedAtMs(existing)) byDay.set(day, record);
  }
  return [...byDay.values()]
    .sort((left, right) => observedAtMs(left) - observedAtMs(right))
    .map(inventorySnapshot);
}

function topReceiptKinds(ledgerSummary = {}, limit = 8) {
  return Object.values(ledgerSummary.kinds || {})
    .concat(Array.isArray(ledgerSummary.kinds) ? ledgerSummary.kinds : [])
    .filter((item, index, arr) => item?.kind && arr.findIndex((candidate) => candidate?.kind === item.kind) === index)
    .sort((left, right) => (left.realizedNetPnlUsd ?? 0) - (right.realizedNetPnlUsd ?? 0))
    .slice(0, limit)
    .map((item) => ({
      kind: item.kind,
      recordCount: item.recordCount,
      reconciledCount: item.reconciledCount,
      failedCount: item.failedCount,
      pendingOutputCount: item.pendingOutputCount,
      realizedNetPnlUsd: item.realizedNetPnlUsd,
      totalReceiptGasUsd: item.totalReceiptGasUsd,
      failedGasCostUsd: item.failedGasCostUsd,
    }));
}

function topReceiptChains(records = [], limit = 8) {
  const groups = new Map();
  for (const record of records) {
    const chain = record.chain || "unknown";
    if (!groups.has(chain)) groups.set(chain, []);
    groups.get(chain).push(record);
  }
  return [...groups.entries()]
    .map(([chain, items]) => ({
      chain,
      ...buildReceiptLedgerSummary(items).summary,
    }))
    .sort((left, right) => (left.realizedNetPnlUsd ?? 0) - (right.realizedNetPnlUsd ?? 0))
    .slice(0, limit);
}

function summarizeInboundEvents(events = []) {
  const summarized = events
    .map((event) => ({
      observedAt: event.observedAt || null,
      chain: event.chain || null,
      ticker: event.ticker || null,
      amountDecimal: finiteNumber(event.amountDecimal),
      estimatedUsd: finiteNumber(event.estimatedUsd),
      detectionSource: event.detectionSource || null,
      txHash: event.txHash || null,
    }))
    .filter((event) => Number.isFinite(event.estimatedUsd));
  const totalEstimatedUsd = summarized.reduce((sum, event) => sum + event.estimatedUsd, 0);
  return {
    eventCount: events.length,
    estimatedUsdEventCount: summarized.length,
    totalEstimatedUsd,
    topEvents: summarized
      .sort((left, right) => right.estimatedUsd - left.estimatedUsd)
      .slice(0, 10),
    caveat: "inventory_diff_positive_moves_can_include_internal_route_outputs_not_operator_deposits",
  };
}

export function buildCapitalForensicsReport({
  inventoryRecords = [],
  receiptRecords = [],
  inboundEvents = [],
  baselineUsd = null,
  now = new Date().toISOString(),
} = {}) {
  const currentRecord = latestInventory(inventoryRecords);
  const current = inventorySnapshot(currentRecord);
  const localInventoryRecords = inventoryRecords.filter((record) => !isExternalReference(record));
  const cleanLocalInventoryRecords = localInventoryRecords.filter((record) => !hasProtocolShareDoubleCountRisk(record));
  const excludedDoubleCountInventoryCount = localInventoryRecords.length - cleanLocalInventoryRecords.length;
  const externalReferenceRecords = inventoryRecords.filter(isExternalReference);
  const maxLocalInventory = inventorySnapshot(maxBy(cleanLocalInventoryRecords, inventoryTotalUsd));
  const maxExternalReference = inventorySnapshot(maxBy(externalReferenceRecords, inventoryTotalUsd));
  const receiptLedger = buildReceiptLedgerSummary(receiptRecords);
  const baseline = Number.isFinite(baselineUsd) && current?.totalUsd !== null
    ? {
        baselineUsd,
        deltaFromCurrentUsd: baselineUsd - current.totalUsd,
      }
    : {
        baselineUsd: Number.isFinite(baselineUsd) ? baselineUsd : null,
        deltaFromCurrentUsd: null,
      };

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: typeof now === "string" ? now : now.toISOString(),
    current,
    baseline,
    confidence: {
      currentNav: current && current.walletCoverage === "full_rpc" && current.scanErrorCount === 0 && current.unknownAssetBalanceCount === 0
        ? "verified_current"
        : "verified_minimum_or_stale",
      depositLedger: "partial_inventory_diff_only",
      receiptCostLedger: "cumulative_execution_cost",
    },
    history: {
      firstInventory: inventorySnapshot([...inventoryRecords].sort((a, b) => observedAtMs(a) - observedAtMs(b))[0] || null),
      latestInventory: inventorySnapshot([...inventoryRecords].sort((a, b) => observedAtMs(b) - observedAtMs(a))[0] || null),
      maxLocalInventory,
      excludedDoubleCountInventoryCount,
      maxExternalReference,
      externalReferenceWarning: maxExternalReference ? "external_reference_not_current_nav" : null,
      dailyLast: dailyLastSnapshots(inventoryRecords),
    },
    receipts: {
      summary: receiptLedger.summary,
      classifications: receiptLedger.classifications,
      topKinds: topReceiptKinds(receiptLedger),
      topChains: topReceiptChains(receiptRecords),
    },
    inbound: summarizeInboundEvents(inboundEvents),
    accountingCaveats: [
      "receipt_ledger_is_cumulative_execution_cost_not_external_deposit_ledger",
      "external_portfolio_reference_must_not_override_current_rpc_nav",
      "inventory_diff_positive_moves_can_include_internal_transfers",
    ],
  });
}
