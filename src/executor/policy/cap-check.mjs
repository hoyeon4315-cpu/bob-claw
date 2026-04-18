import { assertStrategyCaps } from "../../config/strategy-caps.mjs";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function legacyCapAmountUsd({ strategyId, intentId, intentType, executionReason, amountUsd }) {
  if (strategyId === "wrapped-btc-loop-base-moonwell") {
    if (executionReason === "risk_unwind" || String(intentId || "").includes(":unwind:")) return 0;
    if (String(intentId || "").includes(":entry:mint-initial-collateral")) {
      return Number(amountUsd ?? 0);
    }
    return 0;
  }
  if (strategyId === "native-dex-experiment") {
    if (intentType === "wrap_native" || intentType === "approve_exact") return 0;
    return null;
  }
  if (strategyId === "token-dex-experiment") {
    if (intentType === "approve_exact") return 0;
    return null;
  }
  return null;
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function hoursAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 3_600_000;
}

function successfulBroadcast(record = {}) {
  return ["approved", "signed", "broadcasted", "confirmed"].includes(record.policyVerdict) || ["broadcasted", "signed", "confirmed"].includes(record.lifecycle?.stage);
}

function stageRank(record = {}) {
  const stage = record.lifecycle?.stage || null;
  if (stage === "reverted") return 5;
  if (stage === "confirmed") return 4;
  if (stage === "broadcasted") return 3;
  if (stage === "signed") return 2;
  if (record.policyVerdict === "approved") return 1;
  return 0;
}

function recordKey(record = {}) {
  return record.intentId || record.intentHash || `${record.strategyId || "unknown"}:${record.chain || "unknown"}:${record.timestamp || record.observedAt || "unknown"}`;
}

function dedupeRecords(records = []) {
  const bestByKey = new Map();
  for (const record of records) {
    const key = recordKey(record);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, record);
      continue;
    }
    const rank = stageRank(record);
    const existingRank = stageRank(existing);
    const recordTime = new Date(record.timestamp || record.observedAt || 0).getTime();
    const existingTime = new Date(existing.timestamp || existing.observedAt || 0).getTime();
    if (rank > existingRank || (rank === existingRank && recordTime >= existingTime)) {
      bestByKey.set(key, record);
    }
  }
  return [...bestByKey.values()];
}

function recordAmountUsd(record = {}) {
  const metadataOverride = record.intent?.metadata?.capCheckAmountUsd;
  if (isFiniteNumber(Number(metadataOverride))) return Number(metadataOverride);
  const legacyOverride = legacyCapAmountUsd({
    strategyId: record.strategyId ?? record.intent?.strategyId,
    intentId: record.intentId ?? record.intent?.intentId,
    intentType: record.intent?.intentType,
    executionReason: record.intent?.executionReason,
    amountUsd: record.amountUsd ?? record.intent?.amountUsd,
  });
  if (legacyOverride !== null && legacyOverride !== undefined && isFiniteNumber(Number(legacyOverride))) return Number(legacyOverride);
  return Number(record.amountUsd ?? record.intent?.amountUsd ?? 0);
}

function intentCapAmountUsd(intent = {}) {
  const metadataOverride = intent.metadata?.capCheckAmountUsd;
  if (isFiniteNumber(Number(metadataOverride))) return Number(metadataOverride);
  const legacyOverride = legacyCapAmountUsd({
    strategyId: intent.strategyId,
    intentId: intent.intentId,
    intentType: intent.intentType,
    executionReason: intent.executionReason,
    amountUsd: intent.amountUsd,
  });
  if (legacyOverride !== null && legacyOverride !== undefined && isFiniteNumber(Number(legacyOverride))) return Number(legacyOverride);
  return Number(intent.amountUsd ?? 0);
}

export function buildStrategyCapState({
  strategyId,
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const currentDay = dayKey(now);
  const relevant = auditRecords.filter((item) => item.strategyId === strategyId);
  const today = relevant.filter((item) => dayKey(item.timestamp || item.observedAt || now) === currentDay);
  const executedToday = dedupeRecords(today).filter(successfulBroadcast);
  const dailyVolumeUsd = executedToday
    .map(recordAmountUsd)
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  const perChainVolumeUsd = executedToday.reduce((accumulator, item) => {
    const chain = item.chain || item.intent?.chain || "unknown";
    const amountUsd = recordAmountUsd(item);
    accumulator[chain] = (accumulator[chain] || 0) + (isFiniteNumber(amountUsd) ? amountUsd : 0);
    return accumulator;
  }, {});
  const dailyRealizedPnlUsd = today
    .map((item) => item.realized?.realizedNetPnlUsd)
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  const failedGasCost24hUsd = relevant
    .filter((item) => hoursAgo(item.timestamp || item.observedAt || now, now) <= 24)
    .map((item) => item.realized?.actualKnownCostUsd)
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);

  return {
    strategyId,
    observedAt: now,
    dailyVolumeUsd,
    perChainVolumeUsd,
    dailyRealizedPnlUsd,
    failedGasCost24hUsd,
    attemptedCount24h: relevant.filter((item) => hoursAgo(item.timestamp || item.observedAt || now, now) <= 24).length,
  };
}

export function evaluateCapCheck({
  intent,
  strategyCaps = assertStrategyCaps(intent.strategyId),
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const state = buildStrategyCapState({
    strategyId: intent.strategyId,
    auditRecords,
    now,
  });
  const caps = strategyCaps.caps || {};
  const chainCapUsd = caps.perChainUsd?.[intent.chain] ?? null;
  const amountUsd = Number(intent.amountUsd ?? 0);
  const capAmountUsd = intentCapAmountUsd(intent);
  const isEmergencyIntent = intent.intentType === "emergency_unwind" || intent.executionReason === "risk_unwind";

  if (intent.mode !== "dry_run" && strategyCaps.autoExecute !== true) {
    blockers.push("strategy_auto_execute_disabled");
  }
  if (!isEmergencyIntent && !isFiniteNumber(caps.perTxUsd)) {
    blockers.push("strategy_per_tx_cap_missing");
  }
  if (!isEmergencyIntent && !isFiniteNumber(caps.perDayUsd)) {
    blockers.push("strategy_per_day_cap_missing");
  }
  if (!isEmergencyIntent && !isFiniteNumber(caps.maxDailyLossUsd)) {
    blockers.push("strategy_max_daily_loss_missing");
  }
  if (!isEmergencyIntent && !isFiniteNumber(chainCapUsd)) {
    blockers.push("strategy_per_chain_cap_missing");
  }
  if (!isEmergencyIntent && isFiniteNumber(caps.perTxUsd) && isFiniteNumber(capAmountUsd) && capAmountUsd > caps.perTxUsd) {
    blockers.push("strategy_per_tx_cap_exceeded");
  }
  if (!isEmergencyIntent && isFiniteNumber(caps.perDayUsd) && isFiniteNumber(capAmountUsd) && state.dailyVolumeUsd + capAmountUsd > caps.perDayUsd) {
    blockers.push("strategy_per_day_cap_exceeded");
  }
  if (
    !isEmergencyIntent &&
    isFiniteNumber(chainCapUsd) &&
    isFiniteNumber(capAmountUsd) &&
    (state.perChainVolumeUsd[intent.chain] || 0) + capAmountUsd > chainCapUsd
  ) {
    blockers.push("strategy_per_chain_cap_exceeded");
  }
  if (isFiniteNumber(caps.maxDailyLossUsd) && state.dailyRealizedPnlUsd <= -caps.maxDailyLossUsd) {
    blockers.push("strategy_max_daily_loss_breached");
  }
  if (isFiniteNumber(caps.maxFailedGasCost24hUsd) && state.failedGasCost24hUsd >= caps.maxFailedGasCost24hUsd) {
    blockers.push("strategy_failed_gas_budget_breached");
  }

  return {
    policy: "cap_check",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    state,
    metrics: {
      amountUsd: isFiniteNumber(amountUsd) ? amountUsd : null,
      capAmountUsd: isFiniteNumber(capAmountUsd) ? capAmountUsd : null,
      perTxUsd: caps.perTxUsd ?? null,
      perDayUsd: caps.perDayUsd ?? null,
      perChainUsd: chainCapUsd,
      maxDailyLossUsd: caps.maxDailyLossUsd ?? null,
      maxFailedGasCost24hUsd: caps.maxFailedGasCost24hUsd ?? null,
    },
  };
}
