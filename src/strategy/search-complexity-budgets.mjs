function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function entry({ id, label, status = "recorded", dimensions = {}, rationale = null, appliesTo = [] } = {}) {
  return {
    id,
    label,
    status,
    dimensions,
    rationale,
    appliesTo: unique(appliesTo),
  };
}

export function buildSearchComplexityBudgets({ secondaryStrategyScaffolds = null, now = null } = {}) {
  const scaffoldById = new Map((secondaryStrategyScaffolds?.scaffolds || []).map((item) => [item.id, item]));
  const stable = scaffoldById.get("stablecoin_spread_loop");
  const proxy = scaffoldById.get("proxy_spread_expansion");
  const entries = [
    stable
      ? entry({
          id: "stablecoin_spread_loop_validation",
          label: "Stablecoin spread loop search budget",
          dimensions: {
            chains: stable.protocolTrack?.chains?.length ?? 0,
            protocols: stable.protocolTrack?.protocols?.length ?? 0,
            collateralAssets: stable.protocolTrack?.collateralAsset ? 1 : 0,
            borrowAssets: stable.protocolTrack?.borrowAsset ? 1 : 0,
            unwindPaths: 1,
          },
          rationale: "The stable loop search surface is explicitly bounded to a single chain and a fixed protocol shortlist before any broader expansion.",
          appliesTo: ["stablecoin_spread_loop", "stablecoin_spread_loop_validation"],
        })
      : null,
    proxy
      ? entry({
          id: "proxy_spread_expansion_validation",
          label: "Proxy spread expansion search budget",
          dimensions: {
            chains: proxy.protocolTrack?.chains?.length ?? 0,
            wrappers: proxy.protocolTrack?.wrappers?.length ?? 0,
            bridgeFamilies: 1,
            amountLadderTiers: 3,
          },
          rationale: "Proxy spread work is bounded to a declared wrapper set, fixed chain set, and a small amount ladder before any live promotion.",
          appliesTo: ["proxy_spread_expansion", "proxy_spread_expansion_validation"],
        })
      : null,
  ].filter(Boolean);
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      itemCount: entries.length,
      recordedCount: entries.filter((item) => item.status === "recorded").length,
      nextAction: null,
    },
    items: entries,
  };
}

export function resolveSearchComplexityBudget(report = null, id = null) {
  return (report?.items || []).find((item) => item.id === id || (item.appliesTo || []).includes(id)) || null;
}
