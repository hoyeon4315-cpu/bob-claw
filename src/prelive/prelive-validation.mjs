import { summarizeExecutionRunbook } from "./execution-runbook.mjs";
import { summarizeStrategySnapshot } from "../strategy/strategy-snapshot.mjs";

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function warningsFor(strategySummary = null, dashboardStatus = null) {
  return unique([
    dashboardStatus?.overall?.liveTrading === "BLOCKED" ? "live_execution_locked" : null,
    strategySummary?.candidateForValidationCount <= 0 ? "no_policy_ready_implemented_strategy" : null,
    strategySummary?.proxyCoverageNextAction ? "proxy_surface_still_needs_refresh" : null,
    Number.isFinite(strategySummary?.planningBudgetUsd) ? "planning_budget_does_not_change_live_policy" : null,
  ]);
}

function candidateNextAction(reviewPackage = null) {
  const candidate = reviewPackage?.primaryLiveCandidate || reviewPackage?.manualReviewCandidate || null;
  if (candidate?.candidateType === "strategy" && !reviewPackage?.readyForManualReview) {
    const action = reviewPackage?.remediationPlan?.nextAction || candidate?.nextAction || null;
    if (!action) return null;
    return {
      code: action.code || null,
      label: action.label || null,
      command: action.command || null,
    };
  }
  return null;
}

function nextActionFrom(runbook = null, reviewPackage = null) {
  const strategyCandidateAction = candidateNextAction(reviewPackage);
  if (strategyCandidateAction) return strategyCandidateAction;
  const nextStage = runbook?.stages?.find((stage) => !stage.complete) || null;
  if (nextStage?.nextAction) {
    return {
      code: nextStage.nextAction.code || null,
      label: nextStage.nextAction.label || null,
      command: nextStage.nextAction.command || null,
    };
  }
  if (reviewPackage?.remediationPlan?.nextAction) {
    return {
      code: reviewPackage.remediationPlan.nextAction.code || null,
      label: reviewPackage.remediationPlan.nextAction.label || null,
      command: reviewPackage.remediationPlan.nextAction.command || null,
    };
  }
  return null;
}

export function buildPreliveValidationReport({
  dashboardStatus = null,
  strategySnapshot = null,
  executionRunbook = null,
  reviewPackage = null,
  connectedRefreshPackage = null,
  exactRouteForkPackage = null,
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const strategySummary = strategySnapshot?.summary ? summarizeStrategySnapshot(strategySnapshot) : strategySnapshot;
  const runbookSummary = executionRunbook?.summary ? summarizeExecutionRunbook(executionRunbook) : executionRunbook;
  const nextStage = executionRunbook?.stages?.find((stage) => !stage.complete) || null;
  const blockers = unique([
    ...(reviewPackage?.reviewBlockers || []),
    ...(reviewPackage?.liveBlockers || []),
    ...(nextStage?.blockers || []),
  ]);
  const warnings = unique([
    ...warningsFor(strategySummary, dashboardStatus),
    (connectedRefreshPackage?.summary?.requiredRefreshCount || 0) > 0 ? "connected_refresh_required" : null,
    exactRouteForkPackage?.readiness?.technicalStatus === "submit_ready" &&
    exactRouteForkPackage?.readiness?.economicStatus !== "eligible_for_manual_review"
      ? "technical_ready_economic_blocked"
      : null,
  ]);
  const nextAction = nextActionFrom(executionRunbook, reviewPackage);
  const stageCount = runbookSummary?.stageCount ?? 0;
  const completeCount = runbookSummary?.completeCount ?? 0;
  const readinessPct = stageCount > 0 ? round((completeCount / stageCount) * 100) : 0;
  const readyForManualReview = Boolean(reviewPackage?.readyForManualReview || runbookSummary?.readyForManualReview);
  const validationStatus = readyForManualReview ? "ready_for_manual_review" : blockers.length ? "blocked" : "in_progress";
  const candidate = reviewPackage?.primaryLiveCandidate || reviewPackage?.manualReviewCandidate || null;

  return {
    schemaVersion: 1,
    generatedAt,
    validationStatus,
    liveTradingPolicy: dashboardStatus?.overall?.liveTrading || "BLOCKED",
    currentStageId: runbookSummary?.currentStageId || dashboardStatus?.prelive?.currentStage || null,
    readinessPct,
    summary: {
      stageCount,
      completeCount,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      readyForManualReview,
      nextStageId: runbookSummary?.nextStageId || nextStage?.id || null,
      nextStageState: runbookSummary?.nextStageState || nextStage?.state || null,
      nextActionCode: nextAction?.code || null,
      nextActionCommand: nextAction?.command || null,
      connectedRefreshStatus: connectedRefreshPackage?.status || null,
      connectedRefreshRequiredCount: connectedRefreshPackage?.summary?.requiredRefreshCount ?? 0,
      exactRouteForkPlanId: runbookSummary?.exactRouteForkPlanId || null,
      exactRouteForkPlanStatus: runbookSummary?.exactRouteForkPlanStatus || null,
      exactRouteForkSubmitCommand: runbookSummary?.exactRouteForkSubmitCommand || null,
      exactRouteForkTechnicalStatus: exactRouteForkPackage?.readiness?.technicalStatus || null,
      exactRouteForkEconomicStatus: exactRouteForkPackage?.readiness?.economicStatus || null,
    },
    budgets: {
      activeBudgetUsd: strategySummary?.activeBudgetUsd ?? null,
      planningBudgetUsd: strategySummary?.planningBudgetUsd ?? null,
    },
    topStrategy: {
      implementedStrategyId: strategySummary?.topImplementedStrategy?.id || null,
      pivotId: strategySummary?.topPivot?.id || null,
      yieldTopProfileId: strategySummary?.yieldTopProfileId || null,
    },
    manualReviewCandidate: candidate
      ? {
          candidateType: candidate.candidateType || "route",
          candidateId: candidate.candidateId || candidate.routeKey || null,
          candidateLabel: candidate.candidateLabel || candidate.routeLabel || null,
          routeKey: candidate.routeKey || null,
          routeLabel: candidate.routeLabel || null,
          amount: candidate.amount || null,
          tradeReadiness: candidate.tradeReadiness || null,
        }
      : null,
    blockers,
    warnings,
    nextAction,
    notes: [
      "Validation summarizes pre-live readiness only; it does not authorize live execution.",
      "A planning budget lane does not replace runtime gates, per-strategy caps, or measured positive-EV requirements.",
      "Treat all positive paper or measured signals as research until policy, decay, and pre-live gates all clear.",
    ],
  };
}

export function summarizePreliveValidationReport(report = null) {
  if (!report) return null;
  return {
    generatedAt: report.generatedAt || null,
    validationStatus: report.validationStatus || null,
    currentStageId: report.currentStageId || null,
    readinessPct: report.readinessPct ?? 0,
    blockerCount: report.summary?.blockerCount ?? report.blockers?.length ?? 0,
    warningCount: report.summary?.warningCount ?? report.warnings?.length ?? 0,
    nextStageId: report.summary?.nextStageId || null,
    nextActionCode: report.summary?.nextActionCode || null,
    nextActionCommand: report.summary?.nextActionCommand || null,
    connectedRefreshStatus: report.summary?.connectedRefreshStatus || null,
    connectedRefreshRequiredCount: report.summary?.connectedRefreshRequiredCount ?? 0,
    exactRouteForkPlanId: report.summary?.exactRouteForkPlanId || null,
    exactRouteForkPlanStatus: report.summary?.exactRouteForkPlanStatus || null,
    exactRouteForkSubmitCommand: report.summary?.exactRouteForkSubmitCommand || null,
    exactRouteForkTechnicalStatus: report.summary?.exactRouteForkTechnicalStatus || null,
    exactRouteForkEconomicStatus: report.summary?.exactRouteForkEconomicStatus || null,
    topImplementedStrategyId: report.topStrategy?.implementedStrategyId || null,
    topPivotId: report.topStrategy?.pivotId || null,
  };
}
