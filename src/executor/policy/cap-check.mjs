import { assertStrategyCaps } from "../../config/strategy-caps.mjs";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function hoursAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 3_600_000;
}

function successfulBroadcast(record = {}) {
  return record.policyVerdict === "approved" || record.lifecycle?.stage === "broadcasted" || record.lifecycle?.stage === "signed";
}

function recordAmountUsd(record = {}) {
  return Number(record.amountUsd ?? record.intent?.amountUsd ?? 0);
}

export function buildStrategyCapState({
  strategyId,
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const currentDay = dayKey(now);
  const relevant = auditRecords.filter((item) => item.strategyId === strategyId);
  const today = relevant.filter((item) => dayKey(item.timestamp || item.observedAt || now) === currentDay);
  const executedToday = today.filter(successfulBroadcast);
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
  if (!isEmergencyIntent && isFiniteNumber(caps.perTxUsd) && isFiniteNumber(amountUsd) && amountUsd > caps.perTxUsd) {
    blockers.push("strategy_per_tx_cap_exceeded");
  }
  if (!isEmergencyIntent && isFiniteNumber(caps.perDayUsd) && isFiniteNumber(amountUsd) && state.dailyVolumeUsd + amountUsd > caps.perDayUsd) {
    blockers.push("strategy_per_day_cap_exceeded");
  }
  if (
    !isEmergencyIntent &&
    isFiniteNumber(chainCapUsd) &&
    isFiniteNumber(amountUsd) &&
    (state.perChainVolumeUsd[intent.chain] || 0) + amountUsd > chainCapUsd
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
      perTxUsd: caps.perTxUsd ?? null,
      perDayUsd: caps.perDayUsd ?? null,
      perChainUsd: chainCapUsd,
      maxDailyLossUsd: caps.maxDailyLossUsd ?? null,
      maxFailedGasCost24hUsd: caps.maxFailedGasCost24hUsd ?? null,
    },
  };
}
