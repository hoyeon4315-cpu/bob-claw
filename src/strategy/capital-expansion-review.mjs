function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function statusPriority(status) {
  return {
    receipt_backed_validation_ready: 0,
    candidate_for_validation: 1,
    measured_below_policy: 2,
    thin_coverage: 3,
    blocked_by_policy: 4,
    research_only: 5,
    analysis_only: 6,
    unobserved: 7,
    pre_execution_blueprint: 8,
  }[status] ?? 9;
}

function minimumCapitalUsd(item = null) {
  return item?.capitalGuidance?.minimumCapitalUsd ?? item?.capitalGuidance?.researchPilotMinimumUsd ?? item?.capitalRequiredUsd ?? null;
}

function scenarioEntry(item = null, budgetUsd = null) {
  return (item?.budgetScenarios || []).find((entry) => Number(entry?.budgetUsd) === Number(budgetUsd)) || null;
}

function scenarioFitsBudget(entry = null) {
  if (!entry) return null;
  if (typeof entry.fitsBudget === "boolean") return entry.fitsBudget;
  if (typeof entry.researchPilot?.fitsBudget === "boolean") return entry.researchPilot.fitsBudget;
  if (typeof entry.diversifiedSingleSleeve?.fitsBudget === "boolean") return entry.diversifiedSingleSleeve.fitsBudget;
  if (typeof entry.defaultDualSleeve?.fitsBudget === "boolean") return entry.defaultDualSleeve.fitsBudget;
  return null;
}

function candidateView(item = null, budgetUsd = null, activeBudgetUsd = null) {
  const minimumUsd = minimumCapitalUsd(item);
  const budgetScenario = scenarioEntry(item, budgetUsd);
  const activeScenario = scenarioEntry(item, activeBudgetUsd);
  const fitsBudget = scenarioFitsBudget(budgetScenario) ?? (Number.isFinite(minimumUsd) && Number.isFinite(budgetUsd) ? minimumUsd <= budgetUsd : null);
  const fitsActiveBudget =
    scenarioFitsBudget(activeScenario) ?? (Number.isFinite(minimumUsd) && Number.isFinite(activeBudgetUsd) ? minimumUsd <= activeBudgetUsd : null);
  return {
    id: item?.id || null,
    label: item?.label || null,
    status: item?.status || null,
    minimumCapitalUsd: round(minimumUsd),
    fitsBudget,
    newlyEnabledAtLane: fitsBudget === true && fitsActiveBudget === false,
    nextActionCode: item?.nextAction?.code || null,
    overfitRiskCount: item?.overfitRisks?.length || 0,
  };
}

function compareCandidates(left, right) {
  const leftFit = left?.fitsBudget === true ? 0 : left?.fitsBudget === false ? 1 : 2;
  const rightFit = right?.fitsBudget === true ? 0 : right?.fitsBudget === false ? 1 : 2;
  if (leftFit !== rightFit) return leftFit - rightFit;
  const rankDiff = statusPriority(left?.status) - statusPriority(right?.status);
  if (rankDiff !== 0) return rankDiff;
  const leftMinimum = Number.isFinite(left?.minimumCapitalUsd) ? left.minimumCapitalUsd : Number.POSITIVE_INFINITY;
  const rightMinimum = Number.isFinite(right?.minimumCapitalUsd) ? right.minimumCapitalUsd : Number.POSITIVE_INFINITY;
  if (leftMinimum !== rightMinimum) return leftMinimum - rightMinimum;
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function laneSummary({ budgetUsd = null, label = null, planningOnly = false, implementedStrategies = [], pivotOpportunities = [], yieldProfiles = [], activeBudgetUsd = null } = {}) {
  const implemented = implementedStrategies.map((item) => candidateView(item, budgetUsd, activeBudgetUsd)).sort(compareCandidates);
  const pivots = pivotOpportunities.map((item) => candidateView(item, budgetUsd, activeBudgetUsd)).sort(compareCandidates);
  const yields = yieldProfiles.map((item) => candidateView(item, budgetUsd, activeBudgetUsd)).sort(compareCandidates);
  const topImplemented = implemented.find((item) => item.fitsBudget) || implemented[0] || null;
  const topPivot = pivots.find((item) => item.fitsBudget) || pivots[0] || null;
  const topYieldProfile = yields.find((item) => item.fitsBudget) || yields[0] || null;

  return {
    budgetUsd,
    label,
    planningOnly,
    implementedFitCount: implemented.filter((item) => item.fitsBudget).length,
    pivotFitCount: pivots.filter((item) => item.fitsBudget).length,
    yieldProfileFitCount: yields.filter((item) => item.fitsBudget).length,
    topImplementedStrategy: topImplemented,
    topPivotOpportunity: topPivot,
    topYieldProfile,
    newlyEnabledStrategyIds: implemented.filter((item) => item.newlyEnabledAtLane).map((item) => item.id),
    newlyEnabledPivotIds: pivots.filter((item) => item.newlyEnabledAtLane).map((item) => item.id),
    newlyEnabledYieldProfileIds: yields.filter((item) => item.newlyEnabledAtLane).map((item) => item.id),
  };
}

export function buildCapitalExpansionReview({
  currentSystem = null,
  implementedStrategies = [],
  pivotOpportunities = [],
  yieldProfiles = [],
  budgetScenarios = [],
  now = null,
} = {}) {
  const generatedAt = now || new Date().toISOString();
  const activeBudgetUsd = currentSystem?.activeBudgetUsd ?? budgetScenarios.find((item) => !item?.planningOnly)?.budgetUsd ?? null;
  const lanes = (budgetScenarios || [])
    .map((scenario) =>
      laneSummary({
        budgetUsd: scenario?.budgetUsd ?? null,
        label: scenario?.label || null,
        planningOnly: Boolean(scenario?.planningOnly),
        implementedStrategies,
        pivotOpportunities,
        yieldProfiles,
        activeBudgetUsd,
      }),
    )
    .sort((left, right) => Number(left.budgetUsd || 0) - Number(right.budgetUsd || 0));
  const activeLane = lanes.find((lane) => !lane.planningOnly) || lanes[0] || null;
  const planningLane = lanes.find((lane) => lane.planningOnly) || null;

  return {
    schemaVersion: 1,
    generatedAt,
    activeBudgetUsd,
    planningBudgetUsd: planningLane?.budgetUsd ?? null,
    approvalBoundaryUsd: activeBudgetUsd,
    summary: {
      laneCount: lanes.length,
      activeLaneBudgetUsd: activeLane?.budgetUsd ?? null,
      planningLaneBudgetUsd: planningLane?.budgetUsd ?? null,
      approvalRequiredForPlanningLane: Boolean(planningLane),
      activeTopImplementedId: activeLane?.topImplementedStrategy?.id || null,
      planningTopImplementedId: planningLane?.topImplementedStrategy?.id || null,
      activeTopPivotId: activeLane?.topPivotOpportunity?.id || null,
      planningTopPivotId: planningLane?.topPivotOpportunity?.id || null,
      activeYieldProfileId: activeLane?.topYieldProfile?.id || null,
      planningYieldProfileId: planningLane?.topYieldProfile?.id || null,
    },
    lanes,
    notes: [
      "Capital evaluation is reference-only; strategy-specific caps still decide what can run live.",
      "No lane in this report is itself a live authorization boundary.",
      "Lane reprioritization does not upgrade a strategy from research to live eligibility without fresh measured evidence.",
    ],
  };
}

export function summarizeCapitalExpansionReview(review = null) {
  if (!review) return null;
  return {
    activeLaneBudgetUsd: review.summary?.activeLaneBudgetUsd ?? review.activeBudgetUsd ?? null,
    planningLaneBudgetUsd: review.summary?.planningLaneBudgetUsd ?? review.planningBudgetUsd ?? null,
    approvalRequiredForPlanningLane: Boolean(review.summary?.approvalRequiredForPlanningLane),
    activeTopImplementedId: review.summary?.activeTopImplementedId || null,
    planningTopImplementedId: review.summary?.planningTopImplementedId || null,
    activeTopPivotId: review.summary?.activeTopPivotId || null,
    planningTopPivotId: review.summary?.planningTopPivotId || null,
    activeYieldProfileId: review.summary?.activeYieldProfileId || null,
    planningYieldProfileId: review.summary?.planningYieldProfileId || null,
  };
}
