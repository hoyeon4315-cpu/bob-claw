import { buildLiveYieldSlice, liveYieldMetricFields } from "./live-yield-slice.mjs";

const RECENT_MOVEMENT_WINDOW_MS = 6 * 60 * 60 * 1000;

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

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeStrategyId(strategyId) {
  return stringOrNull(strategyId)?.replace(/-/g, "_") || null;
}

function normalizeAssetId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const mapped = {
    "wbtc.oft": "wbtc",
    "btc.b": "wbtc",
    btcb: "wbtc",
    cbbtc: "cbbtc",
  }[raw];
  if (mapped) return mapped;
  if (raw.endsWith(".oft")) return raw.replace(/\.oft$/u, "");
  if (raw.startsWith("0x0555e30")) return "wbtc";
  if (raw.startsWith("0xcbb7c000")) return "cbbtc";
  return raw;
}

function parseGatewayRouteKey(routeKey = null) {
  const raw = stringOrNull(routeKey);
  if (!raw || !raw.includes("->")) return null;
  const [fromRaw, toRaw] = raw.split("->");
  const [fromChainId, fromAsset] = String(fromRaw || "").split(":");
  const [toChainId, toAsset] = String(toRaw || "").split(":");
  if (!fromChainId || !toChainId) return null;
  return {
    routeKey: raw,
    fromChainId: fromChainId.toLowerCase(),
    toChainId: toChainId.toLowerCase(),
    fromAssetId: normalizeAssetId(fromAsset),
    toAssetId: normalizeAssetId(toAsset),
  };
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

function eventOutputAssetLabel(event = {}) {
  const outputAsset = event?.receiptIngest?.receiptRecord?.output?.asset || {};
  return (
    stringOrNull(outputAsset.icon) ??
    stringOrNull(outputAsset.ticker) ??
    stringOrNull(outputAsset.symbol) ??
    stringOrNull(event.receiptIngest?.receiptRecord?.output?.ticker) ??
    stringOrNull(event.receiptIngest?.receiptRecord?.output?.symbol) ??
    null
  );
}

function routeProviderFromExecution(event = {}) {
  const method = stringOrNull(event.executionMethod)?.toLowerCase() || "";
  const strategyId = stringOrNull(event.strategyId)?.toLowerCase() || "";
  const provider = stringOrNull(event.provider)?.toLowerCase() || "";
  if (method.includes("lifi") || strategyId.includes("lifi") || provider.includes("lifi")) return "lifi";
  if (method.includes("across") || strategyId.includes("across") || provider.includes("across")) return "across";
  if (method.includes("gas_zip") || strategyId.includes("gas-zip") || provider.includes("gas_zip")) return "gas_zip";
  if (strategyId.includes("gateway") || method === "cross_chain_bridge_or_swap" || method.includes("gateway")) return "gateway";
  return "direct";
}

function routeKindForProvider(provider) {
  return provider === "gateway" ? "gateway_bridge" : "direct_bridge";
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
  const route = executionRoute(event);
  return Object.freeze({
    id: normalizeActivityId(["execution", txHash || event.jobId, event.observedAt]),
    kind: "execution",
    kindLabel: "실행",
    observedAt: stringOrNull(event.observedAt),
    strategyId,
    strategyKey: normalizeStrategyId(strategyId),
    chain: route?.toChainId || stringOrNull(event.chain),
    fromChainId: route?.fromChainId || null,
    toChainId: route?.toChainId || null,
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
  const protocol = stringOrNull(record?.intent?.metadata?.protocol) ?? stringOrNull(record?.intent?.metadata?.provider);
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
  const route = signerAuditRoute(record);
  const blockers = Array.isArray(record?.lifecycle?.blockers) ? record.lifecycle.blockers.filter(Boolean).map(String) : [];
  return Object.freeze({
    id: normalizeActivityId(["transaction", txHash || record.intentHash || record.intentId, record.timestamp]),
    kind: "transaction",
    kindLabel: "거래",
    observedAt: stringOrNull(record.timestamp),
    strategyId,
    strategyKey: normalizeStrategyId(strategyId),
    chain: route?.toChainId || stringOrNull(record.chain),
    fromChainId: route?.fromChainId || null,
    toChainId: route?.toChainId || null,
    protocol: stringOrNull(record?.intent?.metadata?.protocol) ?? stringOrNull(record?.intent?.metadata?.provider),
    status,
    amountUsd: finiteNumber(record.amountUsd) ?? finiteNumber(record?.intent?.amountUsd) ?? null,
    amountSats: null,
    realizedNetPnlUsd: null,
    finalAssetId: finalAsset,
    finalAssetLabel: finalAsset,
    txHash,
    detail: signerAuditDetail(record),
    blockers: Object.freeze(blockers),
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

function executionRoute(event = {}) {
  const routeContext = event?.receiptIngest?.receiptRecord?.routeContext || {};
  const parsed = parseGatewayRouteKey(routeContext.routeKey);
  const fromChainId = stringOrNull(routeContext.srcChain)?.toLowerCase() || parsed?.fromChainId || null;
  const toChainId = stringOrNull(routeContext.dstChain)?.toLowerCase() || parsed?.toChainId || null;
  if (!fromChainId || !toChainId || fromChainId === toChainId) return null;
  const outputAssetId = normalizeAssetId(eventOutputAssetLabel(event));
  const fromAssetId = normalizeAssetId(routeContext.srcTicker || routeContext.srcAsset || parsed?.fromAssetId || event.sourceAsset);
  const toAssetId = normalizeAssetId(routeContext.dstTicker || routeContext.dstAsset || outputAssetId || parsed?.toAssetId);
  return {
    routeKey: stringOrNull(routeContext.routeKey) || parsed?.routeKey || null,
    fromChainId,
    toChainId,
    fromAssetId: fromAssetId || parsed?.fromAssetId || null,
    toAssetId: toAssetId || outputAssetId || parsed?.toAssetId || null,
    assetId: toAssetId || outputAssetId || parsed?.toAssetId || fromAssetId || parsed?.fromAssetId || normalizeAssetId(eventFinalAssetLabel(event)) || "wbtc",
  };
}

function signerAuditRoute(record = {}) {
  const parsed = parseGatewayRouteKey(record?.intent?.metadata?.gatewayRouteKey);
  if (!parsed || parsed.fromChainId === parsed.toChainId) return null;
  return {
    routeKey: parsed.routeKey,
    fromChainId: parsed.fromChainId,
    toChainId: parsed.toChainId,
    fromAssetId: parsed.fromAssetId || null,
    toAssetId: normalizeAssetId(signerAuditFinalAsset(record) || parsed.toAssetId) || null,
    assetId: normalizeAssetId(signerAuditFinalAsset(record) || parsed.toAssetId || parsed.fromAssetId || "wbtc"),
  };
}

function normalizeExecutionMovement(event = {}) {
  if (!isDeliveredExecution(event)) return null;
  const route = executionRoute(event);
  if (!route) return null;
  const txHash = lastTxHash(event);
  const routeProvider = routeProviderFromExecution(event);
  const kind = routeKindForProvider(routeProvider);
  return Object.freeze({
    id: normalizeActivityId(["movement", txHash || event.jobId || route.routeKey, event.observedAt]),
    kind,
    observedAt: stringOrNull(event.observedAt),
    status: stringOrNull(event.status) || "delivered",
    strategyId: stringOrNull(event.strategyId),
    strategyKey: normalizeStrategyId(event.strategyId),
    fromChainId: route.fromChainId,
    toChainId: route.toChainId,
    fromAssetId: route.fromAssetId,
    toAssetId: route.toAssetId,
    assetId: route.assetId || "wbtc",
    amountUsd: executionAmountUsd(event),
    txHash,
    routeKey: route.routeKey,
    routeProvider,
    viaGateway: routeProvider === "gateway",
  });
}

function normalizeExecutionRoutePlan(event = {}) {
  const source = event?.fundingSource?.source || null;
  const fromChainId = stringOrNull(source?.chain)?.toLowerCase() || null;
  const toChainId = stringOrNull(event.chain)?.toLowerCase() || null;
  if (!fromChainId || !toChainId || fromChainId === toChainId) return null;
  const method = stringOrNull(event.executionMethod)?.toLowerCase() || "";
  const fundingMethod = stringOrNull(event?.fundingSource?.method)?.toLowerCase() || "";
  if (!method.includes("cross_chain") && !fundingMethod.includes("cross_chain")) return null;
  const routeProvider = routeProviderFromExecution(event);
  const fromAssetId = normalizeAssetId(source.ticker || source.asset || source.token);
  const toAssetId = normalizeAssetId(event.asset || event.token || fromAssetId);
  const routeKey = `${fromChainId}:${fromAssetId || "asset"}->${toChainId}:${toAssetId || "asset"}`;
  return Object.freeze({
    id: normalizeActivityId(["movement-plan", event.jobId || routeKey, event.observedAt]),
    kind: routeKindForProvider(routeProvider),
    observedAt: stringOrNull(event.observedAt),
    status: stringOrNull(event.status) || "planned",
    projected: true,
    strategyId: stringOrNull(event?.riskDecision?.metrics?.strategyId) || stringOrNull(event.strategyId),
    strategyKey: normalizeStrategyId(event?.riskDecision?.metrics?.strategyId || event.strategyId),
    fromChainId,
    toChainId,
    fromAssetId,
    toAssetId,
    assetId: toAssetId || fromAssetId || "asset",
    amountUsd:
      finiteNumber(event?.riskDecision?.metrics?.exposureUsd) ??
      finiteNumber(source.estimatedUsd) ??
      finiteNumber(event.amountUsd) ??
      null,
    txHash: null,
    routeKey,
    routeProvider,
    viaGateway: routeProvider === "gateway",
  });
}

function normalizeSignerAuditMovement(record = {}) {
  const route = signerAuditRoute(record);
  if (!route) return null;
  const status = signerAuditStatus(record);
  if (!["signed", "broadcasted", "confirmed", "rejected", "error"].includes(status)) return null;
  const txHash = stringOrNull(record?.lifecycle?.txHash) ?? stringOrNull(record?.broadcast?.txHash) ?? null;
  return Object.freeze({
    id: normalizeActivityId(["movement", txHash || record.intentHash || record.intentId, record.timestamp]),
    kind: "gateway_bridge",
    observedAt: stringOrNull(record.timestamp),
    status,
    strategyId: stringOrNull(record.strategyId),
    strategyKey: normalizeStrategyId(record.strategyId),
    fromChainId: route.fromChainId,
    toChainId: route.toChainId,
    fromAssetId: route.fromAssetId,
    toAssetId: route.toAssetId,
    assetId: route.assetId || "wbtc",
    amountUsd: finiteNumber(record.amountUsd) ?? finiteNumber(record?.intent?.amountUsd) ?? null,
    txHash,
    routeKey: route.routeKey,
    routeProvider: "gateway",
    viaGateway: true,
  });
}

function isRecentMovement(movement = {}, asOfMs = Date.now()) {
  const observedMs = timestampMs(movement.observedAt);
  if (!Number.isFinite(observedMs) || !Number.isFinite(asOfMs)) return false;
  const ageMs = asOfMs - observedMs;
  return ageMs >= 0 && ageMs <= RECENT_MOVEMENT_WINDOW_MS;
}

function latestMovements({ executionEvents = [], signerAuditRecords = [], generatedAt = new Date().toISOString() } = {}) {
  const byKey = new Map();
  const asOfMs = timestampMs(generatedAt) ?? Date.now();
  const candidates = [
    ...(signerAuditRecords || []).map(normalizeSignerAuditMovement),
    ...(executionEvents || []).map(normalizeExecutionMovement),
    ...(executionEvents || []).map(normalizeExecutionRoutePlan),
  ].filter(Boolean).filter((movement) => isRecentMovement(movement, asOfMs));
  for (const movement of candidates) {
    const provider = movement.routeProvider || movement.kind || "movement";
    const key = movement.routeKey ? `${provider}:${movement.routeKey}` : movement.txHash || `${provider}:${movement.fromChainId}->${movement.toChainId}:${movement.assetId}`;
    const existing = byKey.get(key);
    if (!existing || new Date(movement.observedAt || 0) > new Date(existing.observedAt || 0)) {
      byKey.set(key, movement);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))
    .slice(0, 16)
    .map((item) => Object.freeze(item));
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
  merklActivePositions = null,
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
  const liveYield = buildLiveYieldSlice({
    merklActivePositions,
    btcUsd,
    generatedAt,
  });

  return Object.freeze({
    schemaVersion: 1,
    generatedAt,
    liveYield,
    metrics: Object.freeze({
      assetValueUsd:
        finiteNumber(capitalSummary?.estimatedCurrentTotalUsd) ??
        finiteNumber(capitalSummary?.currentTotalUsd) ??
        finiteNumber(capitalSummary?.displayTotalUsd) ??
        finiteNumber(capitalSummary?.totalUsd),
      grossProfitSatsPeriod,
      grossProfitUsdPeriod: satsToUsd(grossProfitSatsPeriod, btcUsd),
      pendingCarrySats,
      pendingCarryUsd: satsToUsd(pendingCarrySats, btcUsd),
      paidBackSatsLifetime,
      paidBackUsdLifetime: satsToUsd(paidBackSatsLifetime, btcUsd),
      lastPaybackSettledSats,
      lastPaybackSettledUsd: satsToUsd(lastPaybackSettledSats, btcUsd),
      ...liveYieldMetricFields(liveYield),
    }),
    strategyRiskById: buildStrategyRiskById({
      wrappedBtcLendingLoopSlice,
      recursiveWrappedBtcLoop,
    }),
    recentActivities: Object.freeze(recentActivities),
    recentMovements: Object.freeze(latestMovements({ executionEvents, signerAuditRecords, generatedAt })),
  });
}
