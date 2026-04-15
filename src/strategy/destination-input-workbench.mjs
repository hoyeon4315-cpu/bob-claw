function overrideMap(overrides = null) {
  const map = new Map();
  for (const entry of overrides?.entries || []) {
    if (!entry?.templateId) continue;
    map.set(entry.templateId, entry);
  }
  return map;
}

function suggestedEvidenceSources(template = {}) {
  if (template.category === "yield") {
    return ["official protocol docs", "official app position screen", "onchain vault or lending state"];
  }
  if (template.category === "platform") {
    return ["official BOB Gateway docs", "official destination action docs"];
  }
  if (template.category === "arbitrage") {
    return ["live quote pair", "onchain pool state", "fee estimator"];
  }
  return ["official docs", "onchain state"];
}

function mergeDefaults(template = {}, override = null) {
  const merged = { ...(template.defaults || {}) };
  for (const [key, value] of Object.entries(override?.values || {})) {
    merged[key] = value;
  }
  return merged;
}

function missingFields(requiredFields = [], values = {}) {
  return requiredFields.filter((field) => values[field] == null);
}

function readinessFromMissing(missing = []) {
  if (missing.length === 0) return 1;
  return Math.max(0, 1 - missing.length / 10);
}

export function buildDestinationInputWorkbench({ admissionChecklist = null, overrides = null } = {}) {
  const generatedAt = admissionChecklist?.generatedAt || new Date().toISOString();
  const overridesByTemplate = overrideMap(overrides);

  const workItems = (admissionChecklist?.chains || [])
    .flatMap((chain) =>
      (chain.templates || []).map((template) => {
        const override = overridesByTemplate.get(template.templateId) || null;
        const mergedValues = mergeDefaults(template, override);
        const missing = missingFields(template.admission.requiredFields || [], mergedValues);
        const readiness = readinessFromMissing(missing);

        return {
          templateId: template.templateId,
          chain: template.chain,
          familyId: template.familyId,
          label: template.label,
          category: template.category,
          gateStatus: template.gateStatus,
          score: template.scoring?.deploymentPriorityScore ?? 0,
          overfitRisk: template.overfitRisk,
          requiredFields: template.admission.requiredFields || [],
          missingFields: missing,
          filledFieldCount: (template.admission.requiredFields || []).length - missing.length,
          readinessScore: Number(readiness.toFixed(4)),
          suggestedEvidenceSources: suggestedEvidenceSources(template),
          nextAction: template.nextAction,
          notes: template.notes || [],
          overrideStatus: override ? "partially_seeded" : "empty",
          values: mergedValues,
        };
      }),
    )
    .sort(
      (left, right) =>
        (right.score ?? 0) - (left.score ?? 0) ||
        (left.missingFields?.length ?? 0) - (right.missingFields?.length ?? 0) ||
        String(left.templateId).localeCompare(String(right.templateId)),
    );

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      workItemCount: workItems.length,
      seededCount: workItems.filter((item) => item.overrideStatus === "partially_seeded").length,
      emptyCount: workItems.filter((item) => item.overrideStatus === "empty").length,
      topWorkItems: workItems.slice(0, 15).map((item) => ({
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        score: item.score,
        missingFieldCount: item.missingFields.length,
        overrideStatus: item.overrideStatus,
      })),
    },
    workItems,
  };
}
