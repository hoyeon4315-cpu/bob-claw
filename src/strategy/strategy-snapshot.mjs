import { buildYieldShadowBook, summarizeYieldShadowBook } from "../ledger/yield-shadow-book.mjs";
import { buildStrategyPivotPlan, summarizeStrategyPivotPlan } from "./pivot-plan.mjs";
import { buildProxySpreadCoveragePlan, summarizeProxySpreadCoveragePlan } from "./proxy-spread-coverage-plan.mjs";
import { buildCapitalExpansionReview, summarizeCapitalExpansionReview } from "./capital-expansion-review.mjs";
import { buildStrategyCatalog } from "./strategy-catalog.mjs";

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countByStatus(items = []) {
  return (items || []).reduce((counts, item) => {
    const status = item?.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function statusPriority(status) {
  return {
    candidate_for_validation: 0,
    measured_below_policy: 1,
    thin_coverage: 2,
    blocked_by_policy: 3,
    research_only: 4,
    analysis_only: 5,
    unobserved: 6,
  }[status] ?? 7;
}

function evidenceGrade(entry = null, pivot = null) {
  if (pivot?.evidenceGrade) return pivot.evidenceGrade;
  const status = entry?.status || null;
  if (status === "candidate_for_validation" || status === "measured_below_policy") return "measured";
  if (status === "thin_coverage" || status === "research_only") return "research";
  if (status === "analysis_only") return "analysis";
  return "none";
}

function nextActionForEntry(entry = null, pivot = null) {
  if (pivot?.nextStep?.code || pivot?.nextStep?.command) {
    return {
      code: pivot.nextStep.code || null,
      label: pivot.nextStep.label || null,
      command: pivot.nextStep.command || null,
    };
  }
  const command = entry?.commands?.[0] || null;
  if (!command) return null;
  return {
    code: "refresh_strategy_surface",
    label: "refresh strategy surface",
    command,
  };
}

function entryOverfitRisks(entry = null, pivot = null) {
  const evidence = entry?.evidence || {};
  return unique([
    ...(pivot?.overfitRisks || []),
    evidence.overfitAssessment === "high_overfit_risk" ? "high_overfit_risk" : null,
    ...(evidence.overfitRisks || []),
  ]);
}

function implementedStrategyEntry({ entry = null, pivot = null, lane = null } = {}) {
  const nextAction = nextActionForEntry(entry, pivot);
  return {
    id: entry?.id || null,
    label: entry?.label || null,
    lane,
    status: entry?.status || null,
    reason: entry?.reason || null,
    evidenceGrade: evidenceGrade(entry, pivot),
    evidence: entry?.evidence || {},
    capitalGuidance: pivot?.capitalGuidance || null,
    budgetScenarios: pivot?.budgetScenarios || [],
    blockers: unique([entry?.reason || null, ...(pivot?.blockers || [])]),
    overfitRisks: entryOverfitRisks(entry, pivot),
    nextAction,
    commands: entry?.commands || [],
    preExecutionPlan: pivot?.preExecutionPlan || [],
    ethApplicability: entry?.ethApplicability || null,
  };
}

function pivotEntry(pivot = null) {
  const nextAction = nextActionForEntry(null, pivot);
  return {
    id: pivot?.id || null,
    label: pivot?.label || null,
    category: pivot?.category || null,
    status: pivot?.status || null,
    reason: pivot?.reason || null,
    evidenceGrade: pivot?.evidenceGrade || null,
    evidence: pivot?.evidence || {},
    capitalGuidance: pivot?.capitalGuidance || null,
    budgetScenarios: pivot?.budgetScenarios || [],
    blockers: pivot?.blockers || [],
    overfitRisks: pivot?.overfitRisks || [],
    nextAction,
    commands: pivot?.commands || [],
    preExecutionPlan: pivot?.preExecutionPlan || [],
  };
}

function bestImplementedStrategy(items = []) {
  return [...(items || [])].sort((left, right) => {
    const rankDiff = statusPriority(left?.status) - statusPriority(right?.status);
    if (rankDiff !== 0) return rankDiff;
    const leftHasAction = left?.nextAction?.command ? 0 : 1;
    const rightHasAction = right?.nextAction?.command ? 0 : 1;
    if (leftHasAction !== rightHasAction) return leftHasAction - rightHasAction;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  })[0] || null;
}

function planningBudgetUsd(budgetScenarios = []) {
  return (budgetScenarios || []).find((scenario) => scenario?.planningOnly)?.budgetUsd ?? null;
}

function topAction({ topPivot = null, topImplemented = null, proxyCoverageSummary = null } = {}) {
  if (topPivot?.nextAction?.code || topPivot?.nextAction?.command) {
    return {
      scope: "pivot",
      code: topPivot.nextAction.code || null,
      label: topPivot.nextAction.label || null,
      command: topPivot.nextAction.command || null,
    };
  }
  if (proxyCoverageSummary?.nextAction || proxyCoverageSummary?.nextCommand) {
    return {
      scope: "proxy_coverage",
      code: proxyCoverageSummary.nextAction || null,
      label: proxyCoverageSummary.nextPriority || proxyCoverageSummary.nextAction || null,
      command: proxyCoverageSummary.nextCommand || null,
    };
  }
  if (topImplemented?.nextAction?.code || topImplemented?.nextAction?.command) {
    return {
      scope: topImplemented.lane || "implemented_strategy",
      code: topImplemented.nextAction.code || null,
      label: topImplemented.nextAction.label || null,
      command: topImplemented.nextAction.command || null,
    };
  }
  return null;
}

export function buildStrategySnapshot({ dashboardStatus = null, state = {}, triangleArtifacts = {}, now = null } = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const catalog = buildStrategyCatalog({ dashboardStatus, state, triangleArtifacts });
  const pivotPlan = buildStrategyPivotPlan({ dashboardStatus, state, triangleArtifacts });
  const yieldShadowBook = buildYieldShadowBook({ pivotPlan });
  const proxyCoveragePlan = buildProxySpreadCoveragePlan({
    proxySpreadSummary: dashboardStatus?.strategy?.btcProxySpreads || null,
    now: generatedAt,
  });
  const pivotPlanSummary = summarizeStrategyPivotPlan(pivotPlan);
  const yieldShadowSummary = summarizeYieldShadowBook(yieldShadowBook);
  const proxyCoverageSummary = summarizeProxySpreadCoveragePlan(proxyCoveragePlan);
  const pivotById = new Map((pivotPlan?.pivots || []).map((pivot) => [pivot.id, pivot]));

  const implementedStrategies = [
    ...(catalog?.btcFamilies || []).map((entry) =>
      implementedStrategyEntry({
        entry,
        pivot: pivotById.get(entry.id) || null,
        lane: "btc_family",
      }),
    ),
    ...(catalog?.ethBranches || []).map((entry) =>
      implementedStrategyEntry({
        entry,
        pivot: pivotById.get(entry.id) || null,
        lane: "eth_branch",
      }),
    ),
  ];
  const pivotOpportunities = (pivotPlan?.pivots || []).map((pivot) => pivotEntry(pivot));
  const topImplemented = bestImplementedStrategy(implementedStrategies);
  const topPivot = pivotOpportunities[0] || null;
  const nextAction = topAction({
    topPivot,
    topImplemented,
    proxyCoverageSummary,
  });
  const currentSystem = {
    liveTrading: dashboardStatus?.overall?.liveTrading || "BLOCKED",
    shadowTrading: dashboardStatus?.overall?.shadowTrading || null,
    preliveStage: dashboardStatus?.prelive?.currentStage || null,
    activeBudgetUsd: pivotPlanSummary?.currentBudgetUsd ?? null,
    budgetScenarios: pivotPlanSummary?.budgetScenarios || [],
    ethereumL1: pivotPlan?.currentSystem?.ethereumL1 || "observe_only_until_reapproved",
  };
  const capitalExpansionReview = buildCapitalExpansionReview({
    currentSystem,
    implementedStrategies,
    pivotOpportunities,
    yieldProfiles: yieldShadowBook?.profiles || [],
    budgetScenarios: currentSystem.budgetScenarios,
    now: generatedAt,
  });
  const capitalExpansionSummary = summarizeCapitalExpansionReview(capitalExpansionReview);

  return {
    schemaVersion: 1,
    generatedAt,
    currentSystem,
    summary: {
      implementedStrategyCount: implementedStrategies.length,
      btcFamilyCount: catalog?.btcFamilies?.length || 0,
      ethBranchCount: catalog?.ethBranches?.length || 0,
      pivotCount: pivotOpportunities.length,
      candidateForValidationCount: implementedStrategies.filter((item) => item.status === "candidate_for_validation").length,
      measuredBelowPolicyCount: implementedStrategies.filter((item) => item.status === "measured_below_policy").length,
      thinCoverageCount: implementedStrategies.filter((item) => item.status === "thin_coverage").length,
      blockedByPolicyCount: implementedStrategies.filter((item) => item.status === "blocked_by_policy").length,
      researchOnlyCount: implementedStrategies.filter((item) => item.status === "research_only").length,
      analysisOnlyCount: implementedStrategies.filter((item) => item.status === "analysis_only").length,
      unobservedCount: implementedStrategies.filter((item) => item.status === "unobserved").length,
      topImplementedStrategyId: topImplemented?.id || null,
      topPivotId: topPivot?.id || null,
      topAction: nextAction,
      planningBudgetUsd: planningBudgetUsd(pivotPlanSummary?.budgetScenarios || []),
      yieldTopProfileId: yieldShadowSummary?.topProfile?.id || null,
      proxyCoverageNextAction: proxyCoverageSummary?.nextAction || null,
      capitalExpansionActiveLaneBudgetUsd: capitalExpansionSummary?.activeLaneBudgetUsd ?? null,
      capitalExpansionPlanningLaneBudgetUsd: capitalExpansionSummary?.planningLaneBudgetUsd ?? null,
      capitalExpansionPlanningTopImplementedId: capitalExpansionSummary?.planningTopImplementedId || null,
      capitalExpansionPlanningTopPivotId: capitalExpansionSummary?.planningTopPivotId || null,
    },
    implementedStatusCounts: countByStatus(implementedStrategies),
    pivotStatusCounts: countByStatus(pivotOpportunities),
    implementedStrategies,
    pivotOpportunities,
    planningLayers: {
      pivotPlan: pivotPlanSummary,
      yieldShadowBook: yieldShadowSummary,
      proxySpreadCoveragePlan: proxyCoverageSummary,
      capitalExpansionReview,
    },
    artifacts: {
      source: [
        { kind: "dashboard_status", path: "data/dashboard-status.json" },
        { kind: "strategy_pivot_plan", path: "data/strategy-pivot-plan.json" },
        { kind: "yield_shadow_book", path: "data/yield-shadow-book-latest.json" },
        { kind: "proxy_spread_coverage_plan", path: "data/proxy-spread-coverage-plan-latest.json" },
      ],
      generated: [{ kind: "strategy_snapshot", path: "data/strategy-snapshot.json" }],
    },
    notes: [
      "This snapshot preserves the implemented strategy families and planning layers in one machine-readable artifact.",
      "USD 300 remains the active live ring-fence. Any larger budget lane is planning-only until explicit policy redesign.",
      "The capital expansion review reprioritizes 300 vs 1000 budget lanes without changing live authorization.",
      "No strategy in this snapshot grants live execution permission while liveTrading stays BLOCKED.",
    ],
  };
}

export function summarizeStrategySnapshot(snapshot = null) {
  if (!snapshot) return null;
  const topImplemented =
    snapshot.implementedStrategies?.find((item) => item.id === snapshot.summary?.topImplementedStrategyId) ||
    snapshot.implementedStrategies?.[0] ||
    null;
  const topPivot =
    snapshot.pivotOpportunities?.find((item) => item.id === snapshot.summary?.topPivotId) ||
    snapshot.pivotOpportunities?.[0] ||
    null;
  return {
    generatedAt: snapshot.generatedAt || null,
    liveTrading: snapshot.currentSystem?.liveTrading || null,
    preliveStage: snapshot.currentSystem?.preliveStage || null,
    activeBudgetUsd: snapshot.currentSystem?.activeBudgetUsd ?? null,
    budgetScenarios: snapshot.currentSystem?.budgetScenarios || [],
    implementedStrategyCount: snapshot.summary?.implementedStrategyCount ?? 0,
    candidateForValidationCount: snapshot.summary?.candidateForValidationCount ?? 0,
    measuredBelowPolicyCount: snapshot.summary?.measuredBelowPolicyCount ?? 0,
    topImplementedStrategy: topImplemented
      ? {
          id: topImplemented.id || null,
          label: topImplemented.label || null,
          status: topImplemented.status || null,
          reason: topImplemented.reason || null,
        }
      : null,
    topPivot: topPivot
      ? {
          id: topPivot.id || null,
          label: topPivot.label || null,
          status: topPivot.status || null,
          researchPilotMinimumUsd: topPivot.capitalGuidance?.researchPilotMinimumUsd ?? null,
        }
      : null,
    topAction: snapshot.summary?.topAction || null,
    planningBudgetUsd: snapshot.summary?.planningBudgetUsd ?? null,
    yieldTopProfileId: snapshot.summary?.yieldTopProfileId || null,
    proxyCoverageNextAction: snapshot.summary?.proxyCoverageNextAction || null,
    capitalExpansionReview: summarizeCapitalExpansionReview(snapshot.planningLayers?.capitalExpansionReview || null),
  };
}
