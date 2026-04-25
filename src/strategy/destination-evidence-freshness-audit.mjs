function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function hoursSince(value, now = new Date()) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return (now.getTime() - parsed.getTime()) / (1000 * 60 * 60);
}

function freshnessStatus(ageHours, freshnessHours) {
  if (ageHours == null) return "missing";
  if (!Number.isFinite(freshnessHours) || freshnessHours <= 0) return "unknown";
  return ageHours <= freshnessHours ? "fresh" : "stale";
}

export function buildDestinationEvidenceFreshnessAudit({ workbench = null, evidencePolicy = null, now = new Date() } = {}) {
  const generatedAt = new Date(now).toISOString();
  const policyByTemplate = byTemplateId(evidencePolicy?.items);

  const items = (workbench?.workItems || []).map((item) => {
    const policyItem = policyByTemplate.get(item.templateId) || null;
    const lastVerifiedAt = item.values?.lastVerifiedAt ?? null;
    const ageHours = hoursSince(lastVerifiedAt, now);
    const freshnessHours = policyItem?.policy?.freshnessHours ?? null;
    const status = freshnessStatus(ageHours, freshnessHours);

    return {
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId,
      label: item.label,
      category: item.category,
      score: item.score,
      lastVerifiedAt,
      freshnessHours,
      ageHours: ageHours == null ? null : Math.round(ageHours * 10000) / 10000,
      freshnessStatus: status,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      itemCount: items.length,
      freshCount: items.filter((item) => item.freshnessStatus === "fresh").length,
      staleCount: items.filter((item) => item.freshnessStatus === "stale").length,
      missingCount: items.filter((item) => item.freshnessStatus === "missing").length,
      topStaleOrMissing: items
        .filter((item) => item.freshnessStatus === "stale" || item.freshnessStatus === "missing")
        .sort(
          (left, right) =>
            (right.score ?? 0) - (left.score ?? 0) ||
            String(left.templateId).localeCompare(String(right.templateId)),
        )
        .slice(0, 15),
    },
    items,
  };
}
