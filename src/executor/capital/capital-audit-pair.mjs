import { randomUUID } from "node:crypto";
import { JsonlStore } from "../../lib/jsonl-store.mjs";

const DEFAULT_TOLERANCE_BTC = 0.01;
const DEFAULT_TOLERANCE_USD = 100;

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
  toleranceBtc = DEFAULT_TOLERANCE_BTC,
  toleranceUsd = DEFAULT_TOLERANCE_USD,
} = {}) {
  if (!preSnapshot || !reconciliation) {
    return { ok: false, deltaBtc: null, deltaUsd: null, unmatched: true };
  }

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

  const btcWithinTolerance = Math.abs(deltaBtc) <= toleranceBtc;
  const usdWithinTolerance = usdDeviation <= toleranceUsd;

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
    },
  };
}

export async function appendCapitalAuditPair(baseDir, pairRecord) {
  const store = new JsonlStore(baseDir);
  return store.append("capital-audit-pairs", pairRecord);
}
