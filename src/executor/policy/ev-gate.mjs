import {
  EXECUTION_EV_COST_POLICY,
  executionEvFallbackCostUsd,
  tinyCanarySameChainRoundTripCostUsd,
} from "../../config/sizing.mjs";

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeChain(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeTxHash(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function recordTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function observedAtForRecord(record = {}) {
  return record.observedAt || record.timestamp || null;
}

function evCostKey({ strategyId = null, chain = null, intentType = null } = {}) {
  return `${normalizeString(strategyId) || "unknown"}:${normalizeChain(chain) || "unknown"}:${normalizeString(intentType) || "unknown"}`;
}

function quantileNearestRank(values = [], percentile = EXECUTION_EV_COST_POLICY.costPercentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

function median(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function txHashFromAuditRecord(record = {}) {
  return normalizeTxHash(
    record.broadcast?.txHash ||
      record.realized?.txHash ||
      record.realized?.receiptTxHash ||
      record.lifecycle?.txHash ||
      null,
  );
}

function buildAuditMetadataIndex(auditRecords = []) {
  const index = new Map();
  for (const record of auditRecords) {
    const txHash = txHashFromAuditRecord(record);
    if (!txHash) continue;
    const candidate = {
      txHash,
      strategyId: normalizeString(record.strategyId),
      chain: normalizeChain(record.chain || record.intent?.chain || null),
      intentType: normalizeString(record.intent?.intentType || record.intentType || null),
      observedAt: observedAtForRecord(record),
      timestampMs: recordTimestamp(observedAtForRecord(record)) ?? 0,
    };
    const existing = index.get(txHash);
    if (!existing || candidate.timestampMs >= existing.timestampMs) {
      index.set(txHash, candidate);
    }
  }
  return index;
}

function buildSampleFromReceipt(receiptRecord = {}, auditMetadata = null) {
  const strategyId =
    auditMetadata?.strategyId ||
    normalizeString(receiptRecord.strategyId) ||
    normalizeString(receiptRecord.metadata?.strategyId);
  const chain =
    auditMetadata?.chain ||
    normalizeChain(receiptRecord.chain || receiptRecord.routeContext?.srcChain || receiptRecord.routeContext?.dstChain || null);
  const intentType =
    auditMetadata?.intentType ||
    normalizeString(receiptRecord.intentType) ||
    normalizeString(receiptRecord.kind);
  const costUsd = finiteNumber(receiptRecord?.realized?.actualKnownCostUsd);
  const observedAt = observedAtForRecord(receiptRecord) || auditMetadata?.observedAt || null;
  if (!strategyId || !chain || !intentType || costUsd === null) return null;
  return {
    key: evCostKey({ strategyId, chain, intentType }),
    strategyId,
    chain,
    intentType,
    txHash: normalizeTxHash(receiptRecord.txHash || auditMetadata?.txHash || null),
    observedAt,
    timestampMs: recordTimestamp(observedAt) ?? 0,
    costUsd,
    estimatedNetPnlUsd: finiteNumber(receiptRecord?.routeContext?.estimatedNetPnlUsd),
    realizedNetPnlUsd: finiteNumber(receiptRecord?.realized?.realizedNetPnlUsd),
    receiptKind: normalizeString(receiptRecord.kind),
  };
}

function withinLookback(record = {}, nowMs, lookbackMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(lookbackMs)) return true;
  const timestampMs = recordTimestamp(observedAtForRecord(record));
  if (!Number.isFinite(timestampMs)) return true;
  return timestampMs >= nowMs - lookbackMs;
}

export function buildEvCostModel({
  receiptRecords = [],
  auditRecords = [],
  now = new Date().toISOString(),
  policy = EXECUTION_EV_COST_POLICY,
} = {}) {
  const lookbackDays = finiteNumber(policy.lookbackDays) ?? EXECUTION_EV_COST_POLICY.lookbackDays;
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  const nowMs = recordTimestamp(now) ?? Date.now();
  const auditIndex = buildAuditMetadataIndex(auditRecords);
  const buckets = new Map();
  let matchedReceiptCount = 0;
  let consideredReceiptCount = 0;
  let skippedReceiptCount = 0;

  for (const receiptRecord of receiptRecords) {
    if (!withinLookback(receiptRecord, nowMs, lookbackMs)) continue;
    const txHash = normalizeTxHash(receiptRecord.txHash || null);
    const auditMetadata = txHash ? auditIndex.get(txHash) || null : null;
    const sample = buildSampleFromReceipt(receiptRecord, auditMetadata);
    if (!sample) {
      skippedReceiptCount += 1;
      continue;
    }
    consideredReceiptCount += 1;
    if (auditMetadata) matchedReceiptCount += 1;
    if (!buckets.has(sample.key)) buckets.set(sample.key, []);
    buckets.get(sample.key).push(sample);
  }

  const entries = [...buckets.entries()]
    .map(([key, samples]) => {
      const costsUsd = samples.map((item) => item.costUsd);
      const latestObservedAt = samples
        .map((item) => item.observedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
      const [first] = [...samples].sort((left, right) => right.timestampMs - left.timestampMs);
      return {
        key,
        strategyId: first.strategyId,
        chain: first.chain,
        intentType: first.intentType,
        sampleCount: samples.length,
        p50CostUsd: median(costsUsd),
        p90CostUsd: quantileNearestRank(costsUsd, policy.costPercentile),
        maxCostUsd: Math.max(...costsUsd),
        latestObservedAt,
      };
    })
    .sort(
      (left, right) =>
        left.strategyId.localeCompare(right.strategyId) ||
        left.chain.localeCompare(right.chain) ||
        left.intentType.localeCompare(right.intentType),
    );

  return {
    schemaVersion: 1,
    generatedAt: now,
    lookbackDays,
    sampleThreshold: finiteNumber(policy.minSamples) ?? EXECUTION_EV_COST_POLICY.minSamples,
    costPercentile: finiteNumber(policy.costPercentile) ?? EXECUTION_EV_COST_POLICY.costPercentile,
    costMultiplier: finiteNumber(policy.costMultiplier) ?? EXECUTION_EV_COST_POLICY.costMultiplier,
    minProfitFloorUsd: finiteNumber(policy.minProfitFloorUsd) ?? EXECUTION_EV_COST_POLICY.minProfitFloorUsd,
    fallbackP99CostUsdByChain: {
      ...EXECUTION_EV_COST_POLICY.p99CostUsdByChain,
      ...(policy.p99CostUsdByChain || {}),
    },
    summary: {
      receiptRecordCount: receiptRecords.length,
      consideredReceiptCount,
      matchedReceiptCount,
      skippedReceiptCount,
      keyedEntryCount: entries.length,
    },
    entries,
  };
}

function isSafetyCriticalIntent(intent = {}) {
  return (
    intent.intentType === "emergency_unwind" ||
    intent.executionReason === "risk_unwind" ||
    (intent.intentType === "approve_exact" && String(intent.approval?.amount ?? "") === "0")
  );
}

function expectedNetUsdFromIntent(intent = {}) {
  const candidates = [
    intent.expectedNetUsd,
    intent.metadata?.expectedNetUsd,
    intent.systemEconomics?.effectiveSystemNetPnlUsd,
    intent.systemEconomics?.estimatedNetPnlUsd,
    intent.metadata?.systemEconomics?.effectiveSystemNetPnlUsd,
    intent.metadata?.systemEconomics?.estimatedNetPnlUsd,
    intent.estimatedNetPnlUsd,
    intent.metadata?.estimatedNetPnlUsd,
    intent.routeContext?.estimatedNetPnlUsd,
    intent.metadata?.routeContext?.estimatedNetPnlUsd,
    intent.quote?.estimatedNetPnlUsd,
    intent.quote?.routeContext?.estimatedNetPnlUsd,
  ];
  for (const candidate of candidates) {
    const parsed = finiteNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function resolveEvHistoryInput(receiptHistory, { now, policy } = {}) {
  if (receiptHistory?.entries && Array.isArray(receiptHistory.entries)) {
    return receiptHistory;
  }
  if (Array.isArray(receiptHistory)) {
    return buildEvCostModel({ receiptRecords: receiptHistory, now, policy });
  }
  return buildEvCostModel({
    receiptRecords: receiptHistory?.receiptRecords || [],
    auditRecords: receiptHistory?.auditRecords || [],
    now,
    policy,
  });
}

export function evGate(intent = {}, receiptHistory = null, { now = intent.observedAt || new Date().toISOString(), policy = EXECUTION_EV_COST_POLICY } = {}) {
  const strategyId = normalizeString(intent.strategyId);
  const chain = normalizeChain(intent.chain);
  const intentType = normalizeString(intent.intentType);
  const expectedNetUsd = expectedNetUsdFromIntent(intent);

  if (isSafetyCriticalIntent(intent)) {
    return {
      allow: true,
      blockers: [],
      evidence: {
        strategyId,
        chain,
        intentType,
        bypassReason: "safety_critical_intent",
      },
    };
  }

  if (expectedNetUsd === null) {
    return {
      allow: true,
      blockers: [],
      evidence: {
        strategyId,
        chain,
        intentType,
        bypassReason: "expected_net_unmeasured",
      },
    };
  }

  const model = resolveEvHistoryInput(receiptHistory, { now, policy });
  const key = evCostKey({ strategyId, chain, intentType });
  const entry = model.entries.find((item) => item.key === key) || null;
  const sampleThreshold = finiteNumber(policy.minSamples) ?? EXECUTION_EV_COST_POLICY.minSamples;
  const fallbackP99CostUsd = executionEvFallbackCostUsd({ chain, policy });
  const hasSufficientHistory = Number.isFinite(entry?.sampleCount) && entry.sampleCount >= sampleThreshold;
  const tinyCanaryFallbackUsd = intentType === "tiny_live_canary"
    ? tinyCanarySameChainRoundTripCostUsd({
        chain,
        estimatedGasCostUsd: intent.estimatedGasCostUsd,
      })
    : null;
  const p90CostUsd = hasSufficientHistory ? entry.p90CostUsd : tinyCanaryFallbackUsd ?? fallbackP99CostUsd;
  const costMultiplier = finiteNumber(policy.costMultiplier) ?? EXECUTION_EV_COST_POLICY.costMultiplier;
  const minProfitFloorUsd = finiteNumber(policy.minProfitFloorUsd) ?? EXECUTION_EV_COST_POLICY.minProfitFloorUsd;
  const requiredNetUsd = p90CostUsd * costMultiplier + minProfitFloorUsd;
  const allow = expectedNetUsd > requiredNetUsd;

  return {
    allow,
    blockers: allow ? [] : ["expected_net_below_receipt_cost_p90_floor"],
    evidence: {
      strategyId,
      chain,
      intentType,
      expectedNetUsd,
      requiredNetUsd,
      p90CostUsd,
      sampleCount: entry?.sampleCount ?? 0,
      sampleThreshold,
      costMultiplier,
      minProfitFloorUsd,
      fallbackP99CostUsd,
      costSource: hasSufficientHistory ? "history_p90" : tinyCanaryFallbackUsd !== null ? "tiny_canary_shared_p90" : "fallback_chain_p99",
      modelGeneratedAt: model.generatedAt || null,
      lookbackDays: model.lookbackDays ?? null,
    },
  };
}

export function evaluateEvGate({
  intent = {},
  receiptHistory = null,
  now = new Date().toISOString(),
  policy = EXECUTION_EV_COST_POLICY,
} = {}) {
  const verdict = evGate(intent, receiptHistory, { now, policy });
  return {
    policy: "ev_gate",
    observedAt: now,
    decision: verdict.allow ? "ALLOW" : "BLOCK",
    blockers: verdict.blockers,
    evidence: verdict.evidence,
  };
}
