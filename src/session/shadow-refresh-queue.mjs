import { shellQuote } from "../lib/shell-quote.mjs";

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function readinessCommand(address, check) {
  if (!check?.routeKey || !check?.amount) return null;
  const addressArg = address ? ` --address=${shellQuote(address)}` : "";
  return `npm run check:estimator-wallet -- --route-key=${shellQuote(check.routeKey)} --amount=${shellQuote(check.amount)}${addressArg}`;
}

function shadowActionPriority(action) {
  return {
    capture_tx_payload: 95,
    check_wallet_readiness: 90,
    refresh_exact_gas: 80,
    refresh_dex_and_score: 72,
    review_candidate: 60,
    rescore_candidate: 50,
    wait_for_fresh_inputs: 0,
  }[action?.code] ?? 40;
}

function strategyPriority(kind, nextAction) {
  const priorities = {
    stable_loop: {
      expand_amount_ladder: 88,
      refresh_stable_loop_quotes: 76,
      collect_stable_loop_coverage: 64,
    },
    proxy_spread: {
      expand_amount_ladder: 86,
      expand_missing_side: 82,
      refresh_stale_quotes: 74,
      watch_proxy_surface: 62,
    },
  };
  return priorities[kind]?.[nextAction] ?? 55;
}

function strategyLabel(kind, nextAction) {
  const labels = {
    stable_loop: {
      expand_amount_ladder: "expand stable loop amount ladder",
      refresh_stable_loop_quotes: "refresh stable loop quotes",
      collect_stable_loop_coverage: "collect stable loop coverage",
    },
    proxy_spread: {
      expand_amount_ladder: "expand proxy spread amount ladder",
      expand_missing_side: "fill missing proxy spread side",
      refresh_stale_quotes: "refresh stale proxy spread quotes",
      watch_proxy_surface: "watch proxy spread surface",
    },
  };
  return labels[kind]?.[nextAction] || `${kind}:${nextAction || "unknown"}`;
}

function executionReviewPriority(plan) {
  return {
    check_wallet_readiness: 89,
    refresh_exact_gas: 87,
    refresh_dex_quote: 85,
    refresh_market_snapshot: 84,
    rerun_route_scoring: 83,
    refresh_public_status: 40,
  }[plan?.nextActionCode] ?? 82;
}

function discoveryPlanPriority(plan) {
  return {
    validate_route_durability: 84,
    collect_decay_survival: 82,
    collect_decay_coverage: 81,
    refresh_partial_loop_measurement: 79,
    repeat_route_measurement: 77,
    refresh_public_status: 40,
  }[plan?.nextActionCode] ?? 75;
}

function compareQueueItems(left, right) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const leftScope = `${left.scope || ""}:${left.code || ""}:${left.routeKey || left.kind || ""}`;
  const rightScope = `${right.scope || ""}:${right.code || ""}:${right.routeKey || right.kind || ""}`;
  return leftScope.localeCompare(rightScope);
}

function dedupeQueue(items = []) {
  const byKey = new Map();
  for (const item of items) {
    if (!item?.command) continue;
    const key = item.command;
    const existing = byKey.get(key);
    if (!existing || compareQueueItems(item, existing) < 0) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()].sort(compareQueueItems);
}

function shadowActionQueueItems(shadowActions = []) {
  return shadowActions.map((action) => ({
    priority: shadowActionPriority(action),
    kind: "shadow_action",
    scope: action.role || "shadow",
    code: action.code || null,
    label: action.actionLabel || action.code || null,
    reason: action.reason || null,
    command: action.command || null,
    routeKey: action.routeKey || null,
    routeLabel: action.label || null,
    amount: action.amount || null,
  }));
}

function strategyQueueItems(strategyPlans = null) {
  if (!strategyPlans) return [];
  const items = [];
  if (strategyPlans.stableLoop) {
    items.push({
      priority: strategyPriority("stable_loop", strategyPlans.stableLoop.nextAction),
      kind: "strategy_plan",
      scope: "stable_loop",
      code: strategyPlans.stableLoop.nextAction || null,
      label: strategyLabel("stable_loop", strategyPlans.stableLoop.nextAction),
      reason: strategyPlans.stableLoop.reason || null,
      command: strategyPlans.stableLoop.command || null,
      routeKeys: strategyPlans.stableLoop.routeKeys || [],
    });
  }
  if (strategyPlans.proxySpread) {
    items.push({
      priority: strategyPriority("proxy_spread", strategyPlans.proxySpread.nextAction),
      kind: "strategy_plan",
      scope: "proxy_spread",
      code: strategyPlans.proxySpread.nextAction || null,
      label: strategyLabel("proxy_spread", strategyPlans.proxySpread.nextAction),
      reason: strategyPlans.proxySpread.reason || null,
      command: strategyPlans.proxySpread.command || null,
      chains: strategyPlans.proxySpread.chains || [],
      proxyGroup: strategyPlans.proxySpread.proxyGroup || null,
    });
  }
  return items;
}

function objectivePlanQueueItems(objectivePlans = null) {
  if (!objectivePlans) return [];
  const items = [];
  if (objectivePlans.executionReview?.command) {
    items.push({
      priority: executionReviewPriority(objectivePlans.executionReview),
      kind: "objective_plan",
      scope: "execution_review",
      code: objectivePlans.executionReview.nextActionCode || null,
      label: objectivePlans.executionReview.nextActionLabel || "review measured route",
      reason: objectivePlans.executionReview.blockers?.[0] || objectivePlans.executionReview.selectionCode || null,
      command: objectivePlans.executionReview.command || null,
      routeKey: objectivePlans.executionReview.routeKey || null,
      routeLabel: objectivePlans.executionReview.label || null,
      amount: objectivePlans.executionReview.amount || null,
      status: objectivePlans.executionReview.status || null,
      selectionCode: objectivePlans.executionReview.selectionCode || null,
    });
  }
  if (objectivePlans.discovery?.command) {
    items.push({
      priority: discoveryPlanPriority(objectivePlans.discovery),
      kind: "objective_plan",
      scope: "strategy_discovery",
      code: objectivePlans.discovery.nextActionCode || null,
      label: objectivePlans.discovery.nextActionLabel || "refresh discovery route",
      reason: objectivePlans.discovery.reason || objectivePlans.discovery.selectionCode || null,
      command: objectivePlans.discovery.command || null,
      routeKey: objectivePlans.discovery.routeKey || null,
      routeLabel: objectivePlans.discovery.label || null,
      amount: objectivePlans.discovery.amount || null,
      status: objectivePlans.discovery.status || null,
      selectionCode: objectivePlans.discovery.selectionCode || null,
      source: objectivePlans.discovery.source || null,
    });
  }
  return items;
}

function supplementalQueueItems({
  mode = null,
  enabledRouteCount = 0,
  treasuryDecision = null,
  fundingReasonCount = 0,
} = {}) {
  return [
    mode === "CANARY_PREP_BLOCKED"
      ? {
          priority: 45,
          kind: "ops",
          scope: "canary",
          code: "advance_canary",
          label: "advance canary decision",
          reason: "canary_prep_blocked",
          command: "npm run advance:canary",
        }
      : null,
    enabledRouteCount === 0
      ? {
          priority: 35,
          kind: "ops",
          scope: "route_performance",
          code: "report_route_performance",
          label: "refresh route performance report",
          reason: "no_realized_enabled_routes",
          command: "npm run report:route-performance -- --write",
        }
      : null,
    treasuryDecision === "BLOCKED" || treasuryDecision === "REVIEW_REFILL_PLAN"
      ? {
          priority: 30,
          kind: "ops",
          scope: "treasury",
          code: "plan_treasury_actions",
          label: "refresh treasury action plan",
          reason: treasuryDecision,
          command: "npm run plan:treasury-actions -- --json",
        }
      : null,
    fundingReasonCount > 0
      ? {
          priority: 25,
          kind: "ops",
          scope: "funding",
          code: "plan_treasury_funding_sources",
          label: "refresh treasury funding sources",
          reason: "funding_sources_blocked",
          command: "npm run plan:treasury-funding-sources -- --json",
        }
      : null,
  ].filter(Boolean);
}

export function buildShadowRefreshQueue({
  shadowCycle = null,
  address = null,
  nextReadinessCheck = null,
  shadowActions = [],
  objectivePlans = null,
  strategyPlans = null,
  mode = null,
  enabledRouteCount = 0,
  treasuryDecision = null,
  fundingReasonCount = 0,
  limit = 8,
} = {}) {
  const resolvedAddress = address || shadowCycle?.address?.resolved || null;
  const resolvedNextReadinessCheck = nextReadinessCheck || shadowCycle?.canary?.nextReadinessCheck || null;
  const resolvedShadowActions = shadowActions.length ? shadowActions : shadowCycle?.shadowActions || [];
  const resolvedObjectivePlans = objectivePlans || shadowCycle?.objectivePlans || null;
  const resolvedStrategyPlans = strategyPlans || shadowCycle?.strategyPlans || null;
  const resolvedMode = mode || shadowCycle?.mode || null;
  const resolvedEnabledRouteCount = enabledRouteCount || shadowCycle?.routePerformance?.enabledCount || 0;
  const resolvedTreasuryDecision = treasuryDecision || shadowCycle?.treasury?.decision || null;
  const resolvedFundingReasonCount = fundingReasonCount || shadowCycle?.funding?.reasonCount || 0;

  const items = [
    {
      priority: 100,
      kind: "canary_readiness",
      scope: "canary",
      code: "check_wallet_readiness",
      label: "refresh canary readiness",
      reason: shadowCycle?.canary?.nextReadinessRefresh?.reason || "scheduled_readiness_check",
      command: readinessCommand(resolvedAddress, resolvedNextReadinessCheck),
      routeKey: resolvedNextReadinessCheck?.routeKey || null,
      routeLabel: resolvedNextReadinessCheck?.label || null,
      amount: resolvedNextReadinessCheck?.amount || null,
    },
    ...shadowActionQueueItems(resolvedShadowActions),
    ...objectivePlanQueueItems(resolvedObjectivePlans),
    ...strategyQueueItems(resolvedStrategyPlans),
    ...supplementalQueueItems({
      mode: resolvedMode,
      enabledRouteCount: resolvedEnabledRouteCount,
      treasuryDecision: resolvedTreasuryDecision,
      fundingReasonCount: resolvedFundingReasonCount,
    }),
  ];

  return dedupeQueue(items)
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      priority: item.priority,
      ...item,
      routeKeys: dedupe(item.routeKeys || []),
      chains: dedupe(item.chains || []),
    }));
}
