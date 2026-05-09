function normalizeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strategyFamily(strategy = {}) {
  return normalizeString(strategy.familyId || strategy.family || strategy.exposure?.assetFamily || strategy.caps?.exposure?.assetFamily);
}

function strategyChain(strategy = {}) {
  return normalizeString(strategy.chain || Object.keys(strategy.caps?.perChainUsd || {})[0]);
}

function directEvidenceExists(evidence = null) {
  return evidence?.evidenceClass === "receipt" || evidence?.evidenceClass === "shadow";
}

function receiptEvidenceUsable(evidence = null) {
  return evidence?.evidenceClass === "receipt" &&
    finiteNumber(evidence.measuredEdgeBpsPerDay) !== null &&
    finiteNumber(evidence.measuredRoundTripCostUsd) !== null;
}

function sampleCount(evidence = null) {
  return finiteNumber(evidence?.freshness?.sampleCount) ?? finiteNumber(evidence?.sampleCount) ?? 0;
}

export function buildSiblingProxyEdgeRecords({
  strategies = [],
  targetStrategies = strategies,
  directEvidenceByStrategy = {},
  confidence = 0.4,
} = {}) {
  const strategyById = new Map((strategies || []).map((strategy) => [strategy.strategyId, strategy]));
  const evidenceFor = (strategyId) => directEvidenceByStrategy instanceof Map
    ? directEvidenceByStrategy.get(strategyId)
    : directEvidenceByStrategy?.[strategyId];

  const records = [];
  for (const target of targetStrategies || []) {
    if (!target?.strategyId) continue;
    if (directEvidenceExists(evidenceFor(target.strategyId))) continue;
    const family = strategyFamily(target);
    if (!family) continue;
    const targetChain = strategyChain(target);
    const siblings = (strategies || [])
      .filter((strategy) => strategy?.strategyId && strategy.strategyId !== target.strategyId)
      .filter((strategy) => strategyFamily(strategy) === family)
      .map((strategy) => ({
        strategy,
        evidence: evidenceFor(strategy.strategyId),
      }))
      .filter(({ evidence }) => receiptEvidenceUsable(evidence))
      .sort((left, right) =>
        sampleCount(right.evidence) - sampleCount(left.evidence) ||
        String(left.strategy.strategyId).localeCompare(String(right.strategy.strategyId)),
      );
    const selected = siblings[0] || null;
    if (!selected) continue;
    const sourceStrategy = strategyById.get(selected.strategy.strategyId) || selected.strategy;
    records.push({
      strategyId: target.strategyId,
      chain: targetChain,
      evidenceClass: "sibling_proxy",
      borrowedFromStrategyId: selected.strategy.strategyId,
      borrowedFromChain: selected.evidence.chain || strategyChain(sourceStrategy),
      proxyEdgeBpsPerDay: selected.evidence.measuredEdgeBpsPerDay,
      proxyRoundTripCostUsd: selected.evidence.measuredRoundTripCostUsd,
      confidence,
      reason: "same_family_receipt_proxy",
    });
  }
  return records;
}
