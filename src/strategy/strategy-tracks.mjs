function hasBlockingSignals(blockers = []) {
  return Array.isArray(blockers) && blockers.length > 0;
}

function firstMatching(blockers = [], matcher) {
  return (blockers || []).find((item) => matcher(String(item || ""))) || null;
}

function chooseStableLoopAction({ crossAssetArbitrage, bestStablecoinRoute }) {
  const bestLoop = crossAssetArbitrage?.bestLoop || null;
  const bestLoopBlockers = bestLoop?.blockers || [];
  if (bestLoop && !hasBlockingSignals(bestLoopBlockers) && bestLoop.loopNetEdgeUsd > 0) {
    return {
      status: "candidate_loop",
      nextActionCode: "validate_loop_durability",
      reason: "positive_closed_loop_observed",
    };
  }
  if (bestLoop) {
    const blocker = firstMatching(bestLoopBlockers, Boolean) || "best_loop_not_ready";
    return {
      status: "blocked_loop",
      nextActionCode:
        blocker === "amount_mismatch"
          ? "expand_amount_ladder"
          : blocker.includes("stale") || blocker.includes("insufficient_data")
            ? "refresh_stable_loop_quotes"
            : "clear_loop_readiness",
      reason: blocker,
    };
  }
  if (crossAssetArbitrage?.closestLoop) {
    const blockers = crossAssetArbitrage.closestLoop.blockers || [];
    const blocker = blockers[0] || "closest_loop_not_ready";
    return {
      status: "blocked_loop",
      nextActionCode:
        blocker === "amount_mismatch"
          ? "expand_amount_ladder"
          : blocker.includes("stale") || blocker.includes("insufficient_data")
            ? "refresh_stable_loop_quotes"
            : "clear_loop_readiness",
      reason: blocker,
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
  const blockers = best?.blockers || [];
  const nextCoverageTarget = btcProxySpreads?.nextCoverageTarget || null;
  if (btcProxySpreads?.overfitAssessment && btcProxySpreads.overfitAssessment !== "coverage_ok") {
    return {
      status: "thin_coverage",
      nextActionCode:
        nextCoverageTarget?.nextAction === "expand_amount_ladder"
          ? "expand_amount_ladder"
          : nextCoverageTarget?.nextAction === "refresh_stale_quotes"
            ? "refresh_proxy_quotes"
            : "collect_more_proxy_quotes",
      reason: nextCoverageTarget?.reason || btcProxySpreads.overfitRisks?.[0] || btcProxySpreads.overfitAssessment,
    };
  }
  if (best?.policyReadyAfterRebalance && !hasBlockingSignals(blockers)) {
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
  if (best) {
    const blocker = firstMatching(blockers, Boolean) || "rebalance_surface_not_ready";
    return {
      status: "blocked_spread",
      nextActionCode:
        blocker === "amount_mismatch"
          ? "expand_amount_ladder"
          : blocker.includes("missing_rebalance") || blocker.includes("insufficient_data") || blocker.includes("stale")
            ? "refresh_proxy_quotes"
            : "watch_proxy_surface",
      reason: blocker,
    };
  }
  return {
    status: "unobserved",
    nextActionCode: "watch_proxy_surface",
    reason: "no_proxy_surface",
  };
}

function chooseEthFamilyAction(ethProfitability = null) {
  if (!ethProfitability) {
    return {
      status: "unobserved",
      nextActionCode: "watch_eth_family_surface",
      reason: "no_eth_analysis",
    };
  }

  if (ethProfitability.recommendationCode === "no_eth_routes_observed" || ethProfitability.recommendationCode === "no_multichain_eth_family_surface") {
    return {
      status: "unobserved",
      nextActionCode: ethProfitability.followUpActionCode,
      reason: ethProfitability.recommendationCode,
    };
  }

  if (ethProfitability.recommendationCode === "eth_l1_positive_ev_unconfirmed") {
    return {
      status: "blocked_loop",
      nextActionCode: ethProfitability.followUpActionCode,
      reason: ethProfitability.recommendationCode,
    };
  }

  if (
    ethProfitability.recommendationCode === "eth_family_surface_not_persistent" ||
    ethProfitability.recommendationCode === "collect_more_eth_evidence"
  ) {
    return {
      status: "thin_coverage",
      nextActionCode: ethProfitability.followUpActionCode,
      reason: ethProfitability.recommendationCode,
    };
  }

  if (
    ethProfitability.recommendationCode === "eth_family_provider_gaps" ||
    ethProfitability.recommendationCode === "collect_eth_family_loop_quotes" ||
    ethProfitability.recommendationCode === "collect_eth_family_entry_quotes"
  ) {
    return {
      status: "blocked_loop",
      nextActionCode: ethProfitability.followUpActionCode,
      reason: ethProfitability.recommendationCode,
    };
  }

  if (ethProfitability.verdictCode === "policy_ready") {
    return {
      status: "candidate_loop",
      nextActionCode: ethProfitability.followUpActionCode,
      reason: "policy_ready_eth_family_loop",
    };
  }

  if (ethProfitability.verdictCode === "positive_but_below_policy" || ethProfitability.verdictCode === "near_policy") {
    return {
      status: "blocked_loop",
      nextActionCode: ethProfitability.followUpActionCode,
      reason: ethProfitability.verdictCode,
    };
  }

  if (ethProfitability.bestResearchRoute) {
    return {
      status: "route_only",
      nextActionCode: ethProfitability.followUpActionCode,
      reason: ethProfitability.recommendationCode || ethProfitability.verdictCode || "eth_family_route_only",
    };
  }

  return {
    status: "thin_coverage",
    nextActionCode: ethProfitability.followUpActionCode,
    reason: ethProfitability.recommendationCode || ethProfitability.verdictCode || "eth_family_surface_incomplete",
  };
}

export function buildStrategyTracksSummary({
  shadowCycle = null,
  bestStablecoinRoute = null,
  crossAssetArbitrage = null,
  btcProxySpreads = null,
  ethProfitability = null,
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

  if (
    ethProfitability &&
    (
      (ethProfitability.gatewayRouteCount || 0) > 0 ||
      (ethProfitability.routeCount || 0) > 0 ||
      ethProfitability.bestMeasuredRoute ||
      ethProfitability.bestResearchRoute
    )
  ) {
    const ethAction = chooseEthFamilyAction(ethProfitability);
    tracks.push({
      kind: "eth_family_loop",
      label:
        ethProfitability.bestMeasuredRoute?.routeKey ||
        ethProfitability.bestResearchRoute?.routeKey ||
        "ETH family surface",
      amount: ethProfitability.bestMeasuredRoute?.amount || ethProfitability.bestResearchRoute?.amount || null,
      status: ethAction.status,
      nextActionCode: ethAction.nextActionCode,
      reason: ethAction.reason,
      command: ethProfitability.followUpCommand || null,
    });
  }

  return {
    trackCount: tracks.filter((item) => item.label || item.kind).length,
    tracks,
  };
}
