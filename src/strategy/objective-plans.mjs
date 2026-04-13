import { buildCanarySelectionGap } from "./canary-selection-gap.mjs";
import { buildEdgeResearchSummary } from "./edge-research.mjs";
import { buildEdgeViabilitySummary } from "./edge-viability.mjs";
import { shellQuote } from "../lib/shell-quote.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function selectionKey(routeKey, amount) {
  if (!routeKey || !amount) return null;
  return `${routeKey}|${amount}`;
}

function sameSelection(left, right) {
  return Boolean(left?.routeKey && right?.routeKey) && left.routeKey === right.routeKey && String(left.amount) === String(right.amount);
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

function bestScoreForRoute(scoreSnapshot, routeKey, amount = null) {
  const scores = (scoreSnapshot?.scores || [])
    .filter((item) => item?.routeKey === routeKey)
    .filter((item) => !amount || String(item.amount) === String(amount))
    .sort(
      (left, right) =>
        (right.executableNetEdgeUsd ?? right.netEdgeUsd ?? Number.NEGATIVE_INFINITY) -
          (left.executableNetEdgeUsd ?? left.netEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
        String(left.amount).localeCompare(String(right.amount)),
    );
  return scores[0] || null;
}

function reviewActionLabel(action) {
  return {
    check_wallet_readiness: "wallet readiness check",
    refresh_exact_gas: "exact gas estimate",
    refresh_dex_quote: "DEX quote refresh",
    refresh_market_snapshot: "market snapshot refresh",
    rerun_route_scoring: "selective route scoring",
    refresh_public_status: "status dashboard refresh",
  }[action] || action;
}

function routeRefreshActionLabel(action) {
  return {
    validate_route_durability: "validate route durability",
    collect_decay_survival: "collect decay survival samples",
    collect_decay_coverage: "collect decay coverage samples",
    repeat_route_measurement: "repeat route measurement",
    refresh_partial_loop_measurement: "refresh partial loop measurement",
    refresh_public_status: "status dashboard refresh",
  }[action] || action;
}

function readinessCommand(address, routeKey, amount) {
  if (!routeKey || !amount) return null;
  const addressArg = address ? ` --address=${shellQuote(address)}` : "";
  return `npm run check:estimator-wallet -- --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)}${addressArg}`;
}

function exactGasCommand(address, routeKey, amount) {
  if (!routeKey || !amount) return null;
  const fromArg = address ? ` --from=${shellQuote(address)}` : "";
  return `npm run estimate:gateway-gas -- --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)}${fromArg}`;
}

function dexQuoteCommand(routeKey, amount) {
  if (!routeKey || !amount) return null;
  return `npm run quote:dex -- --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)} --include-stable-entry`;
}

function scoreCommand(routeKey, amount) {
  if (!routeKey || !amount) return null;
  return `npm run score:gateway -- --write --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)}`;
}

function verifyGatewayCommand(routeKey, amount) {
  if (!routeKey || !amount) return null;
  return `npm run verify:gateway -- --route-key=${shellQuote(routeKey)} --amounts=${shellQuote(amount)}`;
}

function routeMeasurementCommand(routeKey, amount) {
  const verify = verifyGatewayCommand(routeKey, amount);
  const dex = dexQuoteCommand(routeKey, amount);
  const score = scoreCommand(routeKey, amount);
  return [verify, dex, score].filter(Boolean).join(" && ") || null;
}

function currentCanarySelection({ routePlan = null, canaryInputs = null } = {}) {
  if (canaryInputs?.routeKey && canaryInputs?.amount) {
    return {
      routeKey: canaryInputs.routeKey,
      amount: canaryInputs.amount,
      label: canaryInputs.routeLabel || null,
    };
  }
  return routePlan?.topCandidates?.[0] || null;
}

function buildExecutionReviewPlan({ routePlan = null, canaryInputs = null, scoreSnapshot = null, edgeViability = null, address = null } = {}) {
  const gap = buildCanarySelectionGap({
    routePlan,
    edgeViability,
    canaryInputs,
    scoreSnapshot,
  });
  if (!gap?.measuredLeader?.routeKey || !gap.reviewPlan?.actionCodes?.length) return null;

  const steps = gap.reviewPlan.actionCodes
    .map((code) => {
      const routeKey = gap.reviewPlan.routeKey;
      const amount = gap.reviewPlan.amount;
      const command =
        code === "check_wallet_readiness"
          ? readinessCommand(address, routeKey, amount)
          : code === "refresh_exact_gas"
            ? exactGasCommand(address, routeKey, amount)
            : code === "refresh_dex_quote"
              ? dexQuoteCommand(routeKey, amount)
              : code === "refresh_market_snapshot"
                ? "npm run price:snapshot"
                : code === "rerun_route_scoring"
                  ? scoreCommand(routeKey, amount)
                  : code === "refresh_public_status"
                    ? "npm run status:dashboard"
                    : null;
      return {
        code,
        label: reviewActionLabel(code),
        command,
      };
    })
    .filter((step) => step.label);

  const nextStep = steps.find((step) => step.command) || null;
  if (!nextStep) return null;

  return {
    status:
      gap.selectionCode === "prefer_viable_prep_route_over_measured_hypothesis"
        ? "measured_hypothesis_under_review"
        : "measured_route_under_review",
    selectionCode: gap.selectionCode,
    selectionLabel: gap.selectionLabel,
    routeKey: gap.measuredLeader.routeKey,
    amount: gap.measuredLeader.amount,
    label: gap.measuredLeader.label || routeLabel(gap.measuredLeader),
    tradeReadiness: gap.measuredLeader.tradeReadiness || null,
    measuredNetUsd: finite(gap.measuredLeader.measuredNetUsd),
    scoreNetUsd: finite(gap.measuredLeader.scoreNetUsd),
    executableNetUsd: finite(gap.measuredLeader.executableNetUsd),
    viableForPrep: gap.measuredLeader.viableForPrep ?? null,
    txReady: gap.measuredLeader.txReady ?? null,
    exactGasDone: gap.measuredLeader.exactGasDone ?? null,
    reasons: gap.reasons || [],
    reasonLabels: gap.reasonLabels || [],
    blockers: gap.blockers || [],
    blockerLabels: gap.blockerLabels || [],
    currentCanary: gap.currentCanary || null,
    hypothesisGuard: gap.hypothesisGuard || null,
    nextActionCode: nextStep.code,
    nextActionLabel: nextStep.label,
    command: nextStep.command,
    stepCount: steps.length,
    steps,
  };
}

function discoveryPriority(classification) {
  return {
    definite_edge_candidate: 0,
    multi_level_candidate: 1,
    missing_decay_survival: 2,
    missing_decay_coverage: 3,
    single_level_only: 4,
    partial_loop_measurement: 5,
    loop_observable: 6,
    no_edge: 7,
  }[classification] ?? 99;
}

function findDiscoveryLoop({
  edgeViability = null,
  edgeResearch = null,
  routePlan = null,
  canaryInputs = null,
  executionReview = null,
} = {}) {
  const currentCanary = currentCanarySelection({ routePlan, canaryInputs });
  const excluded = new Set(
    [
      selectionKey(currentCanary?.routeKey, currentCanary?.amount),
      selectionKey(executionReview?.routeKey, executionReview?.amount),
    ].filter(Boolean),
  );
  const excludedRouteKeys = new Set([currentCanary?.routeKey, executionReview?.routeKey].filter(Boolean));
  const researchByRoute = new Map((edgeResearch?.routes || []).map((item) => [item.routeKey, item]));
  return (edgeViability?.loops || [])
    .filter((loop) => Number.isFinite(loop?.measuredLoopNetUsd))
    .filter((loop) => !excluded.has(selectionKey(loop.routeKey, loop.amount)))
    .filter((loop) => !excludedRouteKeys.has(loop.routeKey))
    .sort(
      (left, right) =>
        discoveryPriority(researchByRoute.get(left.routeKey)?.classification) -
          discoveryPriority(researchByRoute.get(right.routeKey)?.classification) ||
        ((left.gapToPolicyUsd ?? Number.POSITIVE_INFINITY) - (right.gapToPolicyUsd ?? Number.POSITIVE_INFINITY)) ||
        ((right.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) - (left.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY)) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    )[0] || null;
}

function discoveryActionFromSignals(loop, researchRoute = null) {
  const classification = researchRoute?.classification || null;
  if (classification === "definite_edge_candidate" || classification === "multi_level_candidate") {
    return {
      status: classification,
      nextActionCode: "validate_route_durability",
      reason: classification,
    };
  }
  if (classification === "missing_decay_survival") {
    return {
      status: classification,
      nextActionCode: "collect_decay_survival",
      reason: classification,
    };
  }
  if (classification === "missing_decay_coverage") {
    return {
      status: classification,
      nextActionCode: "collect_decay_coverage",
      reason: classification,
    };
  }
  if (classification === "single_level_only") {
    return {
      status: classification,
      nextActionCode: "repeat_route_measurement",
      reason: classification,
    };
  }
  if ((loop?.gapToPolicyUsd ?? Number.POSITIVE_INFINITY) <= 0) {
    return {
      status: "policy_ready_measured_loop",
      nextActionCode: "validate_route_durability",
      reason: "policy_ready_measured_loop",
    };
  }
  if ((loop?.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) > 0) {
    return {
      status: "positive_measured_loop",
      nextActionCode: "validate_route_durability",
      reason: "positive_measured_loop",
    };
  }
  return {
    status: "partial_loop_measurement",
    nextActionCode: "refresh_partial_loop_measurement",
    reason: "secondary_measured_loop",
  };
}

function buildDiscoveryPlan({
  routePlan = null,
  canaryInputs = null,
  scoreSnapshot = null,
  edgeViability = null,
  edgeResearch = null,
  executionReview = null,
} = {}) {
  const selectedLoop = findDiscoveryLoop({
    edgeViability,
    edgeResearch,
    routePlan,
    canaryInputs,
    executionReview,
  });

  if (selectedLoop?.routeKey && selectedLoop?.amount) {
    const score = bestScoreForRoute(scoreSnapshot, selectedLoop.routeKey, selectedLoop.amount);
    const researchRoute = (edgeResearch?.routes || []).find((item) => item.routeKey === selectedLoop.routeKey) || null;
    const action = discoveryActionFromSignals(selectedLoop, researchRoute);
    const steps = [
      {
        code: action.nextActionCode,
        label: routeRefreshActionLabel(action.nextActionCode),
        command: routeMeasurementCommand(selectedLoop.routeKey, selectedLoop.amount),
      },
      {
        code: "refresh_public_status",
        label: routeRefreshActionLabel("refresh_public_status"),
        command: "npm run status:dashboard",
      },
    ];
    return {
      source: "secondary_measured_loop",
      sourceLabel: "secondary measured loop",
      status: action.status,
      selectionCode: "secondary_measured_loop",
      selectionLabel: "Use the next measured loop to widen objective route discovery without promoting it to canary prematurely.",
      routeKey: selectedLoop.routeKey,
      amount: selectedLoop.amount,
      label: routeLabel(score || selectedLoop),
      classification: researchRoute?.classification || null,
      measuredNetUsd: finite(selectedLoop.measuredLoopNetUsd),
      gapToPolicyUsd: finite(selectedLoop.gapToPolicyUsd),
      requiredNetProfitUsd: finite(selectedLoop.requiredNetProfitUsd),
      bestNetEdgeUsd: finite(researchRoute?.bestNetEdgeUsd ?? score?.executableNetEdgeUsd ?? score?.netEdgeUsd),
      profitableLevels: researchRoute?.profitableLevels ?? null,
      amountLevels: researchRoute?.amountLevels ?? null,
      nextActionCode: action.nextActionCode,
      nextActionLabel: routeRefreshActionLabel(action.nextActionCode),
      reason: action.reason,
      command: steps[0].command,
      stepCount: steps.length,
      steps,
    };
  }

  const currentCanary = currentCanarySelection({ routePlan, canaryInputs });
  const researchRoute = (edgeResearch?.routes || [])
    .filter((item) => !["no_edge", "failure_rate_too_high", "reject_outlier"].includes(item.classification))
    .filter((item) => item.routeKey !== currentCanary?.routeKey)
    .filter((item) => item.routeKey !== executionReview?.routeKey)
    .sort(
      (left, right) =>
        discoveryPriority(left.classification) - discoveryPriority(right.classification) ||
        (right.profitableLevels - left.profitableLevels) ||
        ((right.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY) - (left.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY)) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    )[0] || null;
  if (!researchRoute?.routeKey) return null;

  const score = bestScoreForRoute(scoreSnapshot, researchRoute.routeKey);
  if (!score?.routeKey || !score?.amount) return null;
  const action = discoveryActionFromSignals(null, researchRoute);
  const steps = [
    {
      code: action.nextActionCode,
      label: routeRefreshActionLabel(action.nextActionCode),
      command: routeMeasurementCommand(score.routeKey, score.amount),
    },
    {
      code: "refresh_public_status",
      label: routeRefreshActionLabel("refresh_public_status"),
      command: "npm run status:dashboard",
    },
  ];
  return {
    source: "edge_research_route",
    sourceLabel: "edge research route",
    status: action.status,
    selectionCode: "edge_research_route",
    selectionLabel: "Use the strongest non-outlier research route to collect more objective durability evidence.",
    routeKey: score.routeKey,
    amount: score.amount,
    label: routeLabel(score),
    classification: researchRoute.classification,
    measuredNetUsd: null,
    gapToPolicyUsd: null,
    requiredNetProfitUsd: null,
    bestNetEdgeUsd: finite(researchRoute.bestNetEdgeUsd ?? score.executableNetEdgeUsd ?? score.netEdgeUsd),
    profitableLevels: researchRoute.profitableLevels ?? null,
    amountLevels: researchRoute.amountLevels ?? null,
    nextActionCode: action.nextActionCode,
    nextActionLabel: routeRefreshActionLabel(action.nextActionCode),
    reason: action.reason,
    command: steps[0].command,
    stepCount: steps.length,
    steps,
  };
}

export function buildObjectivePlans({
  routePlan = null,
  canaryInputs = null,
  scoreSnapshot = null,
  shadowObservations = [],
  dexQuotes = [],
  edgeViability = null,
  edgeResearch = null,
  address = null,
} = {}) {
  const resolvedEdgeViability = edgeViability || buildEdgeViabilitySummary({ scoreSnapshot, dexQuotes });
  const resolvedEdgeResearch = edgeResearch || buildEdgeResearchSummary({ scoreSnapshot, shadowObservations });
  const executionReview = buildExecutionReviewPlan({
    routePlan,
    canaryInputs,
    scoreSnapshot,
    edgeViability: resolvedEdgeViability,
    address,
  });
  const discovery = buildDiscoveryPlan({
    routePlan,
    canaryInputs,
    scoreSnapshot,
    edgeViability: resolvedEdgeViability,
    edgeResearch: resolvedEdgeResearch,
    executionReview,
  });

  return {
    executionReview,
    discovery,
  };
}
