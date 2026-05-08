import { canonicalGatewayChain } from "../config/gateway-destinations.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function realizedNetPnlSats(record = {}) {
  return finiteNumber(record.realized?.realizedNetPnlSats)
    ?? finiteNumber(record.receiptIngest?.receiptRecord?.realized?.realizedNetPnlSats)
    ?? finiteNumber(record.execution?.receiptIngest?.receiptRecord?.realized?.realizedNetPnlSats)
    ?? finiteNumber(record.realizedNetPnlSats)
    ?? 0;
}

function txHashFor(record = {}) {
  return record.broadcast?.txHash
    || record.lifecycle?.txHash
    || record.receipt?.txHash
    || record.txHash
    || null;
}

function statusFor(record = {}) {
  return record.receipt?.status
    || record.lifecycle?.stage
    || record.settlementStatus
    || record.status
    || null;
}

function reconciliationStatusFor(record = {}) {
  return record.reconciliation?.status
    || record.reconciliationStatus
    || record.receiptReconciliation?.status
    || null;
}

function isExcludedMode(record = {}) {
  const mode = String(record.mode || record.executionMode || "").toLowerCase();
  const stage = String(record.lifecycle?.stage || "").toLowerCase();
  return mode === "dry_run"
    || mode === "dry-run"
    || mode === "preview"
    || stage === "preview"
    || stage === "dry_run"
    || record.preview === true
    || record.dryRun === true
    || Boolean(record.normalizationError);
}

function isSignerBackedRecord(record = {}) {
  if (record.source === "signer") return true;
  return Boolean(
    record.schemaVersion !== undefined &&
    record.intentHash &&
    record.policyVerdict &&
    (record.broadcast || record.lifecycle || record.receipt || record.intent),
  );
}

function isFinalLiveReceipt(record = {}) {
  if (!record?.strategyId || !record?.chain) return false;
  if (!isSignerBackedRecord(record)) return false;
  if (!txHashFor(record)) return false;
  if (isExcludedMode(record)) return false;
  const status = statusFor(record);
  if (!["confirmed", "delivered"].includes(status)) return false;
  const reconciliationStatus = reconciliationStatusFor(record);
  return reconciliationStatus === "reconciled";
}

function ensureItem(map, strategyId, chain) {
  const key = `${strategyId}:${chain}`;
  if (!map.has(key)) {
    map.set(key, {
      strategyId,
      chain,
      receiptCount7d: 0,
      receiptCount30d: 0,
      receiptCount90d: 0,
      realizedNetPnlSats7d: 0,
      realizedNetPnlSats30d: 0,
      realizedNetPnlSats90d: 0,
      sampleShare90d: 0,
      concentrationWarning: false,
    });
  }
  return map.get(key);
}

function incrementRegime(regimeMap, regime, pnlSats) {
  const key = regime || "unknown";
  if (!regimeMap.has(key)) {
    regimeMap.set(key, { receiptCount90d: 0, realizedNetPnlSats90d: 0 });
  }
  const entry = regimeMap.get(key);
  entry.receiptCount90d += 1;
  entry.realizedNetPnlSats90d += pnlSats;
}

export function defaultRegimeForTimestamp() {
  return "unknown";
}

export function buildStrategyReceiptDistribution({
  records = [],
  now = new Date().toISOString(),
  regimeForTimestamp = defaultRegimeForTimestamp,
  expectedStrategies = null,
} = {}) {
  const nowMs = Date.parse(now);
  const effectiveNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const window7d = effectiveNowMs - 7 * DAY_MS;
  const window30d = effectiveNowMs - 30 * DAY_MS;
  const window90d = effectiveNowMs - 90 * DAY_MS;
  const itemsByKey = new Map();
  const regimeMap = new Map();
  let receiptCount90d = 0;

  for (const record of records || []) {
    if (!isFinalLiveReceipt(record)) continue;
    const tsMs = Date.parse(record.observedAt || record.timestamp || record.receipt?.observedAt || "");
    if (!Number.isFinite(tsMs) || tsMs < window90d || tsMs > effectiveNowMs) continue;
    const strategyId = String(record.strategyId);
    const chain = canonicalGatewayChain(record.chain) || String(record.chain).trim().toLowerCase();
    const pnlSats = realizedNetPnlSats(record);
    const item = ensureItem(itemsByKey, strategyId, chain);

    receiptCount90d += 1;
    item.receiptCount90d += 1;
    item.realizedNetPnlSats90d += pnlSats;
    incrementRegime(regimeMap, regimeForTimestamp(tsMs, record), pnlSats);

    if (tsMs >= window30d) {
      item.receiptCount30d += 1;
      item.realizedNetPnlSats30d += pnlSats;
    }
    if (tsMs >= window7d) {
      item.receiptCount7d += 1;
      item.realizedNetPnlSats7d += pnlSats;
    }
  }

  const items = [...itemsByKey.values()]
    .map((item) => {
      const sampleShare90d = receiptCount90d > 0 ? item.receiptCount90d / receiptCount90d : 0;
      return Object.freeze({
        ...item,
        sampleShare90d,
        concentrationWarning: sampleShare90d > 0.60,
      });
    })
    .sort((a, b) => {
      if (b.receiptCount90d !== a.receiptCount90d) return b.receiptCount90d - a.receiptCount90d;
      return `${a.strategyId}:${a.chain}`.localeCompare(`${b.strategyId}:${b.chain}`);
    });

  const concentrationWarningCount = items.filter((item) => item.concentrationWarning).length;
  const observedStrategies = new Set(items.map((item) => item.strategyId));
  const expectedStrategyIds = Array.isArray(expectedStrategies)
    ? [...new Set(expectedStrategies.map((item) => String(item?.strategyId || item)).filter(Boolean))]
    : null;
  const receiptPoorStrategyCount = expectedStrategyIds
    ? expectedStrategyIds.filter((strategyId) => !observedStrategies.has(strategyId)).length
    : items.filter((item) => item.receiptCount90d === 0).length;
  const byRegime = Object.fromEntries([...regimeMap.entries()].sort((a, b) => a[0].localeCompare(b[0])));

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date(effectiveNowMs).toISOString(),
    items: Object.freeze(items),
    summary: Object.freeze({
      strategyChainCount: items.length,
      receiptCount90d,
      topConcentratedStrategyId: items[0]?.strategyId || null,
      concentrationWarningCount,
      receiptPoorStrategyCount,
      byRegime,
    }),
    receiptDistribution: Object.freeze({
      topConcentratedStrategyId: items[0]?.strategyId || null,
      concentrationWarningCount,
      receiptPoorStrategyCount,
      byRegime,
    }),
  });
}

export {
  isFinalLiveReceipt,
  isSignerBackedRecord,
  realizedNetPnlSats,
  txHashFor,
};
