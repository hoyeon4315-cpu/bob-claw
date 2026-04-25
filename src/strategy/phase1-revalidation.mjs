const FLASH_ARB_CONTRACT_MIN_PROFIT_USD = 0.3;

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countBy(items = [], keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function variantKey(routeKey, amount) {
  return `${routeKey}|${String(amount ?? "")}`;
}

function overfitDecisionForEntry(entry = null) {
  if ((entry?.overfitRisks || []).length > 0) {
    return {
      passesOverfitGate: false,
      passReasonCode: "overfit_risks_present",
    };
  }
  if (entry?.status === "candidate_for_validation" || entry?.status === "measured_below_policy") {
    return {
      passesOverfitGate: true,
      passReasonCode: "measured_without_overfit_flags",
    };
  }
  return {
    passesOverfitGate: false,
    passReasonCode: "insufficient_measured_evidence",
  };
}

export function buildOverfitAuditArtifact({ audit = null, strategySnapshot = null, now = null } = {}) {
  const lanes = (strategySnapshot?.implementedStrategies || []).map((entry) => {
    const decision = overfitDecisionForEntry(entry);
    return {
      id: entry.id || null,
      label: entry.label || null,
      status: entry.status || null,
      evidenceGrade: entry.evidenceGrade || null,
      overfitRisks: entry.overfitRisks || [],
      blockers: entry.blockers || [],
      nextAction: entry.nextAction || null,
      passesOverfitGate: decision.passesOverfitGate,
      passReasonCode: decision.passReasonCode,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    audit: audit
      ? {
          label: audit.auditLabel || "Overfit Audit",
          decision: audit.decision || null,
          shadow: audit.shadow || null,
          sampleSource: audit.sampleSource || null,
          shadowHours: finite(audit.shadowHours),
          targetShadowHours: finite(audit.targetShadowHours),
          hourBuckets: finite(audit.hourBuckets),
          targetHourBuckets: finite(audit.targetHourBuckets),
          remainingShadowHours: finite(audit.remainingShadowHours),
          remainingHourBuckets: finite(audit.remainingHourBuckets),
          earliestShadowWindowReadyAt: audit.earliestShadowWindowReadyAt || null,
          earliestHourBucketReadyAt: audit.earliestHourBucketReadyAt || null,
          earliestTimeGateReadyAt: audit.earliestTimeGateReadyAt || null,
          blockers: audit.checks?.filter((check) => !check.ok).map((check) => check.label) || [],
          warningLabels: audit.warnings?.filter((warning) => !warning.ok).map((warning) => warning.label) || [],
          checks: audit.checks || [],
          warnings: audit.warnings || [],
        }
      : null,
    summary: {
      globalAuditPasses: audit?.decision === "LIVE_CANARY_REVIEW_POSSIBLE",
      laneCount: lanes.length,
      passesOverfitGateCount: lanes.filter((lane) => lane.passesOverfitGate).length,
      blockedLaneCount: lanes.filter((lane) => lane.passesOverfitGate === false).length,
      blockerCount: audit?.checks?.filter((check) => !check.ok).length || 0,
      warningCount: audit?.warnings?.filter((warning) => !warning.ok).length || 0,
    },
    lanes,
  };
}

function gatewayWrappedBtcEvidence(dashboardStatus = null) {
  const strategy = dashboardStatus?.strategy || {};
  const loop = strategy.edgeViability?.bestMeasuredLoop || strategy.edgeViability?.closestLoop || null;
  return {
    routeKey: loop?.routeKey || null,
    amount: loop?.amount || null,
    netPnlMeasuredUsd: finite(loop?.measuredLoopNetUsd),
    evidenceSource: loop?.routeKey ? "edgeViability" : "missing_gateway_loop_evidence",
  };
}

function btcProxyEvidence(dashboardStatus = null) {
  const best = dashboardStatus?.strategy?.btcProxySpreads?.bestRebalanceOpportunity || null;
  return {
    routeKey: best?.rebalanceRouteKey || null,
    amount: best?.amount || null,
    netPnlMeasuredUsd: finite(best?.rebalanceAdjustedSpreadUsd),
    evidenceSource: best?.rebalanceRouteKey ? "btcProxySpreads.bestRebalanceOpportunity" : "missing_proxy_evidence",
  };
}

function stableLoopEvidence(dashboardStatus = null) {
  const strategy = dashboardStatus?.strategy || {};
  const bestLoop = strategy.crossAssetArbitrage?.bestLoop || strategy.crossAssetArbitrage?.closestLoop || null;
  if (bestLoop) {
    return {
      routeKey: bestLoop.entryRouteKey || null,
      amount: bestLoop.entryAmount || null,
      netPnlMeasuredUsd: finite(bestLoop.loopNetEdgeUsd),
      evidenceSource: "crossAssetArbitrage.loopNetEdgeUsd",
    };
  }
  const bestStable = strategy.bestStablecoinRoute || null;
  return {
    routeKey: bestStable?.routeKey || null,
    amount: bestStable?.amount || null,
    netPnlMeasuredUsd: finite(bestStable?.executableNetEdgeUsd ?? bestStable?.netEdgeUsd),
    evidenceSource: bestStable?.routeKey ? "bestStablecoinRoute" : "missing_stable_loop_evidence",
  };
}

function ethFamilyEvidence(dashboardStatus = null) {
  const best = dashboardStatus?.strategy?.ethProfitability?.bestMeasuredRoute || dashboardStatus?.strategy?.ethProfitability?.closestPolicyRoute || null;
  return {
    routeKey: best?.routeKey || null,
    amount: best?.amount || null,
    netPnlMeasuredUsd: finite(best?.netUsd),
    evidenceSource: best?.routeKey ? "ethProfitability" : "missing_eth_family_evidence",
  };
}

function implementedStrategyEvidence(entry = null, dashboardStatus = null) {
  switch (entry?.id) {
    case "gateway_wrapped_btc_loops":
      return gatewayWrappedBtcEvidence(dashboardStatus);
    case "btc_proxy_spreads":
      return btcProxyEvidence(dashboardStatus);
    case "stablecoin_entry_exit_loops":
      return stableLoopEvidence(dashboardStatus);
    case "eth_family_gateway":
      return ethFamilyEvidence(dashboardStatus);
    case "triangular_flash_btc":
      return {
        routeKey: null,
        amount: null,
        netPnlMeasuredUsd: null,
        evidenceSource: "triangle_artifact_needs_usd_net_mapping",
      };
    case "eth_mixed_stable_loops":
      return {
        routeKey: entry?.evidence?.bestLoop || null,
        amount: null,
        netPnlMeasuredUsd: null,
        evidenceSource: "mixed_eth_loop_needs_usd_mapping",
      };
    case "eth_dex_spread_mixed":
    case "eth_mixed_flash":
      return {
        routeKey: null,
        amount: null,
        netPnlMeasuredUsd: null,
        evidenceSource: "mixed_triangle_flash_needs_usd_mapping",
      };
    default:
      return {
        routeKey: null,
        amount: null,
        netPnlMeasuredUsd: null,
        evidenceSource: "no_lane_extractor",
      };
  }
}

function varianceForEvidence(evidence = null, varianceArtifact = null) {
  if (!evidence?.routeKey || evidence.amount === null || evidence.amount === undefined) return null;
  const route = (varianceArtifact?.routes || []).find(
    (item) => item.routeVariantKey === variantKey(evidence.routeKey, evidence.amount),
  );
  return route || null;
}

function nextStatusForLane({ entry, evidence, varianceRoute, overfitLane } = {}) {
  const measuredNetUsd = evidence?.netPnlMeasuredUsd;
  const varianceUsd = varianceRoute?.policyNoiseFloorUsd ?? null;
  const overfitBlocked = overfitLane ? overfitLane.passesOverfitGate === false : (entry?.overfitRisks || []).length > 0;
  const contractFloorBlocked = entry?.id === "triangular_flash_btc";

  if (!Number.isFinite(measuredNetUsd)) {
    return {
      statusNew: entry?.status || null,
      clearsNewFloor: null,
      statusReasonCode: "measured_net_missing",
    };
  }
  if (!Number.isFinite(varianceUsd)) {
    return {
      statusNew: "needs_variance_measurement",
      clearsNewFloor: null,
      statusReasonCode: "variance_missing",
    };
  }
  if (!(measuredNetUsd > 0)) {
    return {
      statusNew: "measured_below_zero_floor",
      clearsNewFloor: false,
      statusReasonCode: "net_not_positive",
    };
  }
  if (measuredNetUsd <= varianceUsd) {
    return {
      statusNew: "measured_inside_variance_floor",
      clearsNewFloor: false,
      statusReasonCode: "inside_noise_floor",
    };
  }
  if (overfitBlocked) {
    return {
      statusNew: "measured_overfit_blocked",
      clearsNewFloor: true,
      statusReasonCode: "overfit_gate_blocked",
    };
  }
  if (contractFloorBlocked && measuredNetUsd < FLASH_ARB_CONTRACT_MIN_PROFIT_USD) {
    return {
      statusNew: "blocked_by_contract_floor",
      clearsNewFloor: true,
      statusReasonCode: "contract_floor_blocks_flash",
    };
  }
  return {
    statusNew: "candidate_for_validation",
    clearsNewFloor: true,
    statusReasonCode: "positive_outside_noise_floor",
  };
}

export function buildLaneReclassificationArtifact({
  strategySnapshot = null,
  dashboardStatus = null,
  varianceArtifact = null,
  overfitAuditArtifact = null,
  now = null,
} = {}) {
  const overfitByLaneId = new Map((overfitAuditArtifact?.lanes || []).map((lane) => [lane.id, lane]));
  const lanes = (strategySnapshot?.implementedStrategies || []).map((entry) => {
    const evidence = implementedStrategyEvidence(entry, dashboardStatus);
    const varianceRoute = varianceForEvidence(evidence, varianceArtifact);
    const overfitLane = overfitByLaneId.get(entry.id) || null;
    const decision = nextStatusForLane({ entry, evidence, varianceRoute, overfitLane });
    const remainingBlockers = unique([
      ...(entry?.overfitRisks || []),
      ...(entry?.blockers || []),
      decision.statusReasonCode === "contract_floor_blocks_flash" ? "contract_level_flash_floor" : null,
      decision.statusReasonCode === "variance_missing" ? "variance_artifact_missing_for_lane" : null,
      decision.statusReasonCode === "measured_net_missing" ? "measured_net_missing" : null,
    ]);

    return {
      id: entry.id || null,
      label: entry.label || null,
      statusOld: entry.status || null,
      statusNew: decision.statusNew,
      netPnlMeasuredUsd: round(evidence.netPnlMeasuredUsd),
      gasSlippageVarianceUsd: round(varianceRoute?.policyNoiseFloorUsd),
      clearsNewFloor: decision.clearsNewFloor,
      passesOverfitGate: overfitLane?.passesOverfitGate ?? null,
      evidenceRouteKey: evidence.routeKey || null,
      evidenceAmount: evidence.amount || null,
      evidenceSource: evidence.evidenceSource || null,
      varianceRouteVariantKey: varianceRoute?.routeVariantKey || null,
      remainingBlockers,
      statusReasonCode: decision.statusReasonCode,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      laneCount: lanes.length,
      statusCounts: countBy(lanes, (lane) => lane.statusNew || "unknown"),
      clearsNewFloorCount: lanes.filter((lane) => lane.clearsNewFloor === true).length,
      needsVarianceMeasurementCount: lanes.filter((lane) => lane.statusNew === "needs_variance_measurement").length,
      blockedByContractFloorCount: lanes.filter((lane) => lane.statusNew === "blocked_by_contract_floor").length,
    },
    lanes,
  };
}

export function summarizePhase1Revalidation({
  overfitAuditArtifact = null,
  gasSlippageVariance = null,
  varianceArtifact = null,
  laneReclassification = null,
} = {}) {
  const effectiveVarianceArtifact = varianceArtifact || gasSlippageVariance || null;
  if (!overfitAuditArtifact && !effectiveVarianceArtifact && !laneReclassification) return null;
  const statusCounts = laneReclassification?.summary?.statusCounts || {};
  return {
    overfitDecision: overfitAuditArtifact?.audit?.decision || null,
    globalOverfitPasses: overfitAuditArtifact?.summary?.globalAuditPasses ?? null,
    overfitLaneCount: overfitAuditArtifact?.summary?.laneCount ?? 0,
    passesOverfitGateCount: overfitAuditArtifact?.summary?.passesOverfitGateCount ?? 0,
    varianceRouteCount: effectiveVarianceArtifact?.summary?.routeVariantCount ?? 0,
    varianceReadyRouteCount: effectiveVarianceArtifact?.summary?.varianceReadyRouteCount ?? 0,
    laneCount: laneReclassification?.summary?.laneCount ?? 0,
    clearsNewFloorCount: laneReclassification?.summary?.clearsNewFloorCount ?? 0,
    needsVarianceMeasurementCount: laneReclassification?.summary?.needsVarianceMeasurementCount ?? 0,
    blockedByContractFloorCount: laneReclassification?.summary?.blockedByContractFloorCount ?? 0,
    candidateForValidationCount: statusCounts.candidate_for_validation || 0,
    measuredInsideVarianceFloorCount: statusCounts.measured_inside_variance_floor || 0,
  };
}
