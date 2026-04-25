function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function observationKey(record) {
  return `${record.routeKey}|${record.amount}`;
}

function preferredObservedEdgeUsd(score) {
  return (
    score.treasuryAdjustedExecutableNetEdgeUsd ??
    score.treasuryAdjustedNetEdgeUsd ??
    score.executableNetEdgeUsd ??
    score.netEdgeUsd ??
    null
  );
}

function preferredObservedEdgePct(score) {
  return (
    score.treasuryAdjustedExecutableNetEdgePct ??
    score.treasuryAdjustedNetEdgePct ??
    score.executableNetEdgePct ??
    score.netEdgePct ??
    null
  );
}

export function buildShadowOpportunityObservation({ score, fundingSourcePlan = null, now, priceObservedAt = null, inventoryObservedAt = null }) {
  const observedEdgeUsd = finiteOrNull(preferredObservedEdgeUsd(score));
  const observedEdgePct = finiteOrNull(preferredObservedEdgePct(score));
  const rejectionReasons = [
    ...(score.dataGaps || []),
    ...(score.tradeReadiness && score.tradeReadiness !== "shadow_candidate_review_only" ? [score.tradeReadiness] : []),
    ...(Number.isFinite(score.treasuryExecutionRefillCostUsd) && Number.isFinite(observedEdgeUsd) && observedEdgeUsd <= 0
      ? ["reject_treasury_execution_refill_cost"]
      : []),
    ...(Number.isFinite(score.effectiveSystemNetPnlUsd) && score.effectiveSystemNetPnlUsd <= 0 ? ["reject_effective_system_pnl"] : []),
    ...((fundingSourcePlan?.reasons || []).map((reason) => `treasury_${reason}`)),
  ];

  return {
    schemaVersion: 1,
    observedAt: now || new Date().toISOString(),
    quoteObservedAt: score.observedAt,
    priceObservedAt,
    inventoryObservedAt,
    routeKey: score.routeKey,
    amount: score.amount,
    srcChain: score.srcChain,
    dstChain: score.dstChain,
    quoteType: score.quoteType,
    tradeable: false,
    tradeReadiness: score.tradeReadiness,
    rejectionReasons: [...new Set(rejectionReasons)],
    requiredEdgePct: finiteOrNull(score.treasuryAdjustedBreakEvenPct ?? score.breakEvenPct),
    observedEdgeUsd,
    observedEdgePct,
    referenceNetEdgeUsd: finiteOrNull(score.netEdgeUsd),
    referenceExecutableNetEdgeUsd: finiteOrNull(score.executableNetEdgeUsd),
    treasuryAdjustedNetEdgeUsd: finiteOrNull(score.treasuryAdjustedNetEdgeUsd),
    treasuryAdjustedExecutableNetEdgeUsd: finiteOrNull(score.treasuryAdjustedExecutableNetEdgeUsd),
    effectiveSystemNetPnlUsd: finiteOrNull(score.effectiveSystemNetPnlUsd),
    expectedFailureCostUsd: finiteOrNull(score.expectedFailureCostUsd),
    capitalFragmentationDragUsd: finiteOrNull(score.capitalFragmentationDragUsd),
    inputUsd: finiteOrNull(score.inputUsd),
    outputUsd: finiteOrNull(score.outputUsd),
    executionGasUsd: finiteOrNull(score.executionGasUsd),
    knownCostUsd: finiteOrNull(score.knownCostUsd),
    routeFailureRate: finiteOrNull(score.routeStats?.failureRate),
    gasSnapshotAgeMinutes: finiteOrNull(score.gasSnapshotAgeMinutes),
    latencyMs: finiteOrNull(score.latencyMs),
    estimatedTimeInSecs: finiteOrNull(score.estimatedTimeInSecs),
    dexProvider: score.dex?.provider || null,
    dexQuoteAgeMinutes: finiteOrNull(score.dex?.ageMinutes),
    treasuryExecutionRefillCostUsd: finiteOrNull(score.treasuryExecutionRefillCostUsd),
    treasuryReserveReplenishmentCostUsd: finiteOrNull(score.treasuryReserveReplenishmentCostUsd),
    treasuryDecision: fundingSourcePlan?.decision || null,
    treasuryReasons: fundingSourcePlan?.reasons || [],
  };
}

export function stripVolatileShadowObservationFields(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const { observedAt, gasSnapshotAgeMinutes, dexQuoteAgeMinutes, ...stable } = record;
  return stable;
}

export function shouldPersistShadowObservation(previousRecord, nextRecord, options = {}) {
  if (!previousRecord) return { shouldPersist: true, reason: "first_observation" };

  const previousStable = JSON.stringify(stripVolatileShadowObservationFields(previousRecord));
  const nextStable = JSON.stringify(stripVolatileShadowObservationFields(nextRecord));
  if (previousStable !== nextStable) {
    return { shouldPersist: true, reason: "observation_changed" };
  }

  const maxUnchangedAgeMs = Number.isFinite(options.maxUnchangedAgeMs) ? options.maxUnchangedAgeMs : 900_000;
  const previousObservedAtMs = new Date(previousRecord.observedAt || 0).getTime();
  const nextObservedAtMs = new Date(nextRecord.observedAt || 0).getTime();
  if (!Number.isFinite(previousObservedAtMs) || !Number.isFinite(nextObservedAtMs) || nextObservedAtMs - previousObservedAtMs >= maxUnchangedAgeMs) {
    return { shouldPersist: true, reason: "stale_rollover" };
  }

  return { shouldPersist: false, reason: "recently_unchanged" };
}
