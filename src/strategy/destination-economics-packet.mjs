function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function measurementMode(item = {}) {
  if (item.category === "yield" && item.familyId.includes("lending")) return "lending_snapshot";
  if (item.category === "yield" && item.familyId.includes("lp")) return "lp_snapshot";
  if (item.category === "yield" && item.familyId.includes("yield")) return "vault_snapshot";
  if (item.category === "arbitrage") return "spread_snapshot";
  return "manual_snapshot";
}

function commandSuggestion(templateId, fields = []) {
  const firstField = fields[0] || "<field>";
  return [
    `node src/cli/add-destination-economics-observation.mjs --template-id=${templateId} --field=${firstField} --value=<value> --source-name='<sourceName>' --source-type=<sourceType> --observed-at=<observedAt> --note='<note>' --write`,
    "npm run sync:destination-economics-observations -- --write",
  ].join(" && ");
}

export function buildDestinationEconomicsPacket({ economicsQueue = null, workbench = null, freshnessAudit = null } = {}) {
  const generatedAt = economicsQueue?.generatedAt || new Date().toISOString();
  const workbenchByTemplate = byTemplateId(workbench?.workItems);
  const freshnessByTemplate = byTemplateId(freshnessAudit?.items);

  const items = (economicsQueue?.queue || []).map((queueItem) => {
    const workbenchItem = workbenchByTemplate.get(queueItem.templateId) || null;
    const freshnessItem = freshnessByTemplate.get(queueItem.templateId) || null;
    const fields = queueItem.missingEconomicFields || [];

    return {
      templateId: queueItem.templateId,
      chain: queueItem.chain,
      familyId: queueItem.familyId,
      label: queueItem.label,
      category: queueItem.category,
      priorityScore: queueItem.priorityScore,
      missingEconomicFields: fields,
      missingFieldCount: fields.length,
      freshnessStatus: freshnessItem?.freshnessStatus ?? "unknown",
      measurementMode: measurementMode(queueItem),
      sourceName: workbenchItem?.values?.sourceName ?? null,
      sourceType: workbenchItem?.values?.sourceType ?? null,
      commandSuggestion: commandSuggestion(queueItem.templateId, fields),
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      itemCount: items.length,
      byMeasurementMode: Object.entries(
        items.reduce((acc, item) => {
          acc[item.measurementMode] = (acc[item.measurementMode] || 0) + 1;
          return acc;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .map(([mode, count]) => ({ mode, count })),
      topPacketItems: items.slice(0, 15),
    },
    items,
  };
}
