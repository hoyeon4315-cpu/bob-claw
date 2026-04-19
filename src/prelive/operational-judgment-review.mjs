function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function issue({ code, severity = "medium", headline, detail, command = null }) {
  return { code, severity, headline, detail, command };
}

function routeContext({ executionRunbook = null, reviewPackage = null } = {}) {
  return executionRunbook?.currentRoute || reviewPackage?.manualReviewCandidate || null;
}

function primaryCandidate(reviewPackage = null) {
  return reviewPackage?.primaryLiveCandidate || reviewPackage?.manualReviewCandidate || null;
}

function strategyPrimaryCandidate(reviewPackage = null) {
  return primaryCandidate(reviewPackage)?.candidateType === "strategy";
}

function measuredLeader(reviewPackage = null) {
  return reviewPackage?.measuredLeaderReview || null;
}

function objectiveComparisonRoute({ dashboardStatus = null, reviewPackage = null } = {}) {
  const leader = measuredLeader(reviewPackage);
  if (leader?.routeKey) {
    return {
      source: "measured_leader",
      routeKey: leader.routeKey || null,
      routeLabel: leader.routeLabel || leader.label || null,
      amount: leader.amount || null,
      tradeReadiness: leader.tradeReadiness || null,
      command: leader.command || null,
    };
  }

  const executionReview = dashboardStatus?.shadowCycle?.objectivePlans?.executionReview || null;
  if (executionReview?.routeKey) {
    return {
      source: "objective_execution_review",
      routeKey: executionReview.routeKey || null,
      routeLabel: executionReview.routeLabel || executionReview.label || null,
      amount: executionReview.amount || null,
      tradeReadiness: executionReview.tradeReadiness || null,
      command: executionReview.command || null,
    };
  }

  const discovery = dashboardStatus?.shadowCycle?.objectivePlans?.discovery || null;
  if (discovery?.routeKey) {
    return {
      source: "objective_discovery",
      routeKey: discovery.routeKey || null,
      routeLabel: discovery.routeLabel || discovery.label || null,
      amount: discovery.amount || null,
      tradeReadiness: discovery.tradeReadiness || discovery.status || null,
      command: discovery.command || null,
    };
  }

  return null;
}

function nextActionFrom(issues = [], validation = null, connectedRefreshPackage = null, reviewPackage = null) {
  const actionable = issues.find((entry) => entry.command) || null;
  if (actionable) {
    return {
      code: actionable.code,
      label: actionable.headline,
      command: actionable.command,
    };
  }
  if (reviewPackage?.readyForManualReview || strategyPrimaryCandidate(reviewPackage)) return null;
  if (connectedRefreshPackage?.summary?.nextActionCode || connectedRefreshPackage?.summary?.nextActionCommand) {
    return {
      code: connectedRefreshPackage.summary.nextActionCode || null,
      label: "refresh connected inputs",
      command: connectedRefreshPackage.summary.nextActionCommand || null,
    };
  }
  return validation?.nextAction || null;
}

export function buildOperationalJudgmentReview({
  dashboardStatus = null,
  strategySnapshot = null,
  reviewPackage = null,
  executionRunbook = null,
  preliveValidation = null,
  connectedRefreshPackage = null,
  exactRouteForkPackage = null,
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const currentRoute = routeContext({ executionRunbook, reviewPackage });
  const leader = measuredLeader(reviewPackage);
  const comparisonRoute = objectiveComparisonRoute({ dashboardStatus, reviewPackage });
  const strategyPrimary = strategyPrimaryCandidate(reviewPackage);
  const issues = [];

  if (!strategyPrimary && (connectedRefreshPackage?.summary?.requiredRefreshCount || 0) > 0) {
    issues.push(
      issue({
        code: "stale_inputs_can_distort_route_scoring",
        severity: "high",
        headline: "Refresh stale decision inputs before trusting route scoring",
        detail: `Connected refresh still requires ${connectedRefreshPackage.summary.requiredRefreshCount} step(s).`,
        command: connectedRefreshPackage.summary.nextActionCommand || connectedRefreshPackage.summary.fullCommandChain || null,
      }),
    );
  }

  if (
    !strategyPrimary &&
    exactRouteForkPackage?.readiness?.technicalStatus === "submit_ready" &&
    exactRouteForkPackage?.readiness?.economicStatus !== "eligible_for_manual_review"
  ) {
    issues.push(
      issue({
        code: "technical_ready_but_economic_blocked",
        severity: "high",
        headline: "Exact-route fork plan is technically ready but still economically blocked",
        detail: `Economic status is ${exactRouteForkPackage.readiness.economicStatus}. Do not treat plan ${exactRouteForkPackage.plan?.planId || "n/a"} as a submit green light.`,
        command: exactRouteForkPackage.commands?.refreshInputs || null,
      }),
    );
  }

  if (!strategyPrimary && comparisonRoute?.routeKey && currentRoute?.routeKey && comparisonRoute.routeKey !== currentRoute.routeKey) {
    const comparisonLabel =
      comparisonRoute.source === "measured_leader"
        ? "measured leader"
        : comparisonRoute.source === "objective_execution_review"
          ? "objective execution review route"
          : "objective discovery route";
    issues.push(
      issue({
        code:
          comparisonRoute.source === "measured_leader"
            ? "measured_leader_differs_from_current_canary"
            : "objective_route_differs_from_current_canary",
        severity: "medium",
        headline:
          comparisonRoute.source === "measured_leader"
            ? "Measured leader and current canary route diverge"
            : "Objective route and current canary route diverge",
        detail: `Current canary is ${currentRoute.routeKey}; ${comparisonLabel} is ${comparisonRoute.routeKey}. Keep technical prep and economic selection separate.`,
        command: comparisonRoute.command || null,
      }),
    );
  }

  if ((executionRunbook?.summary?.readyForManualReview || false) !== true) {
    issues.push(
      issue({
        code: "prelive_evidence_still_incomplete",
        severity: "high",
        headline: "Pre-live evidence is still incomplete",
        detail: `Execution runbook remains at ${executionRunbook?.summary?.nextStageId || executionRunbook?.currentStageId || "unknown"}; manual review is not ready.`,
        command: preliveValidation?.nextAction?.command || preliveValidation?.summary?.nextActionCommand || null,
      }),
    );
  }

  const highSeverityCount = issues.filter((entry) => entry.severity === "high").length;
  const mediumSeverityCount = issues.filter((entry) => entry.severity === "medium").length;
  const status = highSeverityCount > 0 ? "guarded_blocked" : mediumSeverityCount > 0 ? "guarded_review" : "aligned_for_manual_review";
  const nextAction = nextActionFrom(issues, preliveValidation, connectedRefreshPackage, reviewPackage);

  return {
    schemaVersion: 1,
    generatedAt,
    status,
    issueCount: issues.length,
    highSeverityCount,
    mediumSeverityCount,
    currentRoute: currentRoute
      ? {
          routeKey: currentRoute.routeKey || null,
          routeLabel: currentRoute.routeLabel || currentRoute.label || null,
          amount: currentRoute.amount || null,
          tradeReadiness: currentRoute.tradeReadiness || null,
        }
      : null,
    measuredLeader: leader
      ? {
          routeKey: leader.routeKey || null,
          routeLabel: leader.routeLabel || leader.label || null,
          amount: leader.amount || null,
          tradeReadiness: leader.tradeReadiness || null,
        }
      : null,
    comparisonRoute: comparisonRoute
      ? {
          source: comparisonRoute.source || null,
          routeKey: comparisonRoute.routeKey || null,
          routeLabel: comparisonRoute.routeLabel || null,
          amount: comparisonRoute.amount || null,
          tradeReadiness: comparisonRoute.tradeReadiness || null,
        }
      : null,
    issues,
    nextAction,
    assumptionsToReject: [
      "A technically plannable fork transaction is not the same as a profitable or approved trade.",
      "Reference planning math does not override runtime gates or per-strategy caps.",
      "Freshness failures should be treated as missing evidence, not as permission to trust stale scores.",
    ],
    notes: unique([
      dashboardStatus?.overall?.liveTrading === "BLOCKED" ? "liveTrading remains BLOCKED throughout this review." : null,
      "Use this review to challenge false confidence before any manual canary discussion.",
    ]),
  };
}

export function summarizeOperationalJudgmentReview(review = null) {
  if (!review) return null;
  return {
    generatedAt: review.generatedAt || null,
    status: review.status || null,
    issueCount: review.issueCount ?? review.issues?.length ?? 0,
    highSeverityCount: review.highSeverityCount ?? 0,
    mediumSeverityCount: review.mediumSeverityCount ?? 0,
    nextActionCode: review.nextAction?.code || null,
    nextActionCommand: review.nextAction?.command || null,
    currentRouteKey: review.currentRoute?.routeKey || null,
  };
}
