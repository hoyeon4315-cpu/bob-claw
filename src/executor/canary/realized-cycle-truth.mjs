import { canonicalGatewayChain } from "../../config/gateway-destinations.mjs";

const REQUIRED_FIELDS = Object.freeze([
  "openedAt",
  "closedAt",
  "entryUsd",
  "exitUsd",
  "entryGasUsd",
  "exitGasUsd",
  "claimCostUsd",
  "rewardSwapCostUsd",
  "rewardUsd",
  "bridgeCostUsd",
  "slippageUsd",
  "realizedNetUsd",
  "realizedNetBtcSats",
  "sourceObservedAt",
]);

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedPart(value, fallback = "unknown") {
  const out = normalized(value);
  return out || fallback;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstPresent(record = {}, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((cursor, part) => cursor?.[part], record);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function receiptRecordFrom(record = {}) {
  return record.receiptRecord
    || record.receiptIngest?.receiptRecord
    || record.execution?.receiptIngest?.receiptRecord
    || null;
}

function normalizeAssetPair(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[/:,_-]+/)
      : [];
  const parts = raw.map(normalized).filter(Boolean).sort();
  return parts.length ? parts.join("/") : "unknown";
}

export function normalizeExplorationKey(input = {}) {
  const strategyId = normalizedPart(input.strategyId || input.mappedStrategyId || input.familyId);
  const chain = canonicalGatewayChain(input.chain || input.chainId) || "unknown";
  const protocolId = normalizedPart(input.protocolId || input.protocol);
  const assetPair = normalizeAssetPair(input.assetPair || input.assetPairKey || input.pair || input.entryAssets);
  const rewardToken = normalizedPart(input.rewardToken || input.rewardSymbol || input.rewardAsset, "none");
  const opportunityId = normalizedPart(input.campaignId || input.opportunityId || input.opportunityKey, "none");
  const bindingKind = normalizedPart(input.bindingKind || input.protocolBindingPlan?.bindingKind);
  return [
    `strategy=${strategyId}`,
    `chain=${chain}`,
    `protocol=${protocolId}`,
    `pair=${assetPair}`,
    `reward=${rewardToken}`,
    `opportunity=${opportunityId}`,
    `binding=${bindingKind}`,
  ].join("|");
}

function inputFromRecord(record = {}) {
  const queueItem = record.queueItem || {};
  const metadata = record.metadata || {};
  return {
    strategyId: record.strategyId || record.mappedStrategyId || queueItem.mappedStrategyId || queueItem.strategyId || metadata.strategyId,
    familyId: record.familyId || queueItem.familyId || metadata.familyId,
    chain: record.chain || queueItem.chain || record.intent?.chain || metadata.chain,
    protocolId: record.protocolId || queueItem.protocolId || queueItem.protocol || metadata.protocolId || metadata.protocol,
    assetPair: record.assetPair || queueItem.assetPair || metadata.assetPair || queueItem.entryAssets,
    rewardToken: record.rewardToken || queueItem.rewardToken || metadata.rewardToken,
    campaignId: record.campaignId || queueItem.campaignId || metadata.campaignId,
    opportunityId: record.opportunityId || queueItem.opportunityId || record.intent?.opportunityId || metadata.opportunityId,
    bindingKind: record.bindingKind || queueItem.bindingKind || queueItem.protocolBindingPlan?.bindingKind || metadata.bindingKind,
  };
}

function valueFor(record = {}, field) {
  const fieldMap = {
    openedAt: ["openedAt", "entry.observedAt", "entry.timestamp", "open.observedAt", "plan.observedAt", "execution.plan.observedAt"],
    closedAt: ["closedAt", "exit.observedAt", "exit.timestamp", "execution.observedAt", "observedAt", "timestamp"],
    entryUsd: ["entryUsd", "entry.valueUsd", "sizing.amountUsd", "plan.amountUsd", "execution.plan.amountUsd", "amountUsd"],
    exitUsd: ["exitUsd", "exit.valueUsd", "realized.exitUsd"],
    entryGasUsd: ["entryGasUsd", "entry.gasUsd", "realized.entryGasUsd"],
    exitGasUsd: ["exitGasUsd", "exit.gasUsd", "realized.exitGasUsd"],
    claimCostUsd: ["claimCostUsd", "realized.claimCostUsd"],
    rewardSwapCostUsd: ["rewardSwapCostUsd", "realized.rewardSwapCostUsd"],
    rewardUsd: ["rewardUsd", "realized.rewardUsd"],
    bridgeCostUsd: ["bridgeCostUsd", "realized.bridgeCostUsd"],
    slippageUsd: ["slippageUsd", "realized.slippageUsd"],
    realizedNetUsd: ["realizedNetUsd", "realized.netUsd", "realized.realizedNetUsd", "realized.realizedNetPnlUsd"],
    realizedNetBtcSats: ["realizedNetBtcSats", "realized.realizedNetBtcSats", "realized.realizedNetPnlSats"],
    sourceObservedAt: ["sourceObservedAt", "observedAt", "timestamp"],
  };
  const direct = firstPresent(record, fieldMap[field] || [field]);
  if (direct !== null) return direct;
  const receiptRecord = receiptRecordFrom(record);
  if (!receiptRecord) return null;
  const receiptFieldMap = {
    openedAt: ["routeContext.observedAt"],
    closedAt: ["observedAt"],
    entryUsd: ["routeContext.estimatedInputUsd", "routeContext.inputUsd"],
    exitUsd: ["output.actualOutputUsd"],
    entryGasUsd: ["realized.entryGasUsd"],
    exitGasUsd: ["realized.exitGasUsd", "realized.receiptGasUsd", "realized.actualKnownCostUsd"],
    claimCostUsd: ["realized.claimCostUsd"],
    rewardSwapCostUsd: ["realized.rewardSwapCostUsd"],
    rewardUsd: ["realized.rewardUsd"],
    bridgeCostUsd: ["realized.bridgeCostUsd"],
    slippageUsd: ["realized.slippageUsd"],
    realizedNetUsd: ["realized.realizedNetPnlUsd", "realized.realizedNetUsd"],
    realizedNetBtcSats: ["realized.realizedNetPnlSats", "realized.realizedNetProfitSats", "pnl.realizedPnlSats"],
    sourceObservedAt: ["observedAt"],
  };
  const receiptValue = firstPresent(receiptRecord, receiptFieldMap[field] || []);
  if (receiptValue !== null) return receiptValue;
  if (terminalReconciliationStatus(record) === "reconciled") {
    if (field === "entryGasUsd") return 0;
    if (["claimCostUsd", "rewardSwapCostUsd", "rewardUsd", "bridgeCostUsd", "slippageUsd"].includes(field)) return 0;
  }
  return null;
}

function terminalReconciliationStatus(record = {}) {
  const receiptRecord = receiptRecordFrom(record);
  return firstPresent(record, [
    "terminalReconciliationStatus",
    "reconciliationStatus",
    "realized.terminalReconciliationStatus",
    "execution.reconciliationStatus",
  ]) || firstPresent(receiptRecord || {}, ["reconciliationStatus"]);
}

function computeRealizedNetUsd(record = {}) {
  const direct = finite(valueFor(record, "realizedNetUsd"));
  if (direct !== null) return direct;
  const entryUsd = finite(valueFor(record, "entryUsd"));
  const exitUsd = finite(valueFor(record, "exitUsd"));
  const rewardUsd = finite(valueFor(record, "rewardUsd"));
  const costs = [
    "entryGasUsd",
    "exitGasUsd",
    "claimCostUsd",
    "rewardSwapCostUsd",
    "bridgeCostUsd",
    "slippageUsd",
  ].map((field) => finite(valueFor(record, field)));
  if (entryUsd === null || exitUsd === null || rewardUsd === null || costs.some((value) => value === null)) return null;
  return Number((exitUsd + rewardUsd - entryUsd - costs.reduce((sum, value) => sum + value, 0)).toFixed(12));
}

function satsFromUsd(usd, btcUsd) {
  const netUsd = finite(usd);
  const price = finite(btcUsd);
  if (netUsd === null || !(price > 0)) return null;
  return Math.round((netUsd / price) * 100_000_000);
}

function txHashFor(record = {}) {
  return firstPresent(record, [
    "txHash",
    "receiptRecord.txHash",
    "receiptIngest.receiptRecord.txHash",
    "execution.receiptIngest.receiptRecord.txHash",
  ]);
}

function mergeReceiptReconciliation(record = {}, receiptByTxHash = new Map()) {
  if (receiptRecordFrom(record)) return record;
  const txHash = txHashFor(record);
  const receiptRecord = txHash ? receiptByTxHash.get(String(txHash).toLowerCase()) : null;
  return receiptRecord ? { ...record, receiptRecord } : record;
}

function protocolGapCycle(mark = {}) {
  const missingFields = [...REQUIRED_FIELDS, "terminalReconciliationStatus:reconciled", "protocol_position_unmeasured_blocks_repeat_canary"];
  return {
    explorationKey: mark.explorationKey || normalizeExplorationKey(inputFromRecord(mark)),
    positionId: mark.positionId || null,
    strategyId: mark.strategyId || null,
    chain: canonicalGatewayChain(mark.chain) || null,
    protocolId: mark.protocolId || null,
    opportunityId: mark.opportunityId || null,
    openedAt: null,
    closedAt: mark.sourceObservedAt || mark.observedAt || null,
    entryUsd: null,
    exitUsd: null,
    entryGasUsd: null,
    exitGasUsd: null,
    claimCostUsd: null,
    rewardSwapCostUsd: null,
    rewardUsd: null,
    bridgeCostUsd: null,
    slippageUsd: null,
    realizedNetUsd: null,
    realizedNetBtcSats: null,
    terminalReconciliationStatus: null,
    completenessStatus: "incomplete",
    missingFields,
    sourceObservedAt: mark.sourceObservedAt || mark.observedAt || null,
    failureKind: mark.failureKind || "protocol_position_unmeasured",
  };
}

export function buildClosedCanaryCycleRecords({
  positionRecords = [],
  signerAuditRecords = [],
  protocolPositionMarks = [],
  receiptReconciliations = [],
  btcUsd = null,
} = {}) {
  void signerAuditRecords;
  const receiptByTxHash = new Map((receiptReconciliations || [])
    .map((record) => [txHashFor(record), record])
    .filter(([txHash]) => txHash)
    .map(([txHash, record]) => [String(txHash).toLowerCase(), record]));
  const cycleRecords = (positionRecords || []).map((rawRecord) => {
    const record = mergeReceiptReconciliation(rawRecord, receiptByTxHash);
    const base = {
      explorationKey: record.explorationKey || normalizeExplorationKey(inputFromRecord(record)),
      positionId: record.positionId || record.queueItem?.positionId || null,
      strategyId: record.strategyId || record.queueItem?.mappedStrategyId || record.queueItem?.strategyId || null,
      chain: canonicalGatewayChain(record.chain || record.queueItem?.chain) || null,
      protocolId: record.protocolId || record.queueItem?.protocolId || record.queueItem?.protocol || null,
      opportunityId: record.opportunityId || record.queueItem?.opportunityId || null,
      openedAt: valueFor(record, "openedAt"),
      closedAt: valueFor(record, "closedAt"),
      entryUsd: finite(valueFor(record, "entryUsd")),
      exitUsd: finite(valueFor(record, "exitUsd")),
      entryGasUsd: finite(valueFor(record, "entryGasUsd")),
      exitGasUsd: finite(valueFor(record, "exitGasUsd")),
      claimCostUsd: finite(valueFor(record, "claimCostUsd")),
      rewardSwapCostUsd: finite(valueFor(record, "rewardSwapCostUsd")),
      rewardUsd: finite(valueFor(record, "rewardUsd")),
      bridgeCostUsd: finite(valueFor(record, "bridgeCostUsd")),
      slippageUsd: finite(valueFor(record, "slippageUsd")),
      terminalReconciliationStatus: terminalReconciliationStatus(record) || null,
      sourceObservedAt: valueFor(record, "sourceObservedAt"),
    };
    base.realizedNetUsd = computeRealizedNetUsd(record);
    base.realizedNetBtcSats = finite(valueFor(record, "realizedNetBtcSats")) ?? satsFromUsd(base.realizedNetUsd, btcUsd);
    const missingFields = REQUIRED_FIELDS.filter((field) => base[field] === null || base[field] === undefined);
    if (base.terminalReconciliationStatus !== "reconciled") {
      missingFields.push("terminalReconciliationStatus:reconciled");
    }
    return {
      ...base,
      completenessStatus: missingFields.length === 0 ? "complete" : "incomplete",
      missingFields,
    };
  });
  const protocolGapRecords = (protocolPositionMarks || [])
    .filter((mark) => mark?.ok === false || mark?.status === "failed" || mark?.failureKind)
    .map(protocolGapCycle);
  return [...cycleRecords, ...protocolGapRecords];
}

export function evaluateRepeatCanaryProfitabilityGate({
  explorationKey,
  closedCycles = [],
  now = new Date().toISOString(),
} = {}) {
  const key = String(explorationKey || "");
  const sameKeyCycles = (closedCycles || [])
    .filter((cycle) => cycle?.explorationKey === key)
    .sort((left, right) => new Date(right.closedAt || right.sourceObservedAt || 0) - new Date(left.closedAt || left.sourceObservedAt || 0));
  const latest = sameKeyCycles[0] || null;
  if (!latest) {
    return {
      policy: "repeat_canary_profitability_gate",
      observedAt: now,
      decision: "ALLOW",
      blockers: [],
      evidence: { explorationKey: key, historyStatus: "first_canary_no_history" },
    };
  }
  if (latest.completenessStatus !== "complete") {
    const blocker = (latest.missingFields || []).includes("protocol_position_unmeasured_blocks_repeat_canary")
      ? "protocol_position_unmeasured_blocks_repeat_canary"
      : "accounting_incomplete_blocks_repeat_canary";
    return {
      policy: "repeat_canary_profitability_gate",
      observedAt: now,
      decision: "BLOCK",
      blockers: [blocker],
      evidence: { explorationKey: key, latest },
    };
  }
  if (!(finite(latest.realizedNetUsd) > 0)) {
    return {
      policy: "repeat_canary_profitability_gate",
      observedAt: now,
      decision: "BLOCK",
      blockers: ["realized_net_non_positive_blocks_repeat_canary"],
      evidence: { explorationKey: key, latest },
    };
  }
  return {
    policy: "repeat_canary_profitability_gate",
    observedAt: now,
    decision: "ALLOW",
    blockers: [],
    evidence: { explorationKey: key, latest },
  };
}
