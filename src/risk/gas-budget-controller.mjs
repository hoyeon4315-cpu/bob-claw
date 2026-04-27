function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function hoursAgoMs(now, timestamp) {
  return new Date(now).getTime() - new Date(timestamp).getTime();
}

function routeKey(intent = {}) {
  return `${intent.strategyId || "unknown"}:${intent.chain || "unknown"}:${intent.intentType || "unknown"}`;
}

function failedBroadcast(record = {}) {
  const stage = record.lifecycle?.stage || null;
  return stage === "reverted" || stage === "error";
}

function broadcastResult(record = {}) {
  const stage = record.lifecycle?.stage || null;
  if (stage === "reverted" || stage === "error") return "failure";
  if (stage === "confirmed" || stage === "broadcasted") return "success";
  return null;
}

export function evaluateGasBudgetController({
  intent = {},
  auditRecords = [],
  positionState = null,
  gasBaselines = {},
  maxFailedGasCost24hUsd = 3,
  minProfitableTopUpUsd = 5,
  idlePositionExitDays = 7,
  staleQuoteThresholdMs = 30_000,
  maxConsecutiveRevertsPerRoute = 3,
  now = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const rKey = routeKey(intent);
  const currentChain = intent.chain || "unknown";

  const quoteObservedAt = intent.quote?.observedAt || intent.observedAt || null;
  if (quoteObservedAt) {
    const quoteAgeMs = hoursAgoMs(now, quoteObservedAt);
    if (isFiniteNumber(quoteAgeMs) && quoteAgeMs > staleQuoteThresholdMs) {
      blockers.push("stale_quote_exceeded_30s");
    }
  }

  const last24hMs = 24 * 60 * 60 * 1000;
  const recentRecords = auditRecords.filter(
    (r) => hoursAgoMs(now, r.timestamp || r.observedAt || now) <= last24hMs,
  );

  const routeFailedGas = recentRecords
    .filter((r) => failedBroadcast(r) && routeKey(r.intent || r) === rKey)
    .map((r) => Number(r.realized?.actualKnownCostUsd ?? r.execution?.actualKnownCostUsd ?? 0))
    .filter(isFiniteNumber)
    .reduce((sum, v) => sum + v, 0);

  if (
    isFiniteNumber(maxFailedGasCost24hUsd) &&
    routeFailedGas >= maxFailedGasCost24hUsd
  ) {
    blockers.push("route_failed_gas_budget_24h_exceeded");
  }

  const routeBroadcasts = recentRecords
    .filter((r) => routeKey(r.intent || r) === rKey)
    .sort((a, b) => hoursAgoMs(a.timestamp || a.observedAt || now, now) - hoursAgoMs(b.timestamp || b.observedAt || now, now));

  let consecutiveReverts = 0;
  for (let i = routeBroadcasts.length - 1; i >= 0; i--) {
    const result = broadcastResult(routeBroadcasts[i]);
    if (result === "failure") {
      consecutiveReverts += 1;
    } else if (result === "success") {
      break;
    }
  }

  if (consecutiveReverts >= maxConsecutiveRevertsPerRoute) {
    blockers.push("route_consecutive_reverts_auto_pause");
  }

  if (positionState) {
    const positionGas = isFiniteNumber(positionState.cumulativeGasUsd)
      ? positionState.cumulativeGasUsd
      : 0;
    const positionReward = isFiniteNumber(positionState.realizedRewardUsd)
      ? positionState.realizedRewardUsd
      : 0;

    if (positionReward > 0) {
      const gasRewardRatio = positionGas / positionReward;
      if (gasRewardRatio >= 0.25) {
        blockers.push("gas_burn_exit_ratio_exceeded");
      }
    }

    const idleDays = isFiniteNumber(positionState.daysIdle)
      ? positionState.daysIdle
      : null;
    if (
      idleDays != null &&
      idleDays >= idlePositionExitDays &&
      isFiniteNumber(positionState.positionUsd) &&
      positionState.positionUsd < minProfitableTopUpUsd
    ) {
      blockers.push("idle_position_below_min_profitable_exit");
    }
  }

  const baseline = gasBaselines[currentChain];
  const currentGasPrice = intent.gasPriceGwei ?? intent.metadata?.gasPriceGwei ?? null;
  if (
    baseline?.p90_30d != null &&
    isFiniteNumber(currentGasPrice) &&
    currentGasPrice > baseline.p90_30d &&
    intent.intentType !== "emergency_unwind"
  ) {
    blockers.push("gas_price_above_p90_30d");
  }

  return {
    allowed: blockers.length === 0,
    reason: blockers.length > 0 ? blockers.join(";") : null,
    blockers,
    metrics: {
      routeKey: rKey,
      routeFailedGasUsd24h: routeFailedGas,
      consecutiveRevertsOnRoute: consecutiveReverts,
      quoteAgeMs: quoteObservedAt
        ? hoursAgoMs(now, quoteObservedAt)
        : null,
    },
  };
}
