function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function routeContext({ dashboardStatus = null, reviewPackage = null, canaryInputs = null, nextStep = null } = {}) {
  const route = nextStep?.route || null;
  const candidate = reviewPackage?.manualReviewCandidate || null;
  const topRoute = dashboardStatus?.shadowCycle?.topRoute || null;
  return {
    routeKey: route?.routeKey || candidate?.routeKey || null,
    routeLabel: route?.label || candidate?.routeLabel || topRoute?.label || canaryInputs?.routeLabel || null,
    amount: route?.amount || candidate?.amount || topRoute?.amount || canaryInputs?.amount || null,
    srcChain: route?.srcChain || null,
    dstChain: route?.dstChain || null,
    tradeReadiness:
      route?.tradeReadiness ||
      candidate?.tradeReadiness ||
      topRoute?.tradeReadiness ||
      canaryInputs?.scoreTradeReadiness ||
      null,
  };
}

function blockingInputs(canaryInputs = null) {
  if (!canaryInputs) return [];
  const fields = [
    ["gatewayQuote", "gateway_quote", "gateway quote"],
    ["exactGas", "exact_gas", "exact gas"],
    ["srcGas", "src_gas", "source gas"],
    ["dexQuote", "dex_quote", "DEX quote"],
    ["bitcoinFee", "bitcoin_fee", "bitcoin fee"],
    ["marketSnapshot", "market", "market snapshot"],
  ];
  return fields
    .map(([field, key, label]) => ({
      field,
      key,
      label,
      state: canaryInputs?.[field]?.state || "unknown",
      observedAt: canaryInputs?.[field]?.observedAt || null,
      ageMinutes: Number.isFinite(canaryInputs?.[field]?.ageMinutes) ? canaryInputs[field].ageMinutes : null,
    }))
    .filter((item) => item.state === "missing" || item.state === "stale" || item.state === "blocked");
}

function inputBlockerCode(problem = null) {
  if (!problem?.key || !problem?.state) return null;
  return `${problem.state}_${problem.key}`;
}

function quoteDexCommand(route = null) {
  const chains = unique([route?.srcChain, route?.dstChain]);
  return chains.length ? `npm run quote:dex -- --chains=${chains.join(",")} --include-stable-entry --route-limit=64` : null;
}

function commandForInput(problem = null, route = null, address = null) {
  if (!problem) return null;
  if (problem.state === "blocked") return null;
  if (problem.key === "gateway_quote" && route?.routeKey && route?.amount) {
    return `npm run verify:gateway -- --route-key="${route.routeKey}" --amounts="${route.amount}"`;
  }
  if (problem.key === "exact_gas" && route?.routeKey && route?.amount) {
    const parts = [`npm run estimate:gateway-gas -- --route-key="${route.routeKey}" --amount="${route.amount}"`];
    if (address) {
      return `npm run estimate:gateway-gas -- --from="${address}" --route-key="${route.routeKey}" --amount="${route.amount}"`;
    }
    return parts[0];
  }
  if (problem.key === "src_gas") return "npm run gas:snapshot";
  if (problem.key === "dex_quote") return quoteDexCommand(route);
  if (problem.key === "bitcoin_fee") return "npm run bitcoin:fees";
  if (problem.key === "market") return "npm run price:snapshot";
  return null;
}

function stageState(complete, blockers = []) {
  if (complete) return "complete";
  if ((blockers || []).length > 0) return "blocked";
  return "in_progress";
}

function cloneAction(action = null) {
  if (!action) return null;
  return {
    code: action.code || null,
    label: action.label || null,
    command: action.command || null,
    manualStep: action.manualStep || null,
  };
}

function strategyCandidateNextAction(reviewPackage = null) {
  const candidate = reviewPackage?.primaryLiveCandidate || reviewPackage?.manualReviewCandidate || null;
  if (candidate?.candidateType !== "strategy" || reviewPackage?.readyForManualReview) return null;
  return cloneAction(reviewPackage?.remediationPlan?.nextAction || candidate?.nextAction || null);
}

function shadowNextAction({ reviewPackage = null, problems = [], route = null, address = null } = {}) {
  const strategyAction = strategyCandidateNextAction(reviewPackage);
  if (strategyAction) return strategyAction;
  const refreshableProblem = problems.find((problem) => problem.state === "missing" || problem.state === "stale") || null;
  const blockedProblem = problems.find((problem) => problem.state === "blocked") || null;
  if (!refreshableProblem && blockedProblem) {
    return {
      code: `hold_${blockedProblem.key}`,
      label: `hold on blocked ${blockedProblem.label}`,
      command: null,
      manualStep: null,
    };
  }
  if (reviewPackage?.remediationPlan?.nextAction) {
    return cloneAction(reviewPackage.remediationPlan.nextAction);
  }
  const firstProblem = refreshableProblem || problems[0] || null;
  if (firstProblem) {
    if (firstProblem.state === "blocked") {
      return {
        code: `hold_${firstProblem.key}`,
        label: `hold on blocked ${firstProblem.label}`,
        command: null,
        manualStep: null,
      };
    }
    return {
      code: `refresh_${firstProblem.key}`,
      label: `refresh ${firstProblem.label}`,
      command: commandForInput(firstProblem, route, address),
      manualStep: null,
    };
  }
  return {
    code: "run_shadow_cycle",
    label: "run shadow cycle",
    command: "npm run run:shadow-cycle -- --write",
    manualStep: null,
  };
}

function mechanicalNextAction({ shadowComplete = false, prelive = null } = {}) {
  if (!shadowComplete) {
    return {
      code: "wait_for_shadow_replay",
      label: "complete shadow evidence first",
      command: null,
      manualStep: null,
    };
  }
  const successCount = prelive?.mechanicalSimulation?.successCount || 0;
  const targetSuccessCount = prelive?.mechanicalSimulation?.targetSuccessCount || 50;
  const remaining = Math.max(0, targetSuccessCount - successCount);
  return {
    code: "run_mechanical_simulations",
    label: "run mechanical simulations",
    command: `npm run run:prelive-simulations -- --write --source=objective --limit=${Math.max(1, Math.min(4, remaining || 1))}`,
    manualStep: null,
  };
}

function forkNextAction({ mechanicalComplete = false, prelive = null } = {}) {
  if (!mechanicalComplete) {
    return {
      code: "wait_for_mechanical_simulation",
      label: "complete mechanical simulations first",
      command: null,
      manualStep: null,
    };
  }
  if ((prelive?.forkExecution?.pendingOutputCount || 0) > 0) {
    return {
      code: "reconcile_fork_execution",
      label: "reconcile fork execution",
      command: "npm run reconcile:prelive-fork-execution",
      manualStep: null,
    };
  }
  if ((prelive?.forkExecution?.planCount || 0) <= 0) {
    return {
      code: "plan_fork_execution",
      label: "plan fork execution",
      command: "npm run plan:prelive-fork-execution -- --source=objective --write",
      manualStep: null,
    };
  }
  return {
    code: "prepare_external_signed_fork_submission",
    label: "prepare externally signed fork submission",
    command: "npm run plan:prelive-fork-execution -- --source=objective --write",
    manualStep:
      "After refreshing the fork plan, submit with an external signer via npm run submit:prelive-fork-execution -- --plan-id=<planId> --signed-tx-file=<path> --rpc-url=<forkRpc>.",
  };
}

function reviewNextAction(reviewPackage = null) {
  if (reviewPackage?.readyForManualReview) {
    return {
      code: "manual_canary_review_only",
      label: "manual canary review only",
      command: null,
      manualStep: "Keep liveTrading BLOCKED and review the candidate manually before any architecture change.",
    };
  }
  const strategyAction = strategyCandidateNextAction(reviewPackage);
  if (strategyAction) return strategyAction;
  if (reviewPackage?.remediationPlan?.nextAction) {
    return cloneAction(reviewPackage.remediationPlan.nextAction);
  }
  if (reviewPackage?.remediationPlan?.runnerCommand) {
    return {
      code: "run_admission_remediation",
      label: "run admission remediation",
      command: reviewPackage.remediationPlan.runnerCommand,
      manualStep: null,
    };
  }
  return {
    code: "refresh_review_package",
    label: "refresh review package",
    command: "npm run build:prelive-review-package -- --write",
    manualStep: null,
  };
}

function summarizeExactRouteForkPlan({ forkPlan = null, route = null } = {}) {
  const plans = forkPlan?.plans || [];
  const exactPlan =
    plans.find((item) => item?.routeKey === route?.routeKey && String(item?.amount) === String(route?.amount)) ||
    plans.find((item) => item?.selectionSource === "exact_route") ||
    null;
  if (!exactPlan) return null;
  return {
    planId: exactPlan.planId || null,
    status: exactPlan.status || null,
    routeKey: exactPlan.routeKey || null,
    routeLabel: exactPlan.routeLabel || null,
    amount: exactPlan.amount || null,
    selectionSource: exactPlan.selectionSource || null,
    selectionCode: exactPlan.selectionCode || null,
    tradeReadiness: exactPlan.routeContext?.tradeReadiness || null,
    netEdgeUsd: exactPlan.routeContext?.netEdgeUsd ?? null,
    txTo: exactPlan.transaction?.to || null,
    txDataBytes: exactPlan.transaction?.txDataBytes ?? null,
    submitCommand: exactPlan.commands?.submit || null,
    reconcileCommand: exactPlan.commands?.reconcile || null,
    resolveOutputCommand: exactPlan.commands?.resolveOutput || null,
    signerRequired: Boolean(exactPlan.signer?.required),
  };
}

export function buildExecutionRunbook({
  dashboardStatus = null,
  reviewPackage = null,
  strategySnapshot = null,
  canaryInputs = null,
  nextStep = null,
  forkPlan = null,
  address = null,
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const prelive = dashboardStatus?.prelive || {};
  const route = routeContext({ dashboardStatus, reviewPackage, canaryInputs, nextStep });
  const problems = blockingInputs(canaryInputs);
  const shadowComplete =
    Boolean(prelive?.shadowReplay?.ready) ||
    prelive?.shadowReplay?.status === "ready_for_mechanical_simulation" ||
    ["mechanical_simulation", "fork_execution", "tiny_live_canary_review"].includes(prelive?.currentStage);
  const mechanicalComplete =
    Boolean(prelive?.mechanicalSimulation?.ready) ||
    prelive?.mechanicalSimulation?.status === "mechanical_path_proven" ||
    ["fork_execution", "tiny_live_canary_review"].includes(prelive?.currentStage);
  const forkComplete =
    Boolean(prelive?.forkExecution?.ready) ||
    prelive?.forkExecution?.status === "fork_execution_proven" ||
    prelive?.currentStage === "tiny_live_canary_review";
  const reviewReady = Boolean(reviewPackage?.readyForManualReview || prelive?.tinyLiveCanary?.ready);
  const exactRouteForkPlan = summarizeExactRouteForkPlan({ forkPlan, route });

  const stages = [
    {
      id: "shadow_replay",
      label: "Shadow evidence",
      sequence: 1,
      current: prelive?.currentStage === "shadow_replay",
      complete: shadowComplete,
      state: stageState(shadowComplete, shadowComplete ? [] : unique([...(prelive?.shadowReplay?.blockers || []), ...problems.map(inputBlockerCode)])),
      status: prelive?.shadowReplay?.status || null,
      blockers: shadowComplete ? [] : unique([...(prelive?.shadowReplay?.blockers || []), ...problems.map(inputBlockerCode)]),
      progress: {
        policyReadyMeasuredRoutes: prelive?.shadowReplay?.policyReadyMeasuredRoutes ?? 0,
        executionReviewRoute: prelive?.shadowReplay?.executionReviewRoute || null,
        blockingInputCount: problems.length,
      },
      requiredEvidence: [
        "fresh gateway quote",
        "fresh exact gas",
        "fresh source gas",
        "fresh DEX quote",
        "fresh market snapshot",
      ],
      nextAction: shadowComplete ? null : shadowNextAction({ reviewPackage, problems, route, address }),
      route,
    },
    {
      id: "mechanical_simulation",
      label: "Mechanical simulation",
      sequence: 2,
      current: prelive?.currentStage === "mechanical_simulation",
      complete: mechanicalComplete,
      state: stageState(mechanicalComplete, mechanicalComplete ? [] : prelive?.mechanicalSimulation?.blockers || []),
      status: prelive?.mechanicalSimulation?.status || null,
      blockers: mechanicalComplete ? [] : prelive?.mechanicalSimulation?.blockers || [],
      progress: {
        successCount: prelive?.mechanicalSimulation?.successCount ?? 0,
        targetSuccessCount: prelive?.mechanicalSimulation?.targetSuccessCount ?? 0,
        failureCount: prelive?.mechanicalSimulation?.failureCount ?? 0,
      },
      requiredEvidence: [
        "successful eth_call simulation samples",
        "no unresolved simulation failures",
      ],
      nextAction: mechanicalComplete ? null : mechanicalNextAction({ shadowComplete, prelive }),
      route,
    },
    {
      id: "fork_execution",
      label: "Fork execution",
      sequence: 3,
      current: prelive?.currentStage === "fork_execution",
      complete: forkComplete,
      state: stageState(forkComplete, forkComplete ? [] : prelive?.forkExecution?.blockers || []),
      status: prelive?.forkExecution?.status || null,
      blockers: forkComplete ? [] : prelive?.forkExecution?.blockers || [],
      progress: {
        planCount: prelive?.forkExecution?.planCount ?? 0,
        submittedCount: prelive?.forkExecution?.submittedCount ?? 0,
        confirmedCount: prelive?.forkExecution?.confirmedCount ?? 0,
        targetConfirmedCount: prelive?.forkExecution?.targetConfirmedCount ?? 0,
        pendingOutputCount: prelive?.forkExecution?.pendingOutputCount ?? 0,
        failedCount: prelive?.forkExecution?.failedCount ?? 0,
      },
      requiredEvidence: [
        "externally signed fork transactions",
        "confirmed fork receipts",
        "execution journal and receipt records in sync",
      ],
      nextAction: forkComplete ? null : forkNextAction({ mechanicalComplete, prelive }),
      route,
    },
    {
      id: "manual_canary_review",
      label: "Manual canary review",
      sequence: 4,
      current: prelive?.currentStage === "tiny_live_canary_review",
      complete: reviewReady,
      state: stageState(reviewReady, reviewReady ? [] : unique([...(reviewPackage?.reviewBlockers || []), ...(prelive?.tinyLiveCanary?.blockers || [])])),
      status: reviewPackage?.packageStatus || prelive?.tinyLiveCanary?.status || null,
      blockers: reviewReady ? [] : unique([...(reviewPackage?.reviewBlockers || []), ...(prelive?.tinyLiveCanary?.blockers || [])]),
      progress: {
        readyForManualReview: reviewReady,
        liveTradingPolicy: dashboardStatus?.overall?.liveTrading || prelive?.liveTradingPolicy || "BLOCKED",
      },
      requiredEvidence: [
        "shadow replay ready",
        "mechanical simulations proven",
        "fork execution proven",
        "manual approval only while liveTrading stays BLOCKED",
      ],
      nextAction: reviewNextAction(reviewPackage),
      route,
    },
  ];

  const nextStage = stages.find((stage) => !stage.complete) || stages.at(-1) || null;
  const nextAction = nextStage?.nextAction || reviewNextAction(reviewPackage);

  return {
    schemaVersion: 1,
    generatedAt,
    liveTradingPolicy: dashboardStatus?.overall?.liveTrading || prelive?.liveTradingPolicy || "BLOCKED",
    executionLock: {
      liveTrading: dashboardStatus?.overall?.liveTrading || prelive?.liveTradingPolicy || "BLOCKED",
      executionPermission: false,
      reason: "pre_execution_only",
    },
    currentStageId: prelive?.currentStage || null,
    currentRoute: route,
    strategyContext: {
      topImplementedStrategyId: strategySnapshot?.summary?.topImplementedStrategyId || null,
      topPivotId: strategySnapshot?.summary?.topPivotId || null,
      activeBudgetUsd: strategySnapshot?.currentSystem?.activeBudgetUsd ?? null,
      planningBudgetUsd: strategySnapshot?.summary?.planningBudgetUsd ?? null,
    },
    summary: {
      stageCount: stages.length,
      completeCount: stages.filter((stage) => stage.complete).length,
      blockedCount: stages.filter((stage) => !stage.complete && stage.blockers.length > 0).length,
      readyForManualReview: reviewReady,
      nextStageId: nextStage?.id || null,
      nextStageState: nextStage?.state || null,
      nextActionCode: nextAction?.code || null,
      nextActionCommand: nextAction?.command || null,
      exactRouteForkPlanId: exactRouteForkPlan?.planId || null,
      exactRouteForkPlanStatus: exactRouteForkPlan?.status || null,
      exactRouteForkSubmitCommand: exactRouteForkPlan?.submitCommand || null,
    },
    exactRouteForkPlan,
    stages,
    notes: [
      "This runbook is pre-live only and never grants execution permission.",
      "Fork execution still requires an external signer; planner and dashboard code must not hold private keys.",
      "Keep the USD 300 live ring-fence intact. Any larger budget lane stays planning-only.",
    ],
  };
}

export function summarizeExecutionRunbook(runbook = null) {
  if (!runbook) return null;
  const nextStage = runbook.stages?.find((stage) => !stage.complete) || runbook.stages?.at(-1) || null;
  return {
    generatedAt: runbook.generatedAt || null,
    liveTradingPolicy: runbook.liveTradingPolicy || null,
    currentStageId: runbook.currentStageId || null,
    stageCount: runbook.summary?.stageCount ?? runbook.stages?.length ?? 0,
    completeCount: runbook.summary?.completeCount ?? 0,
    blockedCount: runbook.summary?.blockedCount ?? 0,
    readyForManualReview: Boolean(runbook.summary?.readyForManualReview),
    nextStageId: nextStage?.id || runbook.summary?.nextStageId || null,
    nextStageState: nextStage?.state || runbook.summary?.nextStageState || null,
    nextActionCode: nextStage?.nextAction?.code || runbook.summary?.nextActionCode || null,
    nextActionCommand: nextStage?.nextAction?.command || runbook.summary?.nextActionCommand || null,
    topRouteLabel: runbook.currentRoute?.routeLabel || null,
    topRouteAmount: runbook.currentRoute?.amount || null,
    exactRouteForkPlanId: runbook.exactRouteForkPlan?.planId || runbook.summary?.exactRouteForkPlanId || null,
    exactRouteForkPlanStatus: runbook.exactRouteForkPlan?.status || runbook.summary?.exactRouteForkPlanStatus || null,
    exactRouteForkSubmitCommand: runbook.exactRouteForkPlan?.submitCommand || runbook.summary?.exactRouteForkSubmitCommand || null,
  };
}
