import snapshotPaybackAccumulator from "./accumulator.mjs";
import { GATEWAY_BTC_OFFRAMP_STRATEGY_ID } from "../helpers/gateway-btc-offramp.mjs";
import { loadLivePaybackReceiptStore, loadPaybackAuditLog } from "../ingestor/execution-receipt-ingest.mjs";
import { buildPaybackDecision } from "./scheduler.mjs";

const PREVIEW_BTC_DESTINATION = "bc1qpayback0000000000000000000000000000000";

function normalizeTimestamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function finiteNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRecords(items = []) {
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
}

function readPath(target, path) {
  if (!target || typeof target !== "object") return undefined;
  return path.split(".").reduce((value, segment) => (value == null ? undefined : value[segment]), target);
}

function firstPresent(target, paths = []) {
  for (const path of paths) {
    const value = readPath(target, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstFinite(target, paths = []) {
  for (const path of paths) {
    const value = finiteNumber(readPath(target, path));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function buildMinimumGapMetrics(grossTargetBeforeCostsSats, minPaybackSats) {
  if (!Number.isFinite(grossTargetBeforeCostsSats) || !Number.isFinite(minPaybackSats) || minPaybackSats <= 0) {
    return {
      satsToMinimumPayback: null,
      progressToMinimumRatio: null,
    };
  }
  return {
    satsToMinimumPayback: Math.max(0, Math.round(minPaybackSats - grossTargetBeforeCostsSats)),
    progressToMinimumRatio: Math.max(0, Math.min(1, grossTargetBeforeCostsSats / minPaybackSats)),
  };
}

function requiredGrossProfitSats({ minPaybackSats, baseRatio, regimeMultiplier, volMultiplier }) {
  if (
    !Number.isFinite(minPaybackSats) ||
    !Number.isFinite(baseRatio) ||
    !Number.isFinite(regimeMultiplier) ||
    !Number.isFinite(volMultiplier)
  ) {
    return null;
  }
  const appliedMultiplier = baseRatio * regimeMultiplier * volMultiplier;
  if (!(appliedMultiplier > 0)) return null;
  return Math.ceil(minPaybackSats / appliedMultiplier);
}

function minimumPaybackProgress(decision, { source = null } = {}) {
  if (!decision || typeof decision !== "object") return null;
  const grossTargetBeforeCostsSats = firstFinite(decision, [
    "decisionLog.inputs.grossTargetBeforeCostsSats",
    "decisionLog.applied.grossTargetBeforeCostsSats",
  ]);
  const minPaybackSats = firstFinite(decision, [
    "decisionLog.inputs.minPaybackSats",
    "policy.minPaybackSats",
  ]);
  const baseRatio = firstFinite(decision, [
    "decisionLog.inputs.baseRatio",
    "decisionLog.applied.baseRatio",
    "policy.baseRatio",
  ]);
  const regimeMultiplier = firstFinite(decision, [
    "decisionLog.inputs.regimeMultiplier",
    "decisionLog.applied.regimeMultiplier",
  ]);
  const volMultiplier = firstFinite(decision, [
    "decisionLog.inputs.volMultiplier",
    "decisionLog.applied.volMultiplier",
  ]);
  const gapMetrics = buildMinimumGapMetrics(grossTargetBeforeCostsSats, minPaybackSats);
  const grossProfitRequiredSats = requiredGrossProfitSats({
    minPaybackSats,
    baseRatio,
    regimeMultiplier,
    volMultiplier,
  });
  if (
    !Number.isFinite(grossTargetBeforeCostsSats) &&
    !Number.isFinite(minPaybackSats) &&
    !Number.isFinite(gapMetrics.satsToMinimumPayback) &&
    !Number.isFinite(grossProfitRequiredSats)
  ) {
    return null;
  }
  return {
    source,
    status: decision.status || null,
    reason: decision.reason || null,
    grossProfitSatsPeriod: firstFinite(decision, [
      "decisionLog.inputs.grossProfitSatsPeriod",
      "snapshot.grossProfitSats_period",
    ]),
    requiredGrossProfitSats: grossProfitRequiredSats,
    grossTargetBeforeCostsSats,
    minPaybackSats,
    satsToMinimumPayback: gapMetrics.satsToMinimumPayback,
    progressToMinimumRatio: gapMetrics.progressToMinimumRatio,
  };
}

function allRecordsForPayback(auditLogLines = [], receiptStore = {}) {
  return [
    ...normalizeRecords(auditLogLines),
    ...Object.values(receiptStore).filter(Array.isArray).flatMap((items) => normalizeRecords(items)),
  ];
}

function threeWayPaybackReceipt(record) {
  return {
    sourceTxHash: firstPresent(record, [
      "signerResult.broadcast.txHash",
      "broadcast.txHash",
      "receipt.hash",
      "txHash",
    ]),
    gatewayOrderId: firstPresent(record, [
      "metadata.gatewayOrderId",
      "plan.intent.metadata.gatewayOrderId",
      "plan.order.orderId",
      "order.orderId",
      "gatewayOrderId",
    ]),
    bitcoinTxid: firstPresent(record, [
      "destinationProof.txid",
      "destinationProof.bitcoinTxid",
      "metadata.bitcoinTxid",
      "payback.bitcoinTxid",
      "bitcoinTxid",
    ]),
  };
}

function paybackSettlementTimestamp(record) {
  return firstPresent(record, [
    "destinationProof.observedAt",
    "settledAt",
    "observedAt",
  ]);
}

function deliveredPaybackRecord(records = []) {
  let winner = null;
  let winnerMs = -1;
  for (const record of records) {
    const strategyId =
      record?.strategyId ??
      record?.plan?.strategyId ??
      record?.intent?.strategyId ??
      record?.signerResult?.signed?.strategyId ??
      null;
    const intentType =
      record?.intent?.intentType ??
      record?.plan?.intent?.intentType ??
      null;
    if (strategyId !== GATEWAY_BTC_OFFRAMP_STRATEGY_ID && intentType !== "gateway_btc_offramp") continue;
    if (record?.settlementStatus !== "delivered" && record?.destinationProof?.status !== "delivered") continue;
    const receipt = threeWayPaybackReceipt(record);
    if (!receipt.sourceTxHash || !receipt.gatewayOrderId || !receipt.bitcoinTxid) continue;
    const observedAtMs = normalizeTimestamp(paybackSettlementTimestamp(record));
    if (observedAtMs != null && observedAtMs >= winnerMs) {
      winner = record;
      winnerMs = observedAtMs;
    }
  }
  return winner;
}

export async function buildPaybackDashboardSlice({
  dataDir,
  logsDir,
  now = new Date().toISOString(),
  auditLogLines = null,
  receiptStore = null,
  decisionBuilder = buildPaybackDecision,
} = {}) {
  const resolvedAuditLogLines = auditLogLines || await loadPaybackAuditLog({ logsDir });
  const resolvedReceiptStore = receiptStore || await loadLivePaybackReceiptStore({ dataDir });
  const snapshot = snapshotPaybackAccumulator(resolvedAuditLogLines, resolvedReceiptStore, {
    paybackStrategyIds: [GATEWAY_BTC_OFFRAMP_STRATEGY_ID],
    paybackIntentTypes: ["gateway_btc_offramp"],
  });
  const decision = typeof decisionBuilder === "function"
    ? await decisionBuilder({
        auditLogLines: resolvedAuditLogLines,
        receiptStore: resolvedReceiptStore,
        now,
      })
    : null;
  const previewAfterDestination =
    typeof decisionBuilder === "function" && decision?.reason === "payback_btc_destination_missing"
      ? await decisionBuilder({
          auditLogLines: resolvedAuditLogLines,
          receiptStore: resolvedReceiptStore,
          now,
          recipientOverride: PREVIEW_BTC_DESTINATION,
        })
      : null;
  const previewMinimumPaybackProgress = minimumPaybackProgress(previewAfterDestination, {
    source: "after_destination",
  });
  const currentMinimumPaybackProgress = minimumPaybackProgress(decision, {
    source: "current",
  });
  const latestDelivered = deliveredPaybackRecord(allRecordsForPayback(resolvedAuditLogLines, resolvedReceiptStore));
  return {
    schemaVersion: 1,
    observedAt: now,
    lastPaybackSettledAt: paybackSettlementTimestamp(latestDelivered),
    lastPaybackSettledSats:
      firstFinite(latestDelivered, [
        "destinationProof.observedDelta",
        "payback.settledBalanceDeltaSats",
        "realized.settledBalanceDeltaSats",
        "settledBalanceDeltaSats",
      ]),
    accumulatorPendingSats: snapshot.pendingDeferredSats,
    grossProfitSatsPeriod: snapshot.grossProfitSats_period,
    paidBackSatsLifetime: snapshot.paidBackSats_lifetime,
    scheduler: {
      status: decision?.status || null,
      reason: decision?.reason || null,
      requiredEnvName: firstPresent(decision, [
        "decisionLog.inputs.bitcoinDestAddressEnv",
      ]),
      nextAction:
        decision?.reason === "payback_btc_destination_missing"
          ? "set_payback_btc_destination_env"
          : null,
      minimumPaybackProgress:
        decision?.reason === "planned_payback_below_minimum"
          ? currentMinimumPaybackProgress
          : previewMinimumPaybackProgress,
      previewAfterDestination: previewAfterDestination
        ? {
            ...previewMinimumPaybackProgress,
          }
        : null,
    },
    kpi: {
      byrRolling12m: snapshot.kpi?.byr_rolling12m ?? 0,
      cgRolling12m: snapshot.kpi?.cg_rolling12m ?? 0,
      tbrRolling12m: snapshot.kpi?.tbr_rolling12m ?? 0,
      roundTripEfficiencyPeriod: snapshot.kpi?.roundTripEfficiency_period ?? 0,
      daysToBreakeven: snapshot.kpi?.daysToBreakeven ?? 0,
    },
    expansionGate: snapshot.expansionGate
      ? {
          reserveChain: snapshot.expansionGate.reserveChain,
          targetEfficiency: snapshot.expansionGate.targetEfficiency,
          requiredConsecutivePeriods: snapshot.expansionGate.requiredConsecutivePeriods,
          consecutivePeriodsMeetingTarget: snapshot.expansionGate.consecutivePeriodsMeetingTarget,
          periodsRemaining: snapshot.expansionGate.periodsRemaining,
          deliveredPeriodCountOnReserveChain: snapshot.expansionGate.deliveredPeriodCountOnReserveChain,
          deliveredPeriodCountAllChains: snapshot.expansionGate.deliveredPeriodCountAllChains,
          eligible: snapshot.expansionGate.eligible,
          mostRecentPeriodEfficiency: snapshot.expansionGate.mostRecent?.efficiency ?? null,
          mostRecentPeriodObservedAt: snapshot.expansionGate.mostRecent?.observedAt ?? null,
        }
      : null,
    paybackPeriodEfficiencies: snapshot.paybackPeriodEfficiencies || [],
    dataSources: {
      auditLogCount: normalizeRecords(resolvedAuditLogLines).length,
      receiptReconciliationCount: normalizeRecords(resolvedReceiptStore.receiptReconciliations).length,
      liveWrappedLoopReceiptCount:
        normalizeRecords(resolvedReceiptStore.wrappedBtcLoopReceipts).length +
        normalizeRecords(resolvedReceiptStore.wrappedBtcLoopLiveProofs).length,
      treasuryInventoryCount: normalizeRecords(resolvedReceiptStore.treasuryInventory).length,
      marketPriceSnapshotCount: normalizeRecords(resolvedReceiptStore.marketPriceSnapshots).length,
    },
  };
}
