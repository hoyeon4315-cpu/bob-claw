import { createHash } from "node:crypto";
import { BLOCKER_CODES, isHardSafetyStop, normalizeBlocker, paramsHash as blockerParamsHash } from "../executor/policy/blocker-codes.mjs";
import { BLOCKER_RESOLUTION_CONFIG, buildBlockerResolutionConfig } from "../config/blocker-resolution.mjs";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sha16(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function paramsKeyFor(code, params) {
  return sha16(`${code}:${blockerParamsHash(params || {})}`);
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function firstBlockerForStrategy(row = {}) {
  if (Array.isArray(row.lastTickBlockers) && row.lastTickBlockers.length) return row.lastTickBlockers[0];
  if (row.topDenyReason) return row.topDenyReason;
  if (row.topBlocker) return row.topBlocker;
  if (row.layerStatus?.runtimeBlocker) return row.layerStatus.runtimeBlocker;
  return null;
}

function previousByStrategy(previousSlice = null) {
  return new Map((previousSlice?.strategies || []).map((row) => [row.strategyId, row]));
}

function resolverStateFor(resolverState = {}, key) {
  return resolverState?.byParamsKey?.[key] || resolverState?.[key] || {};
}

function isResolverActionable(code) {
  const category = BLOCKER_CODES[code]?.category;
  return category === "proof_acquisition" || category === "refill_or_inventory";
}

function requiresStrategyOrCapitalChange(code, requiresExternalDeposit = false) {
  const category = BLOCKER_CODES[code]?.category;
  return requiresExternalDeposit === true || category === "economic_no_go" || category === "executor_unbound" || category === "code_required";
}

function fallbackFireCountFromRows(rows = []) {
  const counts = {};
  for (const row of rows) {
    if (row.code === "manual_review:unknown_blocker_code" || row.code === "code_required:specific_recipe_required") {
      increment(counts, row.code);
    }
  }
  return counts;
}

export function buildPaybackLifecycleBlockers({
  payback = null,
  strategyTickStatus = null,
  now = new Date().toISOString(),
  config = {},
} = {}) {
  const resolved = buildBlockerResolutionConfig(config);
  const blockers = [];
  const nowMs = timestampMs(now) ?? Date.now();
  const lastIntent = payback?.scheduler?.lastIntent || payback?.lastIntent || payback?.latestIntent || null;
  const gatewayOrderId = lastIntent?.gatewayOrderId || lastIntent?.orderId || payback?.gatewayOrderId || null;
  const emittedAt = lastIntent?.emittedAt || lastIntent?.observedAt || lastIntent?.createdAt || null;
  const btcDeltaAt = payback?.lastBitcoinL1DeltaAt || payback?.lastPaybackSettledAt || payback?.lastSettlement?.bitcoinL1DeltaAt || null;
  if (gatewayOrderId && emittedAt) {
    const elapsedHours = (nowMs - (timestampMs(emittedAt) ?? nowMs)) / 3_600_000;
    if (elapsedHours >= resolved.paybackSettlementTimeoutHours && !btcDeltaAt) {
      blockers.push({
        code: "payback_lifecycle:payback_settlement_pending",
        params: {
          gatewayOrderId,
          emittedAt,
          elapsedHours: Math.round(elapsedHours * 100) / 100,
        },
        observedAt: now,
      });
    }
  }
  for (const row of strategyTickStatus?.strategies || []) {
    if (!row.firstLiveBroadcastAt) continue;
    const elapsedDays = (nowMs - (timestampMs(row.firstLiveBroadcastAt) ?? nowMs)) / 86_400_000;
    const realized = finiteNumber(row.firstRealizedPnlSats) ?? 0;
    if (elapsedDays >= resolved.profitAttributionGapDays && realized <= 0) {
      blockers.push({
        code: "payback_lifecycle:profit_attribution_gap",
        params: {
          strategyId: row.strategyId,
          firstLiveBroadcastAt: row.firstLiveBroadcastAt,
          realizedPnlSats: realized,
          elapsedDays: Math.round(elapsedDays * 100) / 100,
        },
        observedAt: now,
      });
    }
  }
  return blockers;
}

export function buildBlockerFunnelSlice({
  strategyTickStatus = null,
  resolverState = {},
  circuitBreakerState = {},
  pendingDispatches = [],
  payback = null,
  previousSlice = null,
  generatedAt = new Date().toISOString(),
  config = BLOCKER_RESOLUTION_CONFIG,
} = {}) {
  const resolvedConfig = buildBlockerResolutionConfig(config);
  const previous = previousByStrategy(previousSlice);
  const rows = [];
  const stageDropCounts = {};
  const codeFrequency = {};
  const rootCauses = new Map();
  const strategyRows = Array.isArray(strategyTickStatus?.strategies) ? strategyTickStatus.strategies : [];
  for (const row of strategyRows) {
    const raw = firstBlockerForStrategy(row);
    if (!raw) continue;
    const normalized = normalizeBlocker(raw, {
      strategyId: row.strategyId,
      chain: row.chain || row.scoredAllocation?.chain || null,
    });
    const code = normalized.code;
    const params = normalized.params;
    const paramsKey = paramsKeyFor(code, params);
    const state = resolverStateFor(resolverState, paramsKey);
    const prev = previous.get(row.strategyId);
    const consecutiveTicks =
      prev?.code === code
        ? (Number(prev.consecutiveTicks) || 0) + 1
        : 1;
    const requiresExternalDeposit =
      state.requiresExternalDeposit === true ||
      BLOCKER_CODES[code]?.requiresExternalDeposit === true;
    const item = {
      strategyId: row.strategyId,
      stage: BLOCKER_CODES[code]?.category || "manual_review",
      code,
      params,
      legacyCode: normalized.legacyText,
      observedAt: row.lastTickAt || generatedAt,
      paramsKey,
      consecutiveTicks,
      attemptCount: Number(state.attemptCount || 0),
      lastResolverAction: state.lastResolverAction || null,
      lastResolverOutcome: state.lastResolverOutcome || null,
      nextRetryAt: state.nextRetryAt || null,
      quarantineCandidate: consecutiveTicks >= resolvedConfig.quarantineTickThreshold,
      expectedDailyUsdOnResolve: finiteNumber(state.expectedDailyUsdOnResolve),
      requiresExternalDeposit,
    };
    rows.push(item);
    increment(stageDropCounts, item.stage);
    increment(codeFrequency, code);
    const group = rootCauses.get(paramsKey) || {
      paramsKey,
      code,
      params,
      affectedStrategies: [],
      expectedDailyUsdOnResolve: item.expectedDailyUsdOnResolve,
      lastAction: item.lastResolverAction,
    };
    group.affectedStrategies.push(row.strategyId);
    if (finiteNumber(item.expectedDailyUsdOnResolve) !== null) {
      group.expectedDailyUsdOnResolve = Math.max(
        finiteNumber(group.expectedDailyUsdOnResolve) ?? Number.NEGATIVE_INFINITY,
        item.expectedDailyUsdOnResolve,
      );
    }
    if (item.lastResolverAction) group.lastAction = item.lastResolverAction;
    rootCauses.set(paramsKey, group);
  }

  const lifecycleBlockers = buildPaybackLifecycleBlockers({
    payback,
    strategyTickStatus,
    now: generatedAt,
    config: resolvedConfig,
  });
  for (const lifecycle of lifecycleBlockers) {
    const code = lifecycle.code;
    const params = lifecycle.params || {};
    const paramsKey = paramsKeyFor(code, params);
    const item = {
      strategyId: params.strategyId || `payback:${params.gatewayOrderId || "lifecycle"}`,
      stage: BLOCKER_CODES[code]?.category || "payback_lifecycle",
      code,
      params,
      legacyCode: code,
      observedAt: lifecycle.observedAt || generatedAt,
      paramsKey,
      consecutiveTicks: 1,
      attemptCount: 0,
      lastResolverAction: null,
      lastResolverOutcome: null,
      nextRetryAt: null,
      quarantineCandidate: false,
      expectedDailyUsdOnResolve: null,
      requiresExternalDeposit: false,
    };
    rows.push(item);
    increment(stageDropCounts, item.stage);
    increment(codeFrequency, code);
    rootCauses.set(paramsKey, {
      paramsKey,
      code,
      params,
      affectedStrategies: [item.strategyId],
      expectedDailyUsdOnResolve: null,
      lastAction: null,
    });
  }

  const rootCauseGroups = [...rootCauses.values()].sort((left, right) => {
    const l = finiteNumber(left.expectedDailyUsdOnResolve);
    const r = finiteNumber(right.expectedDailyUsdOnResolve);
    if (l !== null || r !== null) return (r ?? Number.NEGATIVE_INFINITY) - (l ?? Number.NEGATIVE_INFINITY);
    return left.code.localeCompare(right.code);
  });
  const fallbackFireCount = fallbackFireCountFromRows(rows);
  return {
    schemaVersion: 1,
    generatedAt,
    strategies: rows,
    stageDropCounts,
    codeFrequency,
    rootCauseGroups,
    resolverActionableCount: rows.filter((row) => isResolverActionable(row.code) && !isHardSafetyStop(row.code)).length,
    requiresStrategyOrCapitalChangeCount: rows.filter((row) => requiresStrategyOrCapitalChange(row.code, row.requiresExternalDeposit)).length,
    fallbackFireCount,
    circuitBreakerState,
    pendingDispatchCount: pendingDispatches.length,
  };
}
