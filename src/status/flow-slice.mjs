function finiteNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function satsToUsd(sats, btcUsd) {
  if (!Number.isFinite(sats) || !Number.isFinite(btcUsd)) return null;
  return (sats / 1e8) * btcUsd;
}

function normalizeActivityId(parts = []) {
  return parts.filter(Boolean).join(":");
}

function normalizeStrategyId(strategyId) {
  return stringOrNull(strategyId)?.replace(/-/g, "_") || null;
}

function lastTxHash(event = {}) {
  if (Array.isArray(event.txHashes) && event.txHashes.length > 0) {
    return stringOrNull(event.txHashes.at(-1));
  }
  return stringOrNull(event.txHash);
}

function executionAmountUsd(event = {}) {
  return (
    finiteNumber(event.amountUsd) ??
    finiteNumber(event.quote?.inputValueUsd) ??
    finiteNumber(event.receiptIngest?.receiptRecord?.routeContext?.estimatedInputUsd) ??
    finiteNumber(event.receiptIngest?.receiptRecord?.output?.actualOutputUsd) ??
    null
  );
}

function executionAmountSats(event = {}) {
  return (
    finiteNumber(event.realized?.realizedNetPnlSats) ??
    finiteNumber(event.receiptIngest?.receiptRecord?.realized?.realizedNetPnlSats) ??
    null
  );
}

function executionRealizedUsd(event = {}) {
  return (
    finiteNumber(event.realized?.realizedNetPnlUsd) ??
    finiteNumber(event.receiptIngest?.receiptRecord?.realized?.realizedNetPnlUsd) ??
    null
  );
}

function eventFinalAssetLabel(event = {}) {
  return (
    stringOrNull(event.asset) ??
    stringOrNull(event.symbol) ??
    stringOrNull(event.outputAsset) ??
    stringOrNull(event.receiptIngest?.receiptRecord?.output?.asset) ??
    stringOrNull(event.receiptIngest?.receiptRecord?.output?.symbol) ??
    stringOrNull(event.receiptIngest?.receiptRecord?.output?.ticker) ??
    stringOrNull(event.receiptIngest?.receiptRecord?.routeContext?.dstTicker) ??
    null
  );
}

function isDeliveredExecution(event = {}) {
  if (!event?.strategyId) return false;
  if (event.eventType === "execution_funding_outcome" && event.settlementStatus === "delivered") return true;
  if (event.eventType === "execution_reconciled" && event.reconciliationStatus === "reconciled") return true;
  return false;
}

function normalizeExecutionActivity(event = {}) {
  if (!isDeliveredExecution(event)) return null;
  const strategyId = stringOrNull(event.strategyId);
  const txHash = lastTxHash(event);
  return Object.freeze({
    id: normalizeActivityId(["execution", txHash || event.jobId, event.observedAt]),
    kind: "execution",
    kindLabel: "실행",
    observedAt: stringOrNull(event.observedAt),
    strategyId,
    strategyKey: normalizeStrategyId(strategyId),
    chain: stringOrNull(event.chain),
    protocol: null,
    status: stringOrNull(event.status) || "delivered",
    amountUsd: executionAmountUsd(event),
    amountSats: executionAmountSats(event),
    realizedNetPnlUsd: executionRealizedUsd(event),
    finalAssetId: eventFinalAssetLabel(event),
    finalAssetLabel: eventFinalAssetLabel(event),
    txHash,
    detail:
      stringOrNull(event.asset) ||
      stringOrNull(event.type) ||
      stringOrNull(event.executionMethod) ||
      null,
  });
}

function normalizePositionActivity(event = {}) {
  if (event?.event !== "position_opened" || event?.status !== "open") return null;
  const strategyId = stringOrNull(event.strategyId);
  if (!strategyId) return null;
  return Object.freeze({
    id: normalizeActivityId(["position", event.positionId || event.opportunityId, event.observedAt]),
    kind: "position",
    kindLabel: "포지션",
    observedAt: stringOrNull(event.observedAt),
    strategyId,
    strategyKey: normalizeStrategyId(strategyId),
    chain: stringOrNull(event.chain),
    protocol: stringOrNull(event.protocolId),
    status: "open",
    amountUsd: finiteNumber(event.amountUsd),
    amountSats: null,
    realizedNetPnlUsd: null,
    finalAssetId: stringOrNull(event.asset) ?? stringOrNull(event.assetSymbol) ?? null,
    finalAssetLabel: stringOrNull(event.asset) ?? stringOrNull(event.assetSymbol) ?? null,
    txHash: stringOrNull(event.entryTxHash),
    detail: stringOrNull(event.name),
  });
}

function signerAuditActivityKey(record = {}) {
  return (
    stringOrNull(record.intentHash) ??
    stringOrNull(record.lifecycle?.txHash) ??
    stringOrNull(record.broadcast?.txHash) ??
    stringOrNull(record.intentId) ??
    null
  );
}

function signerAuditStatus(record = {}) {
  if (record?.policyVerdict && record.policyVerdict !== "approved") {
    return stringOrNull(record.policyVerdict);
  }
  if (record?.error) return "error";
  return stringOrNull(record?.lifecycle?.stage);
}

function signerAuditDetail(record = {}) {
  const protocol = stringOrNull(record?.intent?.metadata?.protocol);
  const intentType = stringOrNull(record?.intent?.intentType);
  if (protocol && intentType) return `${protocol} ${intentType}`;
  return protocol || intentType || null;
}

function signerAuditFinalAsset(record = {}) {
  return (
    stringOrNull(record?.intent?.metadata?.asset) ??
    stringOrNull(record?.intent?.metadata?.assetSymbol) ??
    stringOrNull(record?.intent?.metadata?.ticker) ??
    stringOrNull(record?.intent?.metadata?.shareTokenSymbol) ??
    null
  );
}

function normalizeSignerAuditActivity(record = {}) {
  const strategyId = stringOrNull(record?.strategyId);
  if (!strategyId) return null;
  const status = signerAuditStatus(record);
  if (!["signed", "broadcasted", "confirmed", "rejected", "error"].includes(status)) return null;
  const txHash = stringOrNull(record?.lifecycle?.txHash) ?? stringOrNull(record?.broadcast?.txHash) ?? null;
  const finalAsset = signerAuditFinalAsset(record);
  return Object.freeze({
    id: normalizeActivityId(["transaction", txHash || record.intentHash || record.intentId, record.timestamp]),
    kind: "transaction",
    kindLabel: "거래",
    observedAt: stringOrNull(record.timestamp),
    strategyId,
    strategyKey: normalizeStrategyId(strategyId),
    chain: stringOrNull(record.chain),
    protocol: stringOrNull(record?.intent?.metadata?.protocol),
    status,
    amountUsd: finiteNumber(record.amountUsd) ?? finiteNumber(record?.intent?.amountUsd) ?? null,
    amountSats: null,
    realizedNetPnlUsd: null,
    finalAssetId: finalAsset,
    finalAssetLabel: finalAsset,
    txHash,
    detail: signerAuditDetail(record),
  });
}

function latestSignerAuditActivities(records = []) {
  const latest = new Map();
  for (const record of records || []) {
    const key = signerAuditActivityKey(record);
    if (!key) continue;
    const existing = latest.get(key);
    const observedAt = stringOrNull(record.timestamp);
    if (!existing || new Date(observedAt || 0) > new Date(stringOrNull(existing.timestamp) || 0)) {
      latest.set(key, record);
    }
  }
  return [...latest.values()].map(normalizeSignerAuditActivity).filter(Boolean);
}

function normalizePaybackActivity(payback = null, btcUsd = null) {
  if (!payback?.lastPaybackSettledAt) return null;
  const settledSats = finiteNumber(payback.lastPaybackSettledSats);
  return Object.freeze({
    id: normalizeActivityId(["payback", payback.lastPaybackSettledAt]),
    kind: "payback",
    kindLabel: "페이백",
    observedAt: stringOrNull(payback.lastPaybackSettledAt),
    strategyId: "gateway-btc-offramp",
    strategyKey: normalizeStrategyId("gateway-btc-offramp"),
    chain: "bitcoin",
    protocol: "gateway",
    status: "settled",
    amountUsd: satsToUsd(settledSats, btcUsd),
    amountSats: settledSats,
    realizedNetPnlUsd: null,
    finalAssetId: "btc",
    finalAssetLabel: "BTC",
    txHash: null,
    detail: "Bitcoin L1 settled",
  });
}

function leverageHint(slice = null) {
  const strategyId = stringOrNull(slice?.strategy?.id);
  if (!strategyId) return null;
  return {
    strategyId,
    strategyKey: normalizeStrategyId(strategyId),
    chain: stringOrNull(slice?.strategy?.chain),
    protocol: stringOrNull(slice?.strategy?.protocol),
    collateralAsset: stringOrNull(slice?.strategy?.collateralAsset),
    borrowAsset: stringOrNull(slice?.strategy?.borrowAsset),
    perTradeCapUsd: finiteNumber(slice?.strategy?.perTradeCapUsd),
    targetHealthFactor: finiteNumber(slice?.strategy?.targetHealthFactor),
    healthFactorMin: finiteNumber(slice?.strategy?.healthFactorMin),
    projectedHealthFactor: finiteNumber(slice?.entryPlan?.projectedHealthFactor),
    liquidationBufferPct: finiteNumber(slice?.strategy?.liquidationBufferPct),
    projectedLiquidationBufferPct: finiteNumber(slice?.entryPlan?.projectedLiquidationBufferPct),
  };
}

function buildStrategyRiskById({ wrappedBtcLendingLoopSlice = null, recursiveWrappedBtcLoop = null } = {}) {
  const hints = [leverageHint(wrappedBtcLendingLoopSlice), leverageHint(recursiveWrappedBtcLoop)].filter(Boolean);
  return Object.freeze(
    Object.fromEntries(
      hints.map((hint) => [hint.strategyId, Object.freeze(hint)]),
    ),
  );
}

export function buildFlowDashboardSlice({
  executionEvents = [],
  merklPositionEvents = [],
  signerAuditRecords = [],
  payback = null,
  capitalSummary = null,
  btcUsd = null,
  wrappedBtcLendingLoopSlice = null,
  recursiveWrappedBtcLoop = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const executionActivities = (executionEvents || []).map(normalizeExecutionActivity).filter(Boolean);
  const positionActivities = (merklPositionEvents || []).map(normalizePositionActivity).filter(Boolean);
  const settledTxHashes = new Set(
    [...executionActivities, ...positionActivities]
      .map((item) => stringOrNull(item.txHash)?.toLowerCase())
      .filter(Boolean),
  );
  const auditActivities = latestSignerAuditActivities(signerAuditRecords).filter(
    (item) => !(item.status === "confirmed" && item.txHash && settledTxHashes.has(item.txHash.toLowerCase())),
  );

  const recentActivities = [
    ...auditActivities,
    ...executionActivities,
    ...positionActivities,
    normalizePaybackActivity(payback, btcUsd),
  ]
    .filter(Boolean)
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))
    .slice(0, 8)
    .map((item) => Object.freeze(item));

  const pendingCarrySats =
    finiteNumber(payback?.carry?.pendingSats) ??
    finiteNumber(payback?.accumulatorPendingSats) ??
    null;
  const grossProfitSatsPeriod = finiteNumber(payback?.grossProfitSatsPeriod);
  const paidBackSatsLifetime = finiteNumber(payback?.paidBackSatsLifetime);
  const lastPaybackSettledSats = finiteNumber(payback?.lastPaybackSettledSats);

  return Object.freeze({
    schemaVersion: 1,
    generatedAt,
    metrics: Object.freeze({
      assetValueUsd: finiteNumber(capitalSummary?.totalUsd),
      grossProfitSatsPeriod,
      grossProfitUsdPeriod: satsToUsd(grossProfitSatsPeriod, btcUsd),
      pendingCarrySats,
      pendingCarryUsd: satsToUsd(pendingCarrySats, btcUsd),
      paidBackSatsLifetime,
      paidBackUsdLifetime: satsToUsd(paidBackSatsLifetime, btcUsd),
      lastPaybackSettledSats,
      lastPaybackSettledUsd: satsToUsd(lastPaybackSettledSats, btcUsd),
    }),
    strategyRiskById: buildStrategyRiskById({
      wrappedBtcLendingLoopSlice,
      recursiveWrappedBtcLoop,
    }),
    recentActivities: Object.freeze(recentActivities),
  });
}
