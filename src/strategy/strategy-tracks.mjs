function chooseStableLoopAction({ crossAssetArbitrage, bestStablecoinRoute }) {
  if (crossAssetArbitrage?.bestLoop) {
    return {
      status: "candidate_loop",
      nextActionCode: "validate_loop_durability",
      reason: "best_closed_loop_observed",
    };
  }
  if (crossAssetArbitrage?.closestLoop) {
    const blockers = crossAssetArbitrage.closestLoop.blockers || [];
    return {
      status: "blocked_loop",
      nextActionCode: blockers.includes("amount_mismatch") ? "expand_amount_ladder" : "refresh_stable_loop_quotes",
      reason: blockers[0] || "closest_loop_not_ready",
    };
  }
  if (bestStablecoinRoute) {
    return {
      status: "route_only",
      nextActionCode: "refresh_stable_route_quotes",
      reason: bestStablecoinRoute.tradeReadiness || "stable_route_only",
    };
  }
  return {
    status: "unobserved",
    nextActionCode: "collect_stable_loop_coverage",
    reason: "no_stable_loop_observed",
  };
}

function chooseProxySpreadAction(btcProxySpreads) {
  const best = btcProxySpreads?.bestRebalanceOpportunity || null;
  if (best?.policyReadyAfterRebalance) {
    return {
      status: "candidate_spread",
      nextActionCode: "validate_proxy_durability",
      reason: "policy_ready_after_rebalance",
    };
  }
  if ((btcProxySpreads?.unmatchedObservedProxyGroups || []).length > 0) {
    return {
      status: "underobserved",
      nextActionCode: "expand_proxy_coverage",
      reason: "unmatched_observed_proxy_groups",
    };
  }
  if (btcProxySpreads?.overfitAssessment && btcProxySpreads.overfitAssessment !== "coverage_ok") {
    return {
      status: "thin_coverage",
      nextActionCode: "collect_more_proxy_quotes",
      reason: btcProxySpreads.overfitRisks?.[0] || btcProxySpreads.overfitAssessment,
    };
  }
  return {
    status: best ? "watching" : "unobserved",
    nextActionCode: "watch_proxy_surface",
    reason: best ? (best.blockers?.[0] || "watch_surface") : "no_proxy_surface",
  };
}

export function buildStrategyTracksSummary({
  shadowCycle = null,
  bestStablecoinRoute = null,
  crossAssetArbitrage = null,
  btcProxySpreads = null,
} = {}) {
  const tracks = [];
  const activeCanary = shadowCycle?.topRoute || null;
  const shadowActions = shadowCycle?.shadowActions || [];

  if (activeCanary) {
    const activeAction = shadowActions[0] || null;
    tracks.push({
      kind: "active_canary",
      label: activeCanary.label || activeCanary.routeKey || null,
      amount: activeCanary.amount || null,
      status: activeCanary.tradeReadiness || "unknown",
      nextActionCode: activeAction?.code || null,
      reason: activeAction?.reason || activeCanary.tradeReadiness || null,
      command: activeAction?.command || null,
    });
  }

  const nextRouteShadow = shadowActions.find((item, index) => index > 0) || null;
  if (nextRouteShadow) {
    tracks.push({
      kind: "route_shadow",
      label: nextRouteShadow.label || null,
      amount: nextRouteShadow.amount || null,
      status: nextRouteShadow.code || "unknown",
      nextActionCode: nextRouteShadow.code || null,
      reason: nextRouteShadow.reason || null,
      command: nextRouteShadow.command || null,
    });
  }

  const stableAction = chooseStableLoopAction({ crossAssetArbitrage, bestStablecoinRoute });
  tracks.push({
    kind: "stable_loop",
    label:
      crossAssetArbitrage?.bestLoop
        ? `${crossAssetArbitrage.bestLoop.entryRouteKey} + ${crossAssetArbitrage.bestLoop.exitRouteKey}`
        : crossAssetArbitrage?.closestLoop
          ? `${crossAssetArbitrage.closestLoop.entryRouteKey} + ${crossAssetArbitrage.closestLoop.exitRouteKey}`
          : bestStablecoinRoute?.routeKey || null,
    amount: crossAssetArbitrage?.bestLoop?.entryAmount || crossAssetArbitrage?.closestLoop?.entryAmount || bestStablecoinRoute?.amount || null,
    status: stableAction.status,
    nextActionCode: stableAction.nextActionCode,
    reason: stableAction.reason,
    command: null,
  });

  const proxyAction = chooseProxySpreadAction(btcProxySpreads);
  tracks.push({
    kind: "proxy_spread",
    label:
      btcProxySpreads?.bestRebalanceOpportunity
        ? `${btcProxySpreads.bestRebalanceOpportunity.buyChain}->${btcProxySpreads.bestRebalanceOpportunity.sellChain} ${btcProxySpreads.bestRebalanceOpportunity.proxyTicker}`
        : (btcProxySpreads?.unmatchedObservedProxyGroups || [])[0] || null,
    amount: btcProxySpreads?.bestRebalanceOpportunity?.amount || null,
    status: proxyAction.status,
    nextActionCode: proxyAction.nextActionCode,
    reason: proxyAction.reason,
    command: null,
  });

  return {
    trackCount: tracks.filter((item) => item.label || item.kind).length,
    tracks,
  };
}
