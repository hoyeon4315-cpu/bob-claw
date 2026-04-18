import { buildCanarySelectionGap } from "./canary-selection-gap.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function bestStablecoinRoute(scoreSnapshot = null) {
  const scores = scoreSnapshot?.scores || [];
  return [...scores]
    .filter((score) => score?.srcAsset?.family === "stablecoin" || score?.dstAsset?.family === "stablecoin")
    .sort(
      (left, right) =>
        (right.executableNetEdgeUsd ?? right.netEdgeUsd ?? Number.NEGATIVE_INFINITY) -
          (left.executableNetEdgeUsd ?? left.netEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    )[0] || null;
}

function summarizeLoopRoute(route = null) {
  if (!route) return null;
  return {
    routeKey: route.routeKey || null,
    amount: route.amount || null,
    netUsd: finite(route.measuredLoopNetUsd),
    gapToPolicyUsd: finite(route.gapToPolicyUsd),
    targetUsd: finite(route.requiredNetProfitUsd),
    blockers: route.blockers || [],
    tradeReadiness: route.tradeReadiness || null,
  };
}

function summarizeResearchRoute(route = null) {
  if (!route) return null;
  return {
    routeKey: route.routeKey || null,
    amount: route.amount || route.amountLevels?.[0] || null,
    classification: route.classification || null,
    tradeReadiness: route.bestTradeReadiness || route.tradeReadiness || null,
    netUsd: finite(route.bestExecutableNetEdgeUsd ?? route.executableNetEdgeUsd ?? route.bestNetEdgeUsd ?? route.netEdgeUsd),
    amountLevelCount: route.amountLevelCount ?? null,
  };
}

function buildEthFollowUp(recommendationCode = null, verdictCode = null) {
  if (recommendationCode === "no_eth_routes_observed" || recommendationCode === "no_multichain_eth_family_surface") {
    return {
      code: "watch_eth_family_surface",
      label: "watch ETH family surface",
    };
  }
  if (recommendationCode === "eth_l1_policy_override_disabled") {
    return {
      code: "review_eth_policy_override",
      label: "review ETH policy override",
    };
  }
  if (
    recommendationCode === "eth_family_surface_not_persistent" ||
    recommendationCode === "collect_more_eth_evidence"
  ) {
    return {
      code: "collect_eth_family_evidence",
      label: "collect ETH family evidence",
    };
  }
  if (
    recommendationCode === "eth_family_provider_gaps" ||
    recommendationCode === "collect_eth_family_loop_quotes" ||
    recommendationCode === "collect_eth_family_entry_quotes"
  ) {
    return {
      code: "collect_eth_family_quotes",
      label: "collect ETH family loop quotes",
    };
  }
  if (verdictCode === "policy_ready") {
    return {
      code: "validate_eth_loop_durability",
      label: "validate ETH loop durability",
    };
  }
  if (verdictCode === "positive_but_below_policy" || verdictCode === "near_policy") {
    return {
      code: "collect_eth_family_evidence",
      label: "collect ETH family evidence",
    };
  }
  return {
    code: "refresh_eth_family_analysis",
    label: "refresh ETH family analysis",
  };
}

function buildEthFollowUpCommand(routeKey = null) {
  return [
    routeKey ? `npm run scan:quote-surface -- --route-key=${JSON.stringify(routeKey)}` : null,
    "npm run analyze:ethereum-routes -- --write",
    "npm run audit:eth-family-overfit",
    "npm run status:dashboard",
  ]
    .filter(Boolean)
    .join(" && ");
}

export function buildEthProfitabilitySummary(ethAnalysis = null) {
  if (!ethAnalysis) return null;
  const capability = ethAnalysis.capability || {};
  const ethFamily = ethAnalysis.ethFamily || {};
  const viability = ethFamily.viability || null;
  const recommendation = ethAnalysis.recommendation || null;
  const verdict = ethFamily.verdict || recommendation || null;
  const bestMeasuredRoute = summarizeLoopRoute(viability?.bestMeasuredLoop || ethFamily.gatewayArbitrage?.bestLoop || null);
  const closestPolicyRoute = summarizeLoopRoute(viability?.closestLoop || ethFamily.gatewayArbitrage?.closestLoop || null);
  const bestResearchRoute = summarizeResearchRoute(ethFamily.routeFocus?.bestRoute || ethAnalysis.scores?.bestOpenResearchRoute || null);
  const followUp = buildEthFollowUp(recommendation?.code || null, verdict?.code || null);
  return {
    gatewayRouteCount: capability.gatewayRouteCount || 0,
    routeCount: capability.ethFamilyRouteCount || 0,
    measuredClosedLoopCount: ethFamily.gatewayArbitrage?.measuredNetLoopCount || 0,
    profitableClosedLoopCount: ethFamily.gatewayArbitrage?.profitableExactCount || 0,
    loopObservableRouteCount: ethFamily.routeFocus?.loopObservableCount || 0,
    fullyMeasurableRouteCount: ethFamily.routeUniverse?.fullyMeasurableRouteCount || 0,
    stableRouteCount: ethFamily.persistence?.stableRouteCount || 0,
    policyBlockedCount: ethAnalysis.scores?.policyBlockedCount || 0,
    verdictCode: verdict?.code || null,
    verdictLabel: verdict?.label || null,
    verdictDetail: verdict?.detail || null,
    recommendationCode: recommendation?.code || null,
    recommendationLabel: recommendation?.label || null,
    recommendationDetail: recommendation?.detail || null,
    bestMeasuredRoute,
    closestPolicyRoute,
    bestResearchRoute,
    overfitRisks: ethFamily.overfit?.risks || [],
    followUpActionCode: followUp.code,
    followUpActionLabel: followUp.label,
    followUpCommand: buildEthFollowUpCommand(
      bestResearchRoute?.routeKey || bestMeasuredRoute?.routeKey || closestPolicyRoute?.routeKey || null,
    ),
  };
}

export function buildProfitabilitySummary({
  scoreSnapshot = null,
  dexRouteFocus = null,
  dexGatewayArbitrage = null,
  edgeViability = null,
  noEdgePersistence = null,
  canaryInputs = null,
  routePlan = null,
  ethAnalysis = null,
} = {}) {
  const bestStable = bestStablecoinRoute(scoreSnapshot);
  const bestMeasured = edgeViability?.bestMeasuredLoop || null;
  const closestPolicy = edgeViability?.closestLoop || null;
  const verdict = edgeViability?.verdict || null;
  const ethFamily = buildEthProfitabilitySummary(ethAnalysis);
  const canarySelectionGap = buildCanarySelectionGap({
    routePlan,
    edgeViability,
    canaryInputs,
    scoreSnapshot,
  });

  return {
    schemaVersion: 1,
    measuredClosedLoopCount: dexGatewayArbitrage?.measuredNetLoopCount || 0,
    profitableClosedLoopCount: dexGatewayArbitrage?.profitableExactCount || 0,
    loopObservableRouteCount: dexRouteFocus?.loopObservableCount || 0,
    missingGatewayQuoteCount: dexRouteFocus?.missingGatewayQuoteCount || 0,
    verdictCode: verdict?.code || null,
    verdictLabel: verdict?.label || null,
    verdictDetail: verdict?.detail || null,
    canaryTradeReadiness: canaryInputs?.scoreTradeReadiness || null,
    canaryNetEdgeUsd: finite(scoreSnapshot?.scores?.find(
      (item) => item.routeKey === canaryInputs?.routeKey && String(item.amount) === String(canaryInputs?.amount),
    )?.executableNetEdgeUsd ?? scoreSnapshot?.scores?.find(
      (item) => item.routeKey === canaryInputs?.routeKey && String(item.amount) === String(canaryInputs?.amount),
    )?.netEdgeUsd),
    bestMeasuredRoute: bestMeasured
      ? {
          routeKey: bestMeasured.routeKey,
          amount: bestMeasured.amount,
          netUsd: finite(bestMeasured.measuredLoopNetUsd),
          gapToPolicyUsd: finite(bestMeasured.gapToPolicyUsd),
        }
      : null,
    closestPolicyRoute: closestPolicy
      ? {
          routeKey: closestPolicy.routeKey,
          amount: closestPolicy.amount,
          netUsd: finite(closestPolicy.measuredLoopNetUsd),
          gapToPolicyUsd: finite(closestPolicy.gapToPolicyUsd),
          targetUsd: finite(closestPolicy.requiredNetProfitUsd),
        }
      : null,
    bestStablecoinRoute: bestStable
      ? {
          routeKey: bestStable.routeKey,
          amount: bestStable.amount,
          tradeReadiness: bestStable.tradeReadiness || null,
          netUsd: finite(bestStable.executableNetEdgeUsd ?? bestStable.netEdgeUsd),
        }
      : null,
    canarySelectionGap: canarySelectionGap
      ? {
          selectionCode: canarySelectionGap.selectionCode,
          selectionLabel: canarySelectionGap.selectionLabel,
          reasonLabels: canarySelectionGap.reasonLabels,
          blockerLabels: canarySelectionGap.blockerLabels,
          reviewPlan: canarySelectionGap.reviewPlan,
          hypothesisGuard: canarySelectionGap.hypothesisGuard,
          currentCanary: canarySelectionGap.currentCanary,
          measuredLeader: canarySelectionGap.measuredLeader,
        }
      : null,
    durableNoEdgeRouteCount: noEdgePersistence?.durableNoEdgeRouteCount || 0,
    ethFamily,
  };
}
