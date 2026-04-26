function byTemplateId(entries = []) {
  const map = new Map();
  for (const entry of entries || []) {
    const list = map.get(entry.templateId) || [];
    list.push(entry);
    map.set(entry.templateId, list);
  }
  return map;
}

function latestByField(entries = []) {
  const map = new Map();
  for (const entry of entries || []) {
    const current = map.get(entry.field);
    const currentTime = current ? new Date(current.observedAt).getTime() : -Infinity;
    const nextTime = new Date(entry.observedAt).getTime();
    if (!current || nextTime >= currentTime) {
      map.set(entry.field, entry);
    }
  }
  return Object.fromEntries(map.entries());
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function latestObservedAt(entries = []) {
  let latest = null;
  let latestTime = -Infinity;
  for (const entry of entries || []) {
    const nextTime = new Date(entry.observedAt).getTime();
    if (Number.isNaN(nextTime) || nextTime < latestTime) continue;
    latestTime = nextTime;
    latest = entry.observedAt;
  }
  return latest;
}

function fieldObservationCounts(entries = [], fields = []) {
  return Object.fromEntries(
    (fields || []).map((field) => [field, (entries || []).filter((entry) => entry.field === field).length]),
  );
}

function policyByTemplate(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function dayKey(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function effectiveFieldObservationCounts({
  item = {},
  latest = {},
  counts = {},
  volatileFields = [],
} = {}) {
  const nextCounts = { ...counts };
  const verificationCarryForwardFields = [];
  const lastVerifiedDay = dayKey(item.values?.lastVerifiedAt);
  if (!lastVerifiedDay) {
    return {
      effectiveCounts: nextCounts,
      verificationCarryForwardFields,
    };
  }

  for (const field of volatileFields || []) {
    const latestFieldObservation = latest[field];
    if (!latestFieldObservation) continue;
    if (item.values?.[field] == null) continue;
    const latestObservedDay = dayKey(latestFieldObservation.observedAt);
    if (!latestObservedDay || lastVerifiedDay <= latestObservedDay) continue;
    nextCounts[field] = (nextCounts[field] || 0) + 1;
    verificationCarryForwardFields.push(field);
  }

  return {
    effectiveCounts: nextCounts,
    verificationCarryForwardFields,
  };
}

function requiredEconomicFields(item = {}) {
  if (item.category === "yield" || item.category === "arbitrage") {
    return ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"];
  }
  return [];
}

function measurementMode(item = {}) {
  if (item.category === "yield" && item.familyId?.includes("lending")) return "lending_snapshot";
  if (item.category === "yield" && item.familyId?.includes("lp")) return "lp_snapshot";
  if (item.category === "yield" && item.familyId?.includes("yield")) return "vault_snapshot";
  if (item.category === "arbitrage") return "spread_snapshot";
  return "manual_snapshot";
}

function latestBlockersByTemplate(entries = []) {
  const map = new Map();
  for (const entry of entries || []) {
    if (!entry?.templateId) continue;
    const current = map.get(entry.templateId);
    const currentTime = current ? new Date(current.observedAt).getTime() : -Infinity;
    const nextTime = new Date(entry.observedAt).getTime();
    if (!current || nextTime >= currentTime) {
      map.set(entry.templateId, entry);
    }
  }
  return map;
}

export function buildDestinationEconomicsLedger({
  observations = null,
  workbench = null,
  blockers = null,
  evidencePolicy = null,
} = {}) {
  const generatedAt = observations?.generatedAt || workbench?.generatedAt || new Date().toISOString();
  const entriesByTemplate = byTemplateId(observations?.entries || []);
  const blockerByTemplate = latestBlockersByTemplate(blockers?.entries || []);
  const policiesByTemplate = policyByTemplate(evidencePolicy?.items);

  const items = (workbench?.workItems || [])
    .filter((item) => requiredEconomicFields(item).length > 0)
    .map((item) => {
      const targetFields = requiredEconomicFields(item);
      const entries = (entriesByTemplate.get(item.templateId) || []).filter((entry) => targetFields.includes(entry.field));
      const latest = latestByField(entries);
      const coveredFields = targetFields.filter((field) => latest[field]);
      const missingEconomicFields = targetFields.filter((field) => !latest[field]);
      const sourceNames = unique(entries.map((entry) => entry.sourceName));
      const sourceTypes = unique(entries.map((entry) => entry.sourceType));
      const observedAtValues = unique(entries.map((entry) => entry.observedAt));
      const blocker = blockerByTemplate.get(item.templateId) || null;
      const counts = fieldObservationCounts(entries, targetFields);
      const { effectiveCounts, verificationCarryForwardFields } = effectiveFieldObservationCounts({
        item,
        latest,
        counts,
        volatileFields: policiesByTemplate.get(item.templateId)?.policy?.volatileFields || [],
      });
      return {
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        measurementMode: measurementMode(item),
        targetEconomicFields: targetFields,
        missingEconomicFields,
        coveredFields,
        coveragePct:
          targetFields.length === 0
            ? 1
            : Math.round((coveredFields.length / targetFields.length) * 10000) / 10000,
        entryCount: entries.length,
        sourceCount: unique(entries.map((entry) => `${entry.sourceType || "unknown"}::${entry.sourceName || "unknown"}`)).length,
        sourceNames,
        sourceTypes,
        observedAtCount: observedAtValues.length,
        latestObservedAt: latestObservedAt(entries),
        fieldObservationCounts: counts,
        effectiveFieldObservationCounts: effectiveCounts,
        verificationCarryForwardFields,
        latestObservations: latest,
        blocker,
      };
    });

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      itemCount: items.length,
      fullCoverageCount: items.filter((item) => item.coveragePct === 1).length,
      partialCoverageCount: items.filter((item) => item.coveragePct > 0 && item.coveragePct < 1).length,
      zeroCoverageCount: items.filter((item) => item.coveragePct === 0).length,
      blockedCount: items.filter((item) => item.blocker != null).length,
      topCoverage: items
        .slice()
        .sort((left, right) => (right.coveragePct ?? 0) - (left.coveragePct ?? 0) || String(left.templateId).localeCompare(String(right.templateId)))
        .slice(0, 15),
    },
    items,
  };
}
