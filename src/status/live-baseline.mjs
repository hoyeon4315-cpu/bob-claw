function formatDecimal(value) {
  if (!Number.isFinite(value)) return "unknown";
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 6 : 12 });
}

function formatActionSummary(action = {}) {
  if (action.type === "fund_native") {
    return `fund ${formatDecimal(action.shortfallDecimal)} ${action.ticker || "asset"} on ${action.chain || "unknown"}`;
  }
  if (action.type === "fund_token") {
    return `fund ${formatDecimal(action.shortfallDecimal)} ${action.ticker || "asset"} on ${action.chain || "unknown"}`;
  }
  if (action.type === "approve_allowance") {
    return `approve ${formatDecimal(action.shortfallDecimal)} ${action.ticker || "asset"} for ${action.spender || "unknown"} on ${action.chain || "unknown"}`;
  }
  if (action.type === "estimate_exact_gas") {
    return `estimate exact gas for ${action.routeKey || "route"} amount=${action.amount || "n/a"}`;
  }
  if (action.type === "rerun_scoring") {
    return `rerun scoring for ${action.routeKey || "route"} amount=${action.amount || "n/a"}`;
  }
  return action.type || "unknown_action";
}

function normalizeRoute(primary = null, fallback = null) {
  const route = primary || fallback;
  if (!route) return null;
  return {
    routeKey: route.routeKey || null,
    routeLabel: route.routeLabel || route.label || null,
    amount: route.amount || null,
  };
}

function createBlocker(category, code, headline, extra = {}) {
  return {
    category,
    code,
    headline,
    ...extra,
  };
}

function minimumPaybackProgress(payback = null) {
  return payback?.scheduler?.minimumPaybackProgress || payback?.scheduler?.previewAfterDestination || null;
}

export function buildLiveBaselineSummary({ dashboardStatus = null, nextStep = null } = {}) {
  const connectedRefresh = dashboardStatus?.prelive?.connectedRefresh || null;
  const currentRoutePrelivePass = dashboardStatus?.prelive?.currentRoutePrelivePass || null;
  const exactRouteForkPackage = dashboardStatus?.prelive?.exactRouteForkPackage || null;
  const operationalJudgmentReview = dashboardStatus?.prelive?.operationalJudgmentReview || null;
  const preliveValidation = dashboardStatus?.prelive?.validation || null;
  const payback = dashboardStatus?.payback || null;
  const executorRuntime = dashboardStatus?.executorRuntime || null;
  const route = normalizeRoute(nextStep?.route, connectedRefresh);
  const paybackMinimumProgress = minimumPaybackProgress(payback);

  const refresh = [];
  if ((connectedRefresh?.requiredRefreshCount ?? 0) > 0) {
    refresh.push(
      createBlocker(
        "refresh",
        connectedRefresh.status || "network_refresh_required",
        "Refresh stale or missing decision inputs before trusting the current canary lane.",
        {
          routeLabel: connectedRefresh.routeLabel || route?.routeLabel || null,
          amount: connectedRefresh.amount || route?.amount || null,
          requiredRefreshCount: connectedRefresh.requiredRefreshCount ?? 0,
          staleInputCount: connectedRefresh.staleInputCount ?? 0,
          missingInputCount: connectedRefresh.missingInputCount ?? 0,
          nextActionCode: connectedRefresh.nextActionCode || null,
          command: connectedRefresh.nextActionCommand || connectedRefresh.runnerExecuteCommand || null,
        },
      ),
    );
  }

  const operator = [];
  if (nextStep?.decision === "FUND_AND_APPROVE_WALLET") {
    operator.push(
      createBlocker(
        "operator",
        "fund_and_approve_wallet",
        nextStep.headline || "Fund and approve the estimator wallet before exact gas.",
        {
          decision: nextStep.decision,
          routeLabel: route?.routeLabel || null,
          amount: route?.amount || null,
          reasons: Array.isArray(nextStep.reasons) ? nextStep.reasons : [],
          actions: (nextStep.actions || []).map((action) => ({
            ...action,
            summary: formatActionSummary(action),
          })),
        },
      ),
    );
  }
  if (payback?.scheduler?.reason === "payback_btc_destination_missing") {
    operator.push(
      createBlocker(
        "operator",
        "payback_destination_env_missing",
        "Set the Bitcoin payback destination before the scheduler can emit a live payback intent.",
        {
          requiredEnvName: payback.scheduler.requiredEnvName || null,
          nextActionCode: payback.scheduler.nextAction || null,
        },
      ),
    );
  }

  const technical = [];
  if (exactRouteForkPackage?.technicalStatus && exactRouteForkPackage.technicalStatus !== "submit_ready") {
    technical.push(
      createBlocker(
        "technical",
        exactRouteForkPackage.technicalStatus,
        "Exact-route fork planning is not ready for external-signer review.",
        {
          status: exactRouteForkPackage.status || null,
          technicalStatus: exactRouteForkPackage.technicalStatus || null,
          planId: exactRouteForkPackage.planId || null,
        },
      ),
    );
  }
  if (executorRuntime && executorRuntime.available === false) {
    technical.push(
      createBlocker(
        "technical",
        "executor_runtime_unavailable",
        "Executor runtime health is not currently available.",
        {
          runtimeStatus: executorRuntime.runtimeStatus || null,
          watchdogStatus: executorRuntime.watchdog?.status || null,
        },
      ),
    );
  }

  const objective = [];
  if (currentRoutePrelivePass?.nextAction?.code === "hold_negative_edge") {
    objective.push(
      createBlocker(
        "objective",
        currentRoutePrelivePass.latestStatus || exactRouteForkPackage?.economicStatus || "blocked_economics",
        "Current exact route remains objectively blocked after refresh and should stay out of live execution.",
        {
          latestStatus: currentRoutePrelivePass.latestStatus || null,
          economicStatus: exactRouteForkPackage?.economicStatus || null,
          nextActionCode: currentRoutePrelivePass.nextAction?.code || null,
        },
      ),
    );
  } else if (
    exactRouteForkPackage?.economicStatus &&
    exactRouteForkPackage.economicStatus !== "eligible_for_manual_review"
  ) {
    objective.push(
      createBlocker(
        "objective",
        exactRouteForkPackage.economicStatus,
        "Exact-route economics still block the lane from manual review.",
        {
          economicStatus: exactRouteForkPackage.economicStatus,
        },
      ),
    );
  }
  if ((operationalJudgmentReview?.highSeverityCount ?? 0) > 0) {
    objective.push(
      createBlocker(
        "objective",
        operationalJudgmentReview.status || "guarded_blocked",
        "Operational judgment review still has unresolved high-severity issues.",
        {
          issueCount: operationalJudgmentReview.issueCount ?? 0,
          highSeverityCount: operationalJudgmentReview.highSeverityCount ?? 0,
          nextActionCode: operationalJudgmentReview.nextActionCode || null,
          command: operationalJudgmentReview.nextActionCommand || null,
        },
      ),
    );
  }
  if (paybackMinimumProgress?.reason === "planned_payback_below_minimum") {
    objective.push(
      createBlocker(
        "objective",
        "planned_payback_below_minimum",
        "Even after setting the payback destination, realized profit is still below the minimum payback threshold.",
        {
          remainingSats: paybackMinimumProgress.satsToMinimumPayback ?? null,
          minPaybackSats: paybackMinimumProgress.minPaybackSats ?? null,
          grossTargetBeforeCostsSats: paybackMinimumProgress.grossTargetBeforeCostsSats ?? null,
          progressSource: paybackMinimumProgress.source || null,
        },
      ),
    );
  }

  const counts = {
    refresh: refresh.length,
    operator: operator.length,
    technical: technical.length,
    objective: objective.length,
    total: refresh.length + operator.length + technical.length + objective.length,
    requiredRefreshCount: connectedRefresh?.requiredRefreshCount ?? 0,
  };
  const nextAction =
    [...refresh, ...operator, ...technical, ...objective]
      .filter((item) => item?.nextActionCode || item?.command)
      .map((item) => ({
        category: item.category,
        code: item.nextActionCode || item.code,
        command: item.command || null,
      }))[0] || null;

  return {
    schemaVersion: 1,
    generatedAt: dashboardStatus?.generatedAt || new Date().toISOString(),
    status: dashboardStatus?.overall?.liveTrading === "ALLOWED" && counts.total === 0 ? "ready" : "blocked",
    liveTrading: dashboardStatus?.overall?.liveTrading || null,
    shadowTrading: dashboardStatus?.overall?.shadowTrading || null,
    currentStageId: preliveValidation?.currentStageId || dashboardStatus?.prelive?.currentStage || null,
    route,
    counts,
    blockers: {
      refresh,
      operator,
      technical,
      objective,
    },
    nextAction,
  };
}
