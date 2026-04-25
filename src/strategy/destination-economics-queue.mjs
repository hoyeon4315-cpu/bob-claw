function neededFields(item = {}) {
  return item.missingEconomicFields || [];
}

function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function researchAdjustment(item = {}) {
  return {
    measure_numeric_economics: 0.03,
    run_allowlist_review: -0.05,
    seed_source_metadata: -0.06,
    collect_source_metadata: -0.04,
    satisfy_evidence_policy: -0.03,
  }[item?.nextAction] ?? 0;
}

function priority(item = {}, researchItem = null) {
  const parsedScore = Number(item.score);
  const baseScore = Number.isFinite(parsedScore) ? parsedScore : 0;
  const missingPenalty = neededFields(item).length * 0.005;
  const chainBoost = {
    base: 0.03,
    bsc: 0.03,
    bob: 0.02,
    bera: 0.01,
  }[item.chain] ?? 0;
  return Math.max(0, Math.round((baseScore + chainBoost + researchAdjustment(researchItem) - missingPenalty) * 10000) / 10000);
}

export function buildDestinationEconomicsQueue({ economics = null, researchQueue = null } = {}) {
  const generatedAt = economics?.generatedAt || new Date().toISOString();
  const researchByTemplate = byTemplateId(researchQueue?.queue);
  const queue = (economics?.items || [])
    .filter((item) => item.economicsStatus === "missing_inputs")
    .map((item) => {
      const researchItem = researchByTemplate.get(item.templateId) || null;
      return {
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        category: item.category,
        missingEconomicFields: neededFields(item),
        nextResearchAction: researchItem?.nextAction ?? null,
        nextResearchReason: researchItem?.reason ?? null,
        priorityScore: priority(item, researchItem),
      };
    })
    .sort(
      (left, right) =>
        (right.priorityScore ?? 0) - (left.priorityScore ?? 0) ||
        String(left.templateId).localeCompare(String(right.templateId)),
    );

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      queueCount: queue.length,
      topMissingFields: Object.entries(
        queue.flatMap((item) => item.missingEconomicFields).reduce((acc, field) => {
          acc[field] = (acc[field] || 0) + 1;
          return acc;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 10)
        .map(([field, count]) => ({ field, count })),
      topQueue: queue.slice(0, 15),
    },
    queue,
  };
}
