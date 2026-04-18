function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function preferredLeaderNetUsd(score) {
  return finite(score?.executableNetEdgeUsd) ?? finite(score?.netEdgeUsd) ?? finite(score?.effectiveSystemNetPnlUsd);
}

function sameRouteVariant(left, right) {
  if (!left?.routeKey || !right?.routeKey) return false;
  return left.routeKey === right.routeKey && String(left.amount) === String(right.amount);
}

function sameRoute(left, right) {
  return Boolean(left?.routeKey) && Boolean(right?.routeKey) && left.routeKey === right.routeKey;
}

function routeLabel(route) {
  if (!route) return null;
  if (route.label) return route.label;
  const srcChain = route.srcChain || route.route?.srcChain || null;
  const dstChain = route.dstChain || route.route?.dstChain || null;
  const srcTicker = route.srcTicker || route.srcAsset?.ticker || null;
  const dstTicker = route.dstTicker || route.dstAsset?.ticker || null;
  if (srcChain && dstChain && srcTicker && dstTicker) return `${srcChain}->${dstChain} ${srcTicker}->${dstTicker}`;
  return route.routeKey || null;
}

function appendUnique(target, values = []) {
  for (const value of values) {
    if (!value || target.includes(value)) continue;
    target.push(value);
  }
}

function blockerLabel(blocker) {
  return {
    wallet_not_checked: "wallet readiness check pending",
    native: "native gas balance missing",
    token: "source token balance missing",
    allowance: "allowance approval missing",
    missing_tx_data: "tx payload missing",
    stale_src_gas_snapshot: "source gas snapshot stale",
    exact_src_execution_gas_not_estimated: "exact execution gas pending",
    exact_src_execution_gas_reverted: "exact execution gas reverted",
    stale_dex_output_quote: "DEX output quote stale",
    implausible_quote_value_ratio: "quote value outlier",
    missing_src_token_decimals: "source token decimals missing",
    missing_dst_token_decimals: "destination token decimals missing",
    missing_src_token_price: "source token price missing",
    missing_dst_token_price: "destination token price missing",
    bitcoin_network_fee_not_modelled: "Bitcoin fee model missing",
  }[blocker] || blocker;
}

function reasonLabel(reason) {
  return {
    current_canary_is_only_viable_prep_route: "current canary is the only viable prep route",
    measured_route_not_viable_for_prep: "measured leader is not viable for prep yet",
    measured_route_tx_not_ready: "measured leader still lacks a tx-ready payload",
    measured_route_exact_gas_pending: "measured leader still needs exact gas",
    measured_route_exact_gas_blocked: "measured leader exact gas reverted and is blocked",
    measured_route_wallet_checks_pending: "measured leader still needs wallet readiness checks",
    measured_route_readiness_failure: "measured leader still has a readiness failure",
    measured_route_insufficient_data: "measured leader is still marked insufficient_data",
    measured_route_data_gaps: "measured leader still has score data gaps",
    measured_route_still_blocked: "measured leader still has blockers to clear",
  }[reason] || reason;
}

function actionLabel(action) {
  return {
    check_wallet_readiness: "wallet readiness check",
    refresh_src_gas: "source gas snapshot refresh",
    refresh_exact_gas: "exact gas estimate",
    refresh_dex_quote: "DEX quote refresh",
    refresh_market_snapshot: "market snapshot refresh",
    rerun_route_scoring: "selective route scoring",
    refresh_public_status: "status dashboard refresh",
  }[action] || action;
}

function reviewActions({ blockers = [], measuredCandidate = null, measuredScore = null }) {
  const actions = [];
  const has = (value) => blockers.includes(value);
  if (has("wallet_not_checked") || has("native") || has("token") || has("allowance") || measuredCandidate?.readinessFailureReason) {
    actions.push("check_wallet_readiness");
  }
  if (has("stale_src_gas_snapshot")) {
    actions.push("refresh_src_gas");
  }
  if (
    !has("exact_src_execution_gas_reverted") &&
    (has("stale_src_gas_snapshot") || has("exact_src_execution_gas_not_estimated") || measuredCandidate?.exactGasDone === false)
  ) {
    actions.push("refresh_exact_gas");
  }
  if (has("stale_dex_output_quote")) {
    actions.push("refresh_dex_quote");
  }
  if (measuredScore?.dataGaps?.includes("missing_src_token_price") || measuredScore?.dataGaps?.includes("missing_dst_token_price")) {
    actions.push("refresh_market_snapshot");
  }
  actions.push("rerun_route_scoring", "refresh_public_status");
  return [...new Set(actions)];
}

function fallbackScoredLeader(scoreSnapshot, currentCanary) {
  const candidates = (scoreSnapshot?.scores || [])
    .filter((item) => item?.routeKey && !sameRoute(item, currentCanary))
    .filter((item) => (preferredLeaderNetUsd(item) ?? Number.NEGATIVE_INFINITY) > 0)
    .sort(
      (left, right) =>
        (preferredLeaderNetUsd(right) ?? Number.NEGATIVE_INFINITY) - (preferredLeaderNetUsd(left) ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey).localeCompare(String(right.routeKey)) ||
        String(left.amount).localeCompare(String(right.amount)),
    );
  return candidates[0] || null;
}

export function buildCanarySelectionGap({
  routePlan = null,
  edgeViability = null,
  canaryInputs = null,
  scoreSnapshot = null,
} = {}) {
  const currentCanary = canaryInputs?.routeKey
    ? {
        routeKey: canaryInputs.routeKey,
        amount: canaryInputs.amount,
        label: canaryInputs.routeLabel || null,
        tradeReadiness: canaryInputs.scoreTradeReadiness || null,
      }
    : routePlan?.topCandidates?.[0] || null;
  const measuredLeader =
    edgeViability?.closestLoop ||
    edgeViability?.bestMeasuredLoop ||
    fallbackScoredLeader(scoreSnapshot, currentCanary) ||
    null;
  if (!currentCanary?.routeKey || !measuredLeader?.routeKey || sameRoute(currentCanary, measuredLeader)) return null;

  const scores = scoreSnapshot?.scores || [];
  const measuredScore = scores.find(
    (item) => item.routeKey === measuredLeader.routeKey && String(item.amount) === String(measuredLeader.amount),
  ) || null;
  const currentScore = scores.find(
    (item) => item.routeKey === currentCanary.routeKey && String(item.amount) === String(currentCanary.amount),
  ) || null;
  const measuredCandidate = routePlan?.candidates?.find((item) => sameRouteVariant(item, measuredLeader)) || null;
  const currentCandidate = routePlan?.candidates?.find((item) => sameRouteVariant(item, currentCanary)) || routePlan?.topCandidates?.[0] || null;

  const blockers = [];
  appendUnique(blockers, measuredCandidate?.prepBlockers || []);
  appendUnique(blockers, measuredCandidate?.readinessFailureReason ? [measuredCandidate.readinessFailureReason] : []);
  appendUnique(blockers, measuredCandidate?.scoreDisqualifiers || []);
  appendUnique(blockers, measuredScore?.dataGaps || []);

  const reasons = [];
  if (currentCandidate?.viableForPrep && measuredCandidate?.viableForPrep === false) {
    reasons.push("current_canary_is_only_viable_prep_route");
  }
  if (measuredCandidate?.viableForPrep === false) reasons.push("measured_route_not_viable_for_prep");
  if (measuredCandidate?.txReady === false) reasons.push("measured_route_tx_not_ready");
  if (blockers.includes("exact_src_execution_gas_reverted")) {
    reasons.push("measured_route_exact_gas_blocked");
  } else if (measuredCandidate?.exactGasDone === false) {
    reasons.push("measured_route_exact_gas_pending");
  }
  if ((measuredCandidate?.prepBlockers || []).length) reasons.push("measured_route_wallet_checks_pending");
  if (measuredCandidate?.readinessFailureReason) reasons.push("measured_route_readiness_failure");
  if (measuredScore?.tradeReadiness === "insufficient_data") reasons.push("measured_route_insufficient_data");
  if ((measuredScore?.dataGaps || []).length) reasons.push("measured_route_data_gaps");
  if (!reasons.length && blockers.length) reasons.push("measured_route_still_blocked");

  const blockerLabels = blockers.map(blockerLabel);
  const reasonLabels = reasons.map(reasonLabel);
  const reviewActionCodes = reviewActions({ blockers, measuredCandidate, measuredScore });
  const reviewActionLabels = reviewActionCodes.map(actionLabel);

  return {
    selectionCode: currentCandidate?.viableForPrep && measuredCandidate?.viableForPrep === false
      ? "prefer_viable_prep_route_over_measured_hypothesis"
      : "measured_route_not_ready_for_canary",
    selectionLabel: "Measured leader stays review-only until readiness and fresh-input blockers clear.",
    currentCanary: {
      routeKey: currentCanary.routeKey,
      amount: currentCanary.amount,
      label: routeLabel(currentCanary),
      tradeReadiness: currentCanary.tradeReadiness || currentCandidate?.tradeReadiness || currentScore?.tradeReadiness || null,
      netUsd: finite(currentScore?.netEdgeUsd ?? currentCandidate?.netEdgeUsd),
      executableNetUsd: finite(currentScore?.executableNetEdgeUsd ?? currentCandidate?.executableNetEdgeUsd),
      viableForPrep: currentCandidate?.viableForPrep ?? null,
    },
    measuredLeader: {
      routeKey: measuredLeader.routeKey,
      amount: measuredLeader.amount,
      label: routeLabel(measuredCandidate || measuredScore || measuredLeader),
      tradeReadiness: measuredScore?.tradeReadiness || measuredCandidate?.tradeReadiness || null,
      measuredNetUsd: finite(measuredLeader.measuredLoopNetUsd),
      scoreNetUsd: finite(measuredScore?.netEdgeUsd ?? measuredCandidate?.netEdgeUsd),
      executableNetUsd: finite(measuredScore?.executableNetEdgeUsd ?? measuredCandidate?.executableNetEdgeUsd),
      viableForPrep: measuredCandidate?.viableForPrep ?? null,
      txReady: measuredCandidate?.txReady ?? null,
      exactGasDone: measuredCandidate?.exactGasDone ?? null,
    },
    reasons,
    reasonLabels,
    blockers,
    blockerLabels,
    reviewPlan: {
      actionCodes: reviewActionCodes,
      actionLabels: reviewActionLabels,
      routeKey: measuredLeader.routeKey,
      amount: measuredLeader.amount,
      srcChain: measuredCandidate?.srcChain || measuredScore?.srcChain || null,
      dstChain: measuredCandidate?.dstChain || measuredScore?.dstChain || null,
    },
    hypothesisGuard:
      finite(measuredLeader.measuredLoopNetUsd) > 0 || finite(measuredScore?.executableNetEdgeUsd) > 0
        ? "Positive measured edge is still a hypothesis until wallet, gas, and exact execution inputs are all fresh."
        : null,
  };
}
