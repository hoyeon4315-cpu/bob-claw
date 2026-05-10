import { randomUUID } from "node:crypto";
import { JsonlStore } from "../../lib/jsonl-store.mjs";

const DEFAULT_TOLERANCE_BTC = 0.01;
const DEFAULT_TOLERANCE_USD = 100;
const MIN_TOLERANCE_BTC = 0.00001;
const MIN_TOLERANCE_USD = 1;
const TOLERANCE_FRACTION = 0.005;

export function resolveCapitalAuditTolerance({
  operatingCapitalBtc = null,
  operatingCapitalUsd = null,
  toleranceBtc = DEFAULT_TOLERANCE_BTC,
  toleranceUsd = DEFAULT_TOLERANCE_USD,
} = {}) {
  const capBtc = Number(operatingCapitalBtc);
  const capUsd = Number(operatingCapitalUsd);
  const dynamicBtc = Number.isFinite(capBtc) && capBtc > 0
    ? Math.max(MIN_TOLERANCE_BTC, capBtc * TOLERANCE_FRACTION)
    : toleranceBtc;
  const dynamicUsd = Number.isFinite(capUsd) && capUsd > 0
    ? Math.max(MIN_TOLERANCE_USD, capUsd * TOLERANCE_FRACTION)
    : toleranceUsd;
  return {
    toleranceBtc: Number(Math.min(toleranceBtc, dynamicBtc).toFixed(12)),
    toleranceUsd: Number(Math.min(toleranceUsd, dynamicUsd).toFixed(6)),
  };
}

export function buildPreTradeSnapshot({
  strategyId,
  chain,
  operatingCapitalBtc,
  operatingCapitalUsd,
  perChainInventory,
  protocolLockedNav,
}) {
  return {
    snapshotId: randomUUID(),
    timestamp: new Date().toISOString(),
    intentHash: null,
    strategyId,
    chain,
    operatingCapitalBtc,
    operatingCapitalUsd,
    perChainInventory: perChainInventory ?? {},
    protocolLockedNav: protocolLockedNav ?? {},
  };
}

export function buildPostBroadcastReconciliation({
  intentHash,
  preSnapshot,
  postBroadcastData,
  feesUsd,
  slippageBps,
  protocolMarkDelta,
}) {
  return {
    reconciliationId: randomUUID(),
    timestamp: new Date().toISOString(),
    intentHash,
    strategyId: preSnapshot?.strategyId ?? null,
    chain: preSnapshot?.chain ?? null,
    preSnapshotId: preSnapshot?.snapshotId ?? null,
    postOperatingCapitalBtc: postBroadcastData?.operatingCapitalBtc ?? null,
    postOperatingCapitalUsd: postBroadcastData?.operatingCapitalUsd ?? null,
    postPerChainInventory: postBroadcastData?.perChainInventory ?? {},
    postProtocolLockedNav: postBroadcastData?.protocolLockedNav ?? {},
    feesUsd: feesUsd ?? null,
    slippageBps: slippageBps ?? null,
    protocolMarkDelta: protocolMarkDelta ?? null,
  };
}

export function validateCapitalAuditPair({
  preSnapshot,
  reconciliation,
  toleranceBtc = null,
  toleranceUsd = null,
} = {}) {
  if (!preSnapshot || !reconciliation) {
    return { ok: false, deltaBtc: null, deltaUsd: null, unmatched: true };
  }
  const resolvedTolerance = toleranceBtc !== null || toleranceUsd !== null
    ? {
        toleranceBtc: toleranceBtc ?? DEFAULT_TOLERANCE_BTC,
        toleranceUsd: toleranceUsd ?? DEFAULT_TOLERANCE_USD,
      }
    : resolveCapitalAuditTolerance({
        operatingCapitalBtc: preSnapshot.operatingCapitalBtc,
        operatingCapitalUsd: preSnapshot.operatingCapitalUsd,
      });

  const preBtc = Number(preSnapshot.operatingCapitalBtc ?? 0);
  const postBtc = Number(reconciliation.postOperatingCapitalBtc ?? 0);
  const preUsd = Number(preSnapshot.operatingCapitalUsd ?? 0);
  const postUsd = Number(reconciliation.postOperatingCapitalUsd ?? 0);

  const deltaBtc = postBtc - preBtc;
  const deltaUsd = postUsd - preUsd;

  const feesUsd = Number(reconciliation.feesUsd ?? 0);
  const protocolMarkDelta = Number(reconciliation.protocolMarkDelta ?? 0);

  const expectedDeltaUsd = -(feesUsd + protocolMarkDelta);
  const usdDeviation = Math.abs(deltaUsd - expectedDeltaUsd);

  const btcWithinTolerance = Math.abs(deltaBtc) <= resolvedTolerance.toleranceBtc;
  const usdWithinTolerance = usdDeviation <= resolvedTolerance.toleranceUsd;

  const ok = btcWithinTolerance && usdWithinTolerance;

  return {
    ok,
    deltaBtc,
    deltaUsd,
    unmatched: !ok,
    metrics: {
      btcWithinTolerance,
      usdWithinTolerance,
      usdDeviation,
      expectedDeltaUsd,
      toleranceBtc: resolvedTolerance.toleranceBtc,
      toleranceUsd: resolvedTolerance.toleranceUsd,
    },
  };
}

export function buildCapitalAuditClosureRecord({
  auditRecord = {},
  receiptRecord = null,
  source = "receipt_reconciliation_backfill",
  observedAt = new Date().toISOString(),
} = {}) {
  const intentHash = auditRecord.intentHash;
  const strategyId = auditRecord.strategyId || "unknown";
  const txHash = auditRecord.lifecycle?.txHash || auditRecord.broadcast?.txHash || receiptRecord?.txHash || null;
  const reconciliationStatus = receiptRecord?.reconciliationStatus ||
    (auditRecord.lifecycle?.stage === "reverted" ? "failed" : null) ||
    (auditRecord.lifecycle?.stage === "confirmed" ? "reconciled" : null);
  return {
    schemaVersion: 1,
    status: ["reconciled", "failed", "final_failed"].includes(reconciliationStatus) ? "closed" : "pending",
    stage: "post_reconciliation",
    source,
    observedAt,
    strategyId,
    chain: auditRecord.chain || receiptRecord?.chain || null,
    intentHash,
    txHash,
    reconciliationStatus,
    realizedGasUsd: receiptRecord?.realized?.actualKnownCostUsd ?? auditRecord.realized?.actualKnownCostUsd ?? null,
    slippageBps: receiptRecord?.realized?.realizedFillVsEstimateBps ?? auditRecord.realized?.slippageBps ?? null,
    protocolPositionMarkDelta: null,
    receiptKind: receiptRecord?.kind || null,
    validation: {
      ok: ["reconciled", "failed", "final_failed"].includes(reconciliationStatus),
      method: source,
    },
  };
}

export async function appendCapitalAuditPair(baseDir, pairRecord) {
  const store = new JsonlStore(baseDir);
  return store.append("capital-audit-pairs", pairRecord);
}
