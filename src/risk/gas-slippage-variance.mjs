function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function variantKey(routeKey, amount) {
  return `${routeKey}|${String(amount ?? "")}`;
}

function mean(values = []) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stddev(values = []) {
  if (!values.length) return null;
  const avg = mean(values);
  const variance = values.reduce((total, value) => total + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values = [], pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function sampleStats(values = []) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) {
    return {
      sampleCount: 0,
      meanUsd: null,
      medianUsd: null,
      stddevUsd: null,
      minUsd: null,
      maxUsd: null,
      p95AbsUsd: null,
    };
  }

  const absValues = finiteValues.map((value) => Math.abs(value));
  return {
    sampleCount: finiteValues.length,
    meanUsd: round(mean(finiteValues)),
    medianUsd: round(median(finiteValues)),
    stddevUsd: round(stddev(finiteValues)),
    minUsd: round(Math.min(...finiteValues)),
    maxUsd: round(Math.max(...finiteValues)),
    p95AbsUsd: round(percentile(absValues, 95)),
  };
}

function drift(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) ? actual - expected : null;
}

function observedAtMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function touchGroup(groups, routeKey, amount) {
  if (!routeKey || amount === null || amount === undefined) return null;
  const key = variantKey(routeKey, amount);
  if (!groups.has(key)) {
    groups.set(key, {
      routeVariantKey: key,
      routeKey,
      amount,
      srcChain: null,
      dstChain: null,
      currentTradeReadiness: null,
      currentEffectiveSystemNetPnlUsd: null,
      currentExecutionGasUsd: null,
      shadowObservedAt: [],
      receiptObservedAt: [],
      shadowSystemNetValues: [],
      shadowObservedEdgeValues: [],
      shadowExecutionGasValues: [],
      receiptRealizedNetValues: [],
      receiptEstimatedNetValues: [],
      receiptNetDriftValues: [],
      receiptGasDriftValues: [],
      receiptOutputDriftValues: [],
    });
  }
  return groups.get(key);
}

function latestObservedAt(values = []) {
  const sorted = values
    .map(observedAtMs)
    .filter(Number.isFinite)
    .sort((left, right) => right - left);
  return sorted.length ? new Date(sorted[0]).toISOString() : null;
}

function preferredShadowNetPnlUsd(observation = null) {
  const effectiveSystemNetPnlUsd = finite(observation?.effectiveSystemNetPnlUsd);
  const treasuryAdjustedNetEdgeUsd = finite(
    observation?.treasuryAdjustedExecutableNetEdgeUsd ?? observation?.treasuryAdjustedNetEdgeUsd,
  );
  const observedEdgeUsd = finite(
    observation?.observedEdgeUsd ?? observation?.referenceExecutableNetEdgeUsd ?? observation?.referenceNetEdgeUsd,
  );

  if (Number.isFinite(effectiveSystemNetPnlUsd) && Number.isFinite(observedEdgeUsd)) {
    const mismatchedDirection =
      Math.sign(effectiveSystemNetPnlUsd) !== 0 &&
      Math.sign(observedEdgeUsd) !== 0 &&
      Math.sign(effectiveSystemNetPnlUsd) !== Math.sign(observedEdgeUsd);
    const suspiciousMagnitude = Math.abs(effectiveSystemNetPnlUsd) > Math.max(10, Math.abs(observedEdgeUsd) * 25);
    if (mismatchedDirection || suspiciousMagnitude) {
      return treasuryAdjustedNetEdgeUsd ?? observedEdgeUsd;
    }
  }

  return effectiveSystemNetPnlUsd ?? treasuryAdjustedNetEdgeUsd ?? observedEdgeUsd;
}

export function buildGasSlippageVarianceArtifact({
  shadowObservations = [],
  receiptRecords = [],
  scores = [],
  now = new Date().toISOString(),
} = {}) {
  const groups = new Map();

  for (const score of scores) {
    const group = touchGroup(groups, score?.routeKey, score?.amount);
    if (!group) continue;
    group.srcChain = score?.srcChain || group.srcChain;
    group.dstChain = score?.dstChain || group.dstChain;
    group.currentTradeReadiness = score?.tradeReadiness || group.currentTradeReadiness;
    if (Number.isFinite(score?.effectiveSystemNetPnlUsd)) {
      group.currentEffectiveSystemNetPnlUsd = score.effectiveSystemNetPnlUsd;
    }
    if (Number.isFinite(score?.executionGasUsd)) {
      group.currentExecutionGasUsd = score.executionGasUsd;
    }
  }

  for (const observation of shadowObservations) {
    const group = touchGroup(groups, observation?.routeKey, observation?.amount);
    if (!group) continue;
    group.srcChain = observation?.srcChain || group.srcChain;
    group.dstChain = observation?.dstChain || group.dstChain;
    if (observation?.observedAt) group.shadowObservedAt.push(observation.observedAt);
    const preferredShadowNetUsd = preferredShadowNetPnlUsd(observation);
    if (Number.isFinite(preferredShadowNetUsd)) {
      group.shadowSystemNetValues.push(preferredShadowNetUsd);
    }
    if (Number.isFinite(observation?.observedEdgeUsd)) {
      group.shadowObservedEdgeValues.push(observation.observedEdgeUsd);
    }
    if (Number.isFinite(observation?.executionGasUsd)) {
      group.shadowExecutionGasValues.push(observation.executionGasUsd);
    }
  }

  for (const record of receiptRecords) {
    const routeContext = record?.routeContext || null;
    const group = touchGroup(groups, routeContext?.routeKey, routeContext?.amount);
    if (!group) continue;
    group.srcChain = routeContext?.srcChain || group.srcChain;
    group.dstChain = routeContext?.dstChain || group.dstChain;
    if (record?.observedAt) group.receiptObservedAt.push(record.observedAt);

    const realizedNet = finite(record?.realized?.realizedNetPnlUsd);
    const estimatedNet = finite(routeContext?.estimatedNetPnlUsd);
    const gasDriftUsd = finite(record?.realized?.gasDriftUsd);
    const outputDriftUsd = drift(record?.output?.actualOutputUsd, routeContext?.estimatedOutputUsd);

    if (Number.isFinite(realizedNet)) {
      group.receiptRealizedNetValues.push(realizedNet);
    }
    if (Number.isFinite(estimatedNet)) {
      group.receiptEstimatedNetValues.push(estimatedNet);
    }
    if (Number.isFinite(realizedNet) && Number.isFinite(estimatedNet)) {
      group.receiptNetDriftValues.push(realizedNet - estimatedNet);
    }
    if (Number.isFinite(gasDriftUsd)) {
      group.receiptGasDriftValues.push(gasDriftUsd);
    }
    if (Number.isFinite(outputDriftUsd)) {
      group.receiptOutputDriftValues.push(outputDriftUsd);
    }
  }

  const routes = [...groups.values()]
    .map((group) => {
      const shadowSystemNet = sampleStats(group.shadowSystemNetValues);
      const shadowObservedEdge = sampleStats(group.shadowObservedEdgeValues);
      const shadowExecutionGas = sampleStats(group.shadowExecutionGasValues);
      const receiptRealizedNet = sampleStats(group.receiptRealizedNetValues);
      const receiptEstimatedNet = sampleStats(group.receiptEstimatedNetValues);
      const receiptNetDrift = sampleStats(group.receiptNetDriftValues);
      const receiptGasDrift = sampleStats(group.receiptGasDriftValues);
      const receiptOutputDrift = sampleStats(group.receiptOutputDriftValues);

      const dispersionCandidates = [
        Number.isFinite(shadowSystemNet.stddevUsd) ? shadowSystemNet.stddevUsd * 2 : null,
        Number.isFinite(receiptRealizedNet.stddevUsd) ? receiptRealizedNet.stddevUsd * 2 : null,
        Number.isFinite(receiptNetDrift.medianUsd) || Number.isFinite(receiptNetDrift.stddevUsd)
          ? Math.abs(receiptNetDrift.medianUsd || 0) + 2 * (receiptNetDrift.stddevUsd || 0)
          : null,
        Number.isFinite(receiptGasDrift.medianUsd) || Number.isFinite(receiptGasDrift.stddevUsd)
          ? Math.abs(receiptGasDrift.medianUsd || 0) + 2 * (receiptGasDrift.stddevUsd || 0)
          : null,
        Number.isFinite(receiptOutputDrift.medianUsd) || Number.isFinite(receiptOutputDrift.stddevUsd)
          ? Math.abs(receiptOutputDrift.medianUsd || 0) + 2 * (receiptOutputDrift.stddevUsd || 0)
          : null,
      ].filter(Number.isFinite);

      const policyNoiseFloorUsd = dispersionCandidates.length ? round(Math.max(...dispersionCandidates)) : null;
      const centerNetUsd =
        receiptRealizedNet.medianUsd ??
        shadowSystemNet.medianUsd ??
        group.currentEffectiveSystemNetPnlUsd ??
        shadowObservedEdge.medianUsd ??
        null;

      return {
        routeVariantKey: group.routeVariantKey,
        routeKey: group.routeKey,
        amount: group.amount,
        srcChain: group.srcChain,
        dstChain: group.dstChain,
        latestShadowObservedAt: latestObservedAt(group.shadowObservedAt),
        latestReceiptObservedAt: latestObservedAt(group.receiptObservedAt),
        currentTradeReadiness: group.currentTradeReadiness,
        currentEffectiveSystemNetPnlUsd: round(group.currentEffectiveSystemNetPnlUsd),
        currentExecutionGasUsd: round(group.currentExecutionGasUsd),
        sourceMix: {
          shadowObservationCount: shadowSystemNet.sampleCount,
          receiptRealizedCount: receiptRealizedNet.sampleCount,
          receiptEstimatedCount: receiptEstimatedNet.sampleCount,
        },
        centerNetUsd: round(centerNetUsd),
        policyNoiseFloorUsd,
        shadowSystemNet,
        shadowObservedEdge,
        shadowExecutionGas,
        receiptRealizedNet,
        receiptEstimatedNet,
        receiptNetDrift,
        receiptGasDrift,
        receiptOutputDrift,
      };
    })
    .sort(
      (left, right) =>
        (right.policyNoiseFloorUsd ?? Number.NEGATIVE_INFINITY) - (left.policyNoiseFloorUsd ?? Number.NEGATIVE_INFINITY) ||
        (right.sourceMix.receiptRealizedCount + right.sourceMix.shadowObservationCount) -
          (left.sourceMix.receiptRealizedCount + left.sourceMix.shadowObservationCount) ||
        String(left.routeVariantKey).localeCompare(String(right.routeVariantKey)),
    );

  return {
    schemaVersion: 1,
    generatedAt: now,
    summary: {
      routeVariantCount: routes.length,
      varianceReadyRouteCount: routes.filter((item) => Number.isFinite(item.policyNoiseFloorUsd)).length,
      shadowBackedRouteCount: routes.filter((item) => item.sourceMix.shadowObservationCount > 0).length,
      receiptBackedRouteCount: routes.filter((item) => item.sourceMix.receiptRealizedCount > 0).length,
      topVarianceRouteKey: routes[0]?.routeKey || null,
      topVarianceRouteVariantKey: routes[0]?.routeVariantKey || null,
      topVarianceNoiseFloorUsd: routes[0]?.policyNoiseFloorUsd ?? null,
    },
    routes,
  };
}

export function summarizeGasSlippageVarianceArtifact(artifact = null) {
  if (!artifact) return null;
  const topRoute = artifact.routes?.[0] || null;
  return {
    generatedAt: artifact.generatedAt || null,
    routeVariantCount: artifact.summary?.routeVariantCount ?? 0,
    varianceReadyRouteCount: artifact.summary?.varianceReadyRouteCount ?? 0,
    shadowBackedRouteCount: artifact.summary?.shadowBackedRouteCount ?? 0,
    receiptBackedRouteCount: artifact.summary?.receiptBackedRouteCount ?? 0,
    topVarianceRoute: topRoute
      ? {
          routeVariantKey: topRoute.routeVariantKey || null,
          routeKey: topRoute.routeKey || null,
          amount: topRoute.amount || null,
          policyNoiseFloorUsd: topRoute.policyNoiseFloorUsd ?? null,
          centerNetUsd: topRoute.centerNetUsd ?? null,
        }
      : null,
  };
}
