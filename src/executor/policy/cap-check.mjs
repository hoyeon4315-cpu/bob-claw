import { DISCRETIONARY_BUDGET } from "../../config/discretionary-budget.mjs";
import { PORTFOLIO_EXPOSURE_POLICY } from "../../config/portfolio-exposure-policy.mjs";
import { assertStrategyCaps, getStrategyCaps } from "../../config/strategy-caps.mjs";
import { resolveQuoteMaxAgeMs } from "./stale-quote.mjs";

const FALLBACK_DISCRETIONARY_24H_BUDGET_USD_BY_CATEGORY = Object.freeze({
  probe: 3.0,
  refuel: 5.0,
  bridge: 10.0,
  consolidation: 5.0,
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function legacyCapAmountUsd({ strategyId, intentId, intentType, executionReason, amountUsd }) {
  if (strategyId === "wrapped-btc-loop-base-moonwell") {
    if (executionReason === "risk_unwind" || String(intentId || "").includes(":unwind:")) return 0;
    if (intentType === "tiny_live_canary") return Number(amountUsd ?? 0);
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
  if (record.strategyId === "prelive_fork_execution" && record.lifecycle?.stage === "signed" && !record.broadcast) {
    return false;
  }
  if (record.lifecycle?.stage === "signed" && !record.broadcast) return false;
  return ["approved", "signed", "broadcasted", "confirmed"].includes(record.policyVerdict) || ["broadcasted", "confirmed"].includes(record.lifecycle?.stage);
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

function firstFiniteNumber(candidates = []) {
  for (const value of candidates) {
    const parsed = Number(value);
    if (isFiniteNumber(parsed)) return parsed;
  }
  return null;
}

function recordDiscretionarySpendUsd(record = {}, category = null) {
  const normalizedCategory = normalizeDiscretionaryCategory(category);
  return firstFiniteNumber([
    record.discretionaryBudgetUsd,
    record.metadata?.discretionaryBudgetUsd,
    record.intent?.discretionaryBudgetUsd,
    record.intent?.metadata?.discretionaryBudgetUsd,
    record.realized?.actualKnownCostUsd,
    record.execution?.actualKnownCostUsd,
    record.quote?.feeUsd,
    record.quote?.totalFeeUsd,
    record.quote?.fees?.totalUsd,
    record.movementBudget?.bridgeQuoteCostUsd,
    record.fundingSource?.expectedExecutionRefillCostUsd,
    normalizedCategory === "refuel" ? record.amountUsd : null,
    normalizedCategory === "refuel" ? record.intent?.amountUsd : null,
  ]) ?? 0;
}

function intentDiscretionarySpendUsd(intent = {}, category = null) {
  const normalizedCategory = normalizeDiscretionaryCategory(category);
  return firstFiniteNumber([
    intent.discretionaryBudgetUsd,
    intent.metadata?.discretionaryBudgetUsd,
    intent.realized?.actualKnownCostUsd,
    intent.quote?.feeUsd,
    intent.quote?.totalFeeUsd,
    intent.quote?.fees?.totalUsd,
    intent.movementBudget?.bridgeQuoteCostUsd,
    intent.fundingSource?.expectedExecutionRefillCostUsd,
    normalizedCategory === "refuel" ? intent.amountUsd : null,
  ]) ?? 0;
}

function protocolTagsForStrategy(strategyId) {
  return [...new Set(getStrategyCaps(strategyId)?.exposure?.protocols || [])];
}

function assetFamilyForStrategy(strategyId) {
  return getStrategyCaps(strategyId)?.exposure?.assetFamily || null;
}

function btcDenominatedForStrategy(strategyId) {
  return getStrategyCaps(strategyId)?.exposure?.btcDenominated === true;
}

function finiteBudget(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDiscretionaryCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();
  return normalized || null;
}

function resolveDiscretionaryBudgetCaps() {
  const configuredCaps = DISCRETIONARY_BUDGET?.last24hBudgetUsdByCategory;
  if (!configuredCaps || typeof configuredCaps !== "object") {
    return FALLBACK_DISCRETIONARY_24H_BUDGET_USD_BY_CATEGORY;
  }
  const normalizedCaps = Object.entries(configuredCaps).reduce((accumulator, [category, budgetUsd]) => {
    const normalizedCategory = normalizeDiscretionaryCategory(category);
    const normalizedBudgetUsd = finiteBudget(budgetUsd);
    if (!normalizedCategory || !Number.isFinite(normalizedBudgetUsd)) return accumulator;
    accumulator[normalizedCategory] = normalizedBudgetUsd;
    return accumulator;
  }, {});
  return Object.keys(normalizedCaps).length > 0 ? normalizedCaps : FALLBACK_DISCRETIONARY_24H_BUDGET_USD_BY_CATEGORY;
}

function discretionarySliceCategory(entry = {}) {
  return normalizeDiscretionaryCategory(
    entry.discretionaryBudgetCategory ??
      entry.category ??
      entry.metadata?.discretionaryBudgetCategory ??
      entry.intent?.discretionaryBudgetCategory ??
      entry.intent?.category ??
      entry.intent?.metadata?.discretionaryBudgetCategory,
  );
}

function isStrategyRealizedPnlIntent(intent = {}) {
  return (
    intent.classification === "strategy_realized_pnl" ||
    intent.metadata?.classification === "strategy_realized_pnl" ||
    intent.kind === "strategy_realized_pnl"
  );
}

function isFreshAutoExecuteIntent(intent = {}) {
  const strategyCaps = intent.strategyId ? getStrategyCaps(intent.strategyId) : null;
  if (strategyCaps?.autoExecute !== true) return false;
  const quoteObservedAt = intent.quote?.observedAt || intent.observedAt || null;
  if (!quoteObservedAt) return true;
  const now = intent.now || intent.evaluatedAt || intent.createdAt || new Date().toISOString();
  const quoteAgeMs = new Date(now).getTime() - new Date(quoteObservedAt).getTime();
  const maxAgeMs = resolveQuoteMaxAgeMs({ intent, maxAgeMs: strategyCaps.intentTtlMs ?? undefined });
  return isFiniteNumber(quoteAgeMs) && quoteAgeMs >= 0 && quoteAgeMs <= maxAgeMs;
}

function resolvePortfolioExposurePolicy({
  activeBudgetUsd = null,
  policy = {},
} = {}) {
  const normalizedPolicy = policy || PORTFOLIO_EXPOSURE_POLICY;
  const budgetUsd = finiteBudget(activeBudgetUsd);
  if (!Number.isFinite(budgetUsd)) return null;
  return {
    activeBudgetUsd: budgetUsd,
    profileId: normalizedPolicy.profileId || null,
    maxProtocolSharePct: Number.isFinite(normalizedPolicy.maxProtocolSharePct) ? Number(normalizedPolicy.maxProtocolSharePct) : PORTFOLIO_EXPOSURE_POLICY.maxProtocolSharePct,
    maxDefaultChainSharePct: Number.isFinite(normalizedPolicy.maxDefaultChainSharePct) ? Number(normalizedPolicy.maxDefaultChainSharePct) : PORTFOLIO_EXPOSURE_POLICY.maxDefaultChainSharePct,
    chainSharePct:
      normalizedPolicy.chainSharePct && typeof normalizedPolicy.chainSharePct === "object"
        ? normalizedPolicy.chainSharePct
        : PORTFOLIO_EXPOSURE_POLICY.chainSharePct,
    minBtcDenominatedSharePct:
      Number.isFinite(normalizedPolicy.minBtcDenominatedSharePct)
        ? Number(normalizedPolicy.minBtcDenominatedSharePct)
        : PORTFOLIO_EXPOSURE_POLICY.minBtcDenominatedSharePct,
  };
}

export function buildPortfolioExposureState({
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const currentDay = dayKey(now);
  const today = dedupeRecords(auditRecords.filter((item) => dayKey(item.timestamp || item.observedAt || now) === currentDay)).filter(successfulBroadcast);
  const protocolVolumeUsd = {};
  const chainVolumeUsd = {};
  const assetFamilyVolumeUsd = {};
  let btcDenominatedVolumeUsd = 0;
  let nonBtcDenominatedVolumeUsd = 0;

  for (const item of today) {
    const strategyId = item.strategyId ?? item.intent?.strategyId;
    const amountUsd = recordAmountUsd(item);
    if (!isFiniteNumber(amountUsd)) continue;
    const chain = item.chain || item.intent?.chain || "unknown";
    chainVolumeUsd[chain] = (chainVolumeUsd[chain] || 0) + amountUsd;
    const assetFamily = assetFamilyForStrategy(strategyId);
    if (assetFamily) {
      assetFamilyVolumeUsd[assetFamily] = (assetFamilyVolumeUsd[assetFamily] || 0) + amountUsd;
    }
    const protocolTags = protocolTagsForStrategy(strategyId);
    for (const protocol of protocolTags) {
      protocolVolumeUsd[protocol] = (protocolVolumeUsd[protocol] || 0) + amountUsd;
    }
    if (btcDenominatedForStrategy(strategyId)) {
      btcDenominatedVolumeUsd += amountUsd;
    } else {
      nonBtcDenominatedVolumeUsd += amountUsd;
    }
  }

  return {
    observedAt: now,
    protocolVolumeUsd,
    chainVolumeUsd,
    assetFamilyVolumeUsd,
    btcDenominatedVolumeUsd,
    nonBtcDenominatedVolumeUsd,
  };
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

export function evaluateDiscretionaryBudget(category, intent = {}, last24hSlice = []) {
  if (isStrategyRealizedPnlIntent(intent) || isFreshAutoExecuteIntent(intent)) {
    return {
      allowed: true,
      blockers: [],
      runningTotalUsd: 0,
    };
  }

  const normalizedCategory = normalizeDiscretionaryCategory(category);
  const max24hBudgetUsd = resolveDiscretionaryBudgetCaps()[normalizedCategory];
  if (!normalizedCategory || !Number.isFinite(max24hBudgetUsd)) {
    return {
      allowed: false,
      blockers: ["discretionary_budget_category_unknown"],
      runningTotalUsd: 0,
    };
  }

  const historicalTotalUsd = last24hSlice
    .filter((entry) => discretionarySliceCategory(entry) === normalizedCategory)
    .map((entry) => recordDiscretionarySpendUsd(entry, normalizedCategory))
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  const currentAmountUsd = intentDiscretionarySpendUsd(intent, normalizedCategory);
  const runningTotalUsd = historicalTotalUsd + (isFiniteNumber(currentAmountUsd) ? currentAmountUsd : 0);
  const blockers = runningTotalUsd > max24hBudgetUsd ? ["discretionary_budget_24h_category_exhausted"] : [];

  return {
    allowed: blockers.length === 0,
    blockers,
    runningTotalUsd,
  };
}

export function evaluateCapCheck({
  intent,
  strategyCaps = assertStrategyCaps(intent.strategyId),
  auditRecords = [],
  activeBudgetUsd = null,
  portfolioExposurePolicy = null,
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
  const isTinyLiveCanary =
    intent.intentType === "tiny_live_canary" ||
    intent.executionReason === "merkl_canary_autopilot" ||
    intent.executionReason === "radar_tiny_live_canary" ||
    intent.metadata?.tinyLiveCanary === true;
  const perTxCapUsd = isTinyLiveCanary ? caps.tinyLivePerTxUsd : caps.perTxUsd;
  const portfolioPolicy = resolvePortfolioExposurePolicy({
    activeBudgetUsd,
    policy: portfolioExposurePolicy,
  });
  const portfolioState = buildPortfolioExposureState({
    auditRecords,
    now,
  });

  if (!isEmergencyIntent && intent.mode !== "dry_run" && strategyCaps.autoExecute !== true) {
    blockers.push("strategy_auto_execute_disabled");
  }
  if (!isEmergencyIntent && !isFiniteNumber(perTxCapUsd)) {
    blockers.push(isTinyLiveCanary ? "strategy_tiny_live_cap_missing" : "strategy_per_tx_cap_missing");
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
  if (!isEmergencyIntent && isFiniteNumber(perTxCapUsd) && isFiniteNumber(capAmountUsd) && capAmountUsd > perTxCapUsd) {
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
  if (!isEmergencyIntent && portfolioPolicy && isFiniteNumber(capAmountUsd)) {
    const chainSharePct = Number(
      portfolioPolicy.chainSharePct?.[intent.chain] ?? portfolioPolicy.maxDefaultChainSharePct,
    );
    const chainCapBudgetUsd = Number.isFinite(chainSharePct) ? portfolioPolicy.activeBudgetUsd * chainSharePct : null;
    if (
      Number.isFinite(chainCapBudgetUsd) &&
      (portfolioState.chainVolumeUsd[intent.chain] || 0) + capAmountUsd > chainCapBudgetUsd
    ) {
      blockers.push("portfolio_chain_cap_exceeded");
    }
    const protocols = protocolTagsForStrategy(intent.strategyId);
    const protocolCapBudgetUsd = Number.isFinite(portfolioPolicy.maxProtocolSharePct)
      ? portfolioPolicy.activeBudgetUsd * portfolioPolicy.maxProtocolSharePct
      : null;
    if (
      Number.isFinite(protocolCapBudgetUsd) &&
      protocols.some((protocol) => (portfolioState.protocolVolumeUsd[protocol] || 0) + capAmountUsd > protocolCapBudgetUsd)
    ) {
      blockers.push("portfolio_protocol_cap_exceeded");
    }
    const isBtcDenominated = btcDenominatedForStrategy(intent.strategyId);
    const maxNonBtcBudgetUsd =
      Number.isFinite(portfolioPolicy.minBtcDenominatedSharePct)
        ? portfolioPolicy.activeBudgetUsd * (1 - portfolioPolicy.minBtcDenominatedSharePct)
        : null;
    if (
      !isBtcDenominated &&
      Number.isFinite(maxNonBtcBudgetUsd) &&
      portfolioState.nonBtcDenominatedVolumeUsd + capAmountUsd > maxNonBtcBudgetUsd
    ) {
      blockers.push("portfolio_btc_denomination_floor_breached");
    }
  }

  return {
    policy: "cap_check",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    state,
    portfolioState,
    metrics: {
      amountUsd: isFiniteNumber(amountUsd) ? amountUsd : null,
      capAmountUsd: isFiniteNumber(capAmountUsd) ? capAmountUsd : null,
      perTxUsd: caps.perTxUsd ?? null,
      perDayUsd: caps.perDayUsd ?? null,
      tinyLivePerTxUsd: caps.tinyLivePerTxUsd ?? null,
      perChainUsd: chainCapUsd,
      maxDailyLossUsd: caps.maxDailyLossUsd ?? null,
      maxFailedGasCost24hUsd: caps.maxFailedGasCost24hUsd ?? null,
      portfolioActiveBudgetUsd: portfolioPolicy?.activeBudgetUsd ?? null,
      portfolioProtocolCapUsd:
        portfolioPolicy && Number.isFinite(portfolioPolicy.maxProtocolSharePct)
          ? portfolioPolicy.activeBudgetUsd * portfolioPolicy.maxProtocolSharePct
          : null,
      portfolioChainCapUsd:
        portfolioPolicy && Number.isFinite(Number(portfolioPolicy.chainSharePct?.[intent.chain] ?? portfolioPolicy.maxDefaultChainSharePct))
          ? portfolioPolicy.activeBudgetUsd *
            Number(portfolioPolicy.chainSharePct?.[intent.chain] ?? portfolioPolicy.maxDefaultChainSharePct)
          : null,
      portfolioMaxNonBtcUsd:
        portfolioPolicy && Number.isFinite(portfolioPolicy.minBtcDenominatedSharePct)
          ? portfolioPolicy.activeBudgetUsd * (1 - portfolioPolicy.minBtcDenominatedSharePct)
          : null,
    },
  };
}
