function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function allocationStatus(item = {}) {
  return item?.allocationGate?.status || "allocation_ready";
}

export function buildDestinationAllocationPlanner({ promotionGate = null, economics = null } = {}) {
  const generatedAt = promotionGate?.generatedAt || new Date().toISOString();
  const economicsByTemplate = byTemplateId(economics?.items);

  const promotable = (promotionGate?.items || [])
    .filter((item) => item.gate?.status === "promotable")
    .map((item) => ({
      ...item,
      economics: economicsByTemplate.get(item.templateId) || null,
    }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || String(left.templateId).localeCompare(String(right.templateId)));
  const allocationReady = promotable.filter((item) => allocationStatus(item) === "allocation_ready");
  const reviewOnly = promotable.filter((item) => allocationStatus(item) === "review_only");

  const activeBudgetUsd = economics?.budgets?.activeBudgetUsd ?? null;
  const planningBudgetUsd = economics?.budgets?.planningBudgetUsd ?? null;

  const activeAllocations = [];
  let remainingActiveBudget = Number.isFinite(activeBudgetUsd) ? activeBudgetUsd : null;
  if (Number.isFinite(activeBudgetUsd)) {
    for (const item of allocationReady) {
      if (!item.economics?.activeBudgetEstimate?.passesPolicy) continue;
      const allocationUsd = Math.min(remainingActiveBudget, activeBudgetUsd);
      if (allocationUsd <= 0) continue;
      activeAllocations.push({
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        allocationUsd,
        estimatedNetBps: item.economics?.activeBudgetEstimate?.estimatedNetBps ?? null,
        estimatedNetUsd: item.economics?.activeBudgetEstimate?.estimatedNetUsd ?? null,
      });
      remainingActiveBudget -= allocationUsd;
    }
  }

  const planningAllocations = [];
  let remainingPlanningBudget = Number.isFinite(planningBudgetUsd) ? planningBudgetUsd : null;
  if (Number.isFinite(planningBudgetUsd)) {
    for (const item of allocationReady) {
      if (!item.economics?.planningBudgetEstimate?.passesPolicy) continue;
      const allocationUsd = Math.min(remainingPlanningBudget, planningBudgetUsd);
      if (allocationUsd <= 0) continue;
      planningAllocations.push({
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        allocationUsd,
        estimatedNetBps: item.economics?.planningBudgetEstimate?.estimatedNetBps ?? null,
        estimatedNetUsd: item.economics?.planningBudgetEstimate?.estimatedNetUsd ?? null,
      });
      remainingPlanningBudget -= allocationUsd;
    }
  }

  const blockedSummary = (promotionGate?.summary?.topBlockers || []).slice(0, 12);
  const allocationBlockedSummary = (promotionGate?.summary?.topAllocationBlockers || []).slice(0, 12);

  return {
    schemaVersion: 1,
    generatedAt,
    budgets: {
      activeBudgetUsd,
      planningBudgetUsd,
    },
    summary: {
      promotableCount: promotable.length,
      allocationReadyCount: allocationReady.length,
      reviewOnlyCount: reviewOnly.length,
      activeAllocationCount: activeAllocations.length,
      planningAllocationCount: planningAllocations.length,
      activeBudgetRemainingUsd: remainingActiveBudget,
      planningBudgetRemainingUsd: remainingPlanningBudget,
      blockedSummary,
      allocationBlockedSummary,
      topReviewOnly: reviewOnly.slice(0, 10).map((item) => ({
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        score: item.score,
        blockers: item.allocationGate?.blockers || [],
        nextAction: item.allocationGate?.nextAction || null,
      })),
    },
    activePlan: activeAllocations,
    planningPlan: planningAllocations,
  };
}
