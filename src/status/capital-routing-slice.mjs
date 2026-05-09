function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

export function buildCapitalRoutingSummary(capitalRoutingPlan = null) {
  const routingPlan = Array.isArray(capitalRoutingPlan?.routingPlan) ? capitalRoutingPlan.routingPlan : [];
  const unresolvable = Array.isArray(capitalRoutingPlan?.unresolvable) ? capitalRoutingPlan.unresolvable : [];
  const classificationBreakdown = {};
  for (const row of [...routingPlan, ...unresolvable]) {
    increment(classificationBreakdown, row.classification);
  }
  return {
    totalExpectedDailyUsdOnResolve: finiteNumber(capitalRoutingPlan?.totalExpectedDailyUsdOnResolve) ?? 0,
    planCount: routingPlan.length,
    unresolvableCount: unresolvable.length,
    classificationBreakdown,
  };
}
