function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function allocationStatus(item = {}) {
  return item?.allocationGate?.status || "review_only";
}

function allocationBlockers(item = {}) {
  if (Array.isArray(item.allocationGate?.blockers)) return item.allocationGate.blockers;
  return item.allocationGate?.status ? [] : ["allocation_gate_missing"];
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function perItemCapUsd(item, kind) {
  const estimate = kind === "active"
    ? item?.economics?.activeBudgetEstimate
    : item?.economics?.planningBudgetEstimate;
  const direct = finitePositive(estimate?.maxAllocationUsd);
  if (direct !== null) return direct;
  const stratCap = finitePositive(item?.caps?.perChainUsd?.[item?.chain]);
  return stratCap;
}

function scoreWeight(item) {
  const score = Number(item?.score);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

function distributeBudget({ items, budgetUsd, kind }) {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || !items.length) {
    return { allocations: [], remaining: Number.isFinite(budgetUsd) ? budgetUsd : null };
  }
  const eligible = items.filter((item) => {
    const estimate = kind === "active"
      ? item.economics?.activeBudgetEstimate
      : item.economics?.planningBudgetEstimate;
    return estimate?.passesPolicy === true;
  });
  if (!eligible.length) return { allocations: [], remaining: budgetUsd };

  const totalWeight = eligible.reduce((sum, item) => sum + scoreWeight(item), 0);
  let remaining = budgetUsd;
  const allocations = [];
  for (const item of eligible) {
    if (remaining <= 0) break;
    const weight = scoreWeight(item);
    const weightShare = totalWeight > 0
      ? (weight / totalWeight) * budgetUsd
      : budgetUsd / eligible.length;
    const itemCap = perItemCapUsd(item, kind);
    const cappedShare = itemCap !== null ? Math.min(weightShare, itemCap) : weightShare;
    const allocationUsd = Math.max(0, Math.min(remaining, cappedShare));
    if (allocationUsd <= 0) continue;
    const estimate = kind === "active"
      ? item.economics?.activeBudgetEstimate
      : item.economics?.planningBudgetEstimate;
    allocations.push({
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId,
      label: item.label,
      score: scoreWeight(item),
      allocationUsd,
      estimatedNetBps: estimate?.estimatedNetBps ?? null,
      estimatedNetUsd: estimate?.estimatedNetUsd ?? null,
    });
    remaining -= allocationUsd;
  }
  return { allocations, remaining };
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

  const activeResult = Number.isFinite(activeBudgetUsd)
    ? distributeBudget({ items: allocationReady, budgetUsd: activeBudgetUsd, kind: "active" })
    : { allocations: [], remaining: null };
  const planningResult = Number.isFinite(planningBudgetUsd)
    ? distributeBudget({ items: allocationReady, budgetUsd: planningBudgetUsd, kind: "planning" })
    : { allocations: [], remaining: null };

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
      activeAllocationCount: activeResult.allocations.length,
      planningAllocationCount: planningResult.allocations.length,
      activeBudgetRemainingUsd: activeResult.remaining,
      planningBudgetRemainingUsd: planningResult.remaining,
      blockedSummary,
      allocationBlockedSummary,
      topReviewOnly: reviewOnly.slice(0, 10).map((item) => ({
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        score: item.score,
        blockers: allocationBlockers(item),
        nextAction: item.allocationGate?.nextAction || null,
      })),
    },
    activePlan: activeResult.allocations,
    planningPlan: planningResult.allocations,
  };
}
