import { buildSimulationSummary } from "./execution-sim.mjs";
import { buildForkExecutionSummary } from "./fork-execution.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function routeContext({ dashboardStatus = null, reviewPackage = null, canaryInputs = null, nextStep = null } = {}) {
  const route = nextStep?.route || null;
  const candidate = reviewPackage?.policyReviewCandidate || null;
  const topRoute = dashboardStatus?.shadowCycle?.topRoute || null;
  return {
    routeKey: route?.routeKey || candidate?.routeKey || topRoute?.routeKey || canaryInputs?.routeKey || null,
    routeLabel: route?.label || candidate?.routeLabel || topRoute?.label || canaryInputs?.routeLabel || null,
    amount: route?.amount || candidate?.amount || topRoute?.amount || canaryInputs?.amount || null,
    tradeReadiness:
      route?.tradeReadiness ||
      candidate?.tradeReadiness ||
      topRoute?.tradeReadiness ||
      canaryInputs?.scoreTradeReadiness ||
      null,
  };
}

function sameSelection(record = null, route = null) {
  if (!record || !route?.routeKey || !route?.amount) return false;
  return record.routeKey === route.routeKey && String(record.amount) === String(route.amount);
}

function findExactPlan(forkPlan = null, route = null) {
  const plans = forkPlan?.plans || [];
  if (route?.routeKey && route?.amount != null) {
    return plans.find((plan) => sameSelection(plan, route)) || null;
  }
  return plans.find((plan) => plan?.selectionSource === "exact_route") || null;
}

function filterByPlanOrRoute(records = [], plan = null, route = null) {
  return (records || []).filter((record) => {
    if (plan?.planId && record?.planId === plan.planId) return true;
    return sameSelection(record, route);
  });
}

function technicalStatus(plan = null) {
  if (!plan) return "missing_plan";
  if (plan.status !== "planned") return `plan_${plan.status || "blocked"}`;
  if (!plan.transaction?.to || !plan.transaction?.data) return "planned_missing_payload";
  if (!plan.commands?.submit) return "missing_submit_command";
  return "submit_ready";
}

function economicStatus(plan = null, route = null) {
  const readiness = plan?.routeContext?.tradeReadiness || route?.tradeReadiness || null;
  if (!readiness || readiness === "shadow_candidate_review_only") return "eligible_for_policy_review";
  if (readiness === "reject_no_net_edge") return "blocked_no_net_edge";
  return `blocked_${readiness}`;
}

function freshnessBlockers(connectedRefreshPackage = null) {
  return (connectedRefreshPackage?.blockingInputs || connectedRefreshPackage?.staleInputs || []).map((item) => `${item.state}_${item.key}`);
}

function simulationCommand(route = null) {
  if (!route?.routeKey || !route?.amount) return null;
  return `npm run run:prelive-simulations -- --route-key="${route.routeKey}" --amount="${route.amount}" --write --limit=1`;
}

function planCommand(route = null) {
  if (!route?.routeKey || !route?.amount) return null;
  return `npm run plan:prelive-fork-execution -- --route-key="${route.routeKey}" --amount="${route.amount}" --write`;
}

function nextActionFor({
  route = null,
  plan = null,
  technical = null,
  economic = null,
  simulation = null,
  forkHistory = null,
  connectedRefreshPackage = null,
} = {}) {
  if (connectedRefreshPackage?.summary?.requiredRefreshCount > 0) {
    return {
      code: connectedRefreshPackage.summary.nextActionCode || "refresh_connected_inputs",
      label: "refresh connected inputs first",
      command: connectedRefreshPackage.summary.nextActionCommand || null,
    };
  }
  if ((connectedRefreshPackage?.summary?.blockedInputCount || connectedRefreshPackage?.blockedInputs?.length || 0) > 0) {
    return {
      code: connectedRefreshPackage?.nextAction?.code || connectedRefreshPackage?.summary?.nextActionCode || "hold_blocked_connected_input",
      label: "hold because a connected input is blocked",
      command: null,
    };
  }
  if (technical !== "submit_ready") {
    return {
      code: "refresh_exact_route_fork_plan",
      label: "refresh exact-route fork plan",
      command: plan?.commands?.plan || planCommand(route),
    };
  }
  if (economic !== "eligible_for_policy_review") {
    return {
      code: "hold_negative_edge",
      label: "hold fork submit until economics clear",
      command: null,
    };
  }
  if ((simulation?.successRemaining || 0) > 0) {
    return {
      code: "run_exact_route_simulations",
      label: "run more exact-route simulations",
      command: simulationCommand(route),
    };
  }
  if ((forkHistory?.successRemaining || 0) > 0) {
    return {
      code: "prepare_external_signer",
      label: "prepare externally signed fork submission",
      command: plan?.commands?.submit || null,
    };
  }
  return {
    code: "review_reconciled_fork_history",
    label: "review reconciled fork history",
    command: plan?.commands?.reconcile || null,
  };
}

function packageStatus({ technical = null, economic = null, connectedRefreshPackage = null, simulation = null, forkHistory = null } = {}) {
  if (technical === "missing_plan") return "missing_exact_route_plan";
  if (technical !== "submit_ready") return "exact_route_plan_not_ready";
  if (connectedRefreshPackage?.summary?.requiredRefreshCount > 0) return "refresh_required_before_submit";
  if (economic !== "eligible_for_policy_review") return "technical_ready_economic_blocked";
  if ((simulation?.successRemaining || 0) > 0) return "simulation_runway_remaining";
  if ((forkHistory?.successRemaining || 0) > 0) return "prelive_submit_ready";
  return "fork_cycle_proven";
}

export function buildExactRouteForkPackage({
  dashboardStatus = null,
  canaryInputs = null,
  reviewPackage = null,
  nextStep = null,
  forkPlan = null,
  simulationRuns = [],
  submissions = [],
  receipts = [],
  connectedRefreshPackage = null,
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const route = routeContext({ dashboardStatus, reviewPackage, canaryInputs, nextStep });
  const plan = findExactPlan(forkPlan, route);
  const technical = technicalStatus(plan);
  const economic = economicStatus(plan, route);
  const matchedSimulationRuns = filterByPlanOrRoute(simulationRuns, plan, route);
  const matchedSubmissions = filterByPlanOrRoute(submissions, plan, route);
  const matchedReceipts = filterByPlanOrRoute(receipts, plan, route);
  const simulation = buildSimulationSummary(matchedSimulationRuns, {
    targetSuccessCount: dashboardStatus?.prelive?.mechanicalSimulation?.targetSuccessCount || 50,
  });
  const forkHistory = buildForkExecutionSummary({
    plans: plan ? [plan] : [],
    submissions: matchedSubmissions,
    receipts: matchedReceipts,
    targetConfirmedCount: dashboardStatus?.prelive?.forkExecution?.targetConfirmedCount || 3,
  });
  const blockers = unique([
    ...(plan?.blockers || []),
    ...freshnessBlockers(connectedRefreshPackage),
    economic !== "eligible_for_policy_review" ? economic : null,
    (simulation?.successRemaining || 0) > 0 ? `needs_${simulation.successRemaining}_more_simulations` : null,
    (forkHistory?.successRemaining || 0) > 0 ? `needs_${forkHistory.successRemaining}_more_confirmed_fork_cycles` : null,
  ]);
  const nextAction = nextActionFor({ route, plan, technical, economic, simulation, forkHistory, connectedRefreshPackage });

  return {
    schemaVersion: 1,
    generatedAt,
    status: packageStatus({ technical, economic, connectedRefreshPackage, simulation, forkHistory }),
    currentRoute: route,
    plan: plan
      ? {
          planId: plan.planId || null,
          status: plan.status || null,
          routeKey: plan.routeKey || null,
          routeLabel: plan.routeLabel || null,
          amount: plan.amount || null,
          selectionSource: plan.selectionSource || null,
          selectionCode: plan.selectionCode || null,
          targetEnvironment: plan.targetEnvironment || null,
          transaction: {
            to: plan.transaction?.to || null,
            txDataBytes: plan.transaction?.txDataBytes ?? null,
            valueWei: plan.transaction?.valueWei || null,
          },
          signer: {
            required: Boolean(plan.signer?.required),
            mode: plan.signer?.mode || null,
          },
          commands: {
            plan: plan.commands?.plan || null,
            submit: plan.commands?.submit || null,
            reconcile: plan.commands?.reconcile || null,
            resolveOutput: plan.commands?.resolveOutput || null,
          },
        }
      : null,
    readiness: {
      technicalStatus: technical,
      economicStatus: economic,
      validationStatus: reviewPackage?.preliveValidation?.validationStatus || null,
      liveTradingPolicy: dashboardStatus?.overall?.liveTrading || "BLOCKED",
    },
    integrity: {
      routeMatchesCurrentCanary: sameSelection(plan, route),
      transactionReady: Boolean(plan?.transaction?.to && plan?.transaction?.data),
      submitCommandPresent: Boolean(plan?.commands?.submit),
      reconcileCommandPresent: Boolean(plan?.commands?.reconcile),
      externalSignerRequired: Boolean(plan?.signer?.required),
      liveTradingBlocked: (dashboardStatus?.overall?.liveTrading || "BLOCKED") === "BLOCKED",
    },
    simulation,
    forkHistory,
    blockers,
    warnings: unique([
      (dashboardStatus?.overall?.liveTrading || "BLOCKED") === "BLOCKED" ? "live_execution_locked" : null,
      economic !== "eligible_for_policy_review" ? "technical_readiness_does_not_override_negative_edge" : null,
      connectedRefreshPackage?.summary?.requiredRefreshCount > 0 ? "refresh_required_before_any_fork_submit" : null,
      (connectedRefreshPackage?.summary?.blockedInputCount || connectedRefreshPackage?.blockedInputs?.length || 0) > 0
        ? "blocked_connected_input_prevents_exact_route_progress"
        : null,
      plan?.signer?.required ? "external_signer_required" : null,
    ]),
    nextAction,
    commands: {
      refreshInputs: connectedRefreshPackage?.summary?.fullCommandChain || null,
      plan: plan?.commands?.plan || planCommand(route),
      simulate: simulationCommand(route),
      submit: plan?.commands?.submit || null,
      reconcile: plan?.commands?.reconcile || null,
      resolveOutput: plan?.commands?.resolveOutput || null,
    },
    notes: [
      "This package separates technical submit-readiness from economic readiness; a planned fork transaction is not a permission to submit.",
      "Use the exact-route package to inspect the current canary route only. Objective-route planning can still diverge from the current canary.",
      "Private keys remain outside this package. Fork submission must stay externally signed.",
    ],
  };
}

export function summarizeExactRouteForkPackage(forkPackage = null) {
  if (!forkPackage) return null;
  return {
    generatedAt: forkPackage.generatedAt || null,
    status: forkPackage.status || null,
    planId: forkPackage.plan?.planId || null,
    routeKey: forkPackage.currentRoute?.routeKey || null,
    routeLabel: forkPackage.currentRoute?.routeLabel || null,
    amount: forkPackage.currentRoute?.amount || null,
    technicalStatus: forkPackage.readiness?.technicalStatus || null,
    economicStatus: forkPackage.readiness?.economicStatus || null,
    simulationSuccessCount: forkPackage.simulation?.successCount ?? 0,
    simulationTargetCount: forkPackage.simulation?.targetSuccessCount ?? 0,
    forkConfirmedCount: forkPackage.forkHistory?.confirmedCount ?? 0,
    forkTargetCount: forkPackage.forkHistory?.targetConfirmedCount ?? 0,
    nextActionCode: forkPackage.nextAction?.code || null,
    nextActionCommand: forkPackage.nextAction?.command || null,
  };
}
