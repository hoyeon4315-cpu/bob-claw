const TIER_MULTIPLIER = Object.freeze({
  A: 1,
  B: 0.6,
  C: 0.25,
  X: 0,
});

const TRUST_TIER_CATALOG = Object.freeze({
  aave_v3: {
    label: "Aave v3",
    tier: "A",
    rationale: "Mature lending venue with multi-year production history, multiple audits, and large TVL.",
  },
  morpho: {
    label: "Morpho",
    tier: "B",
    rationale: "Established but younger than Tier A venues; audited with material TVL but still treated conservatively.",
  },
  euler: {
    label: "Euler",
    tier: "B",
    rationale: "Post-relaunch venue with audits and meaningful usage, but still held below Tier A pending longer clean runtime.",
  },
  moonwell: {
    label: "Moonwell",
    tier: "B",
    rationale: "Base-focused lending venue with meaningful TVL and audits, but not promoted to Tier A in this policy.",
  },
  gmx: {
    label: "GMX",
    tier: "B",
    rationale: "Large and battle-tested perp venue, but perp-specific execution and funding risks keep it below Tier A here.",
  },
  vertex: {
    label: "Vertex",
    tier: "B",
    rationale: "Audited on-chain perp venue with adoption, but still conservative versus Tier A benchmarks.",
  },
  synthetix_v3: {
    label: "Synthetix v3",
    tier: "A",
    rationale: "Long-lived protocol family with major ecosystem usage and operational history.",
  },
  lombard: {
    label: "Lombard",
    tier: "B",
    rationale: "Meaningful BTC wrapper ecosystem presence, but still below Tier A due relative age and wrapper-specific dependencies.",
  },
  dolomite: {
    label: "Dolomite",
    tier: "B",
    rationale: "Audited and established enough for conservative admission, but not Tier A.",
  },
  pendle: {
    label: "Pendle",
    tier: "B",
    rationale: "Material adoption and audits, but still treated conservatively for allocation scaling.",
  },
  PAXG: {
    label: "PAX Gold",
    tier: "B",
    rationale: "Long-lived tokenized gold product, but issuer and redemption-path concentration keep it below Tier A.",
  },
  XAUT: {
    label: "Tether Gold",
    tier: "B",
    rationale: "Established tokenized gold product, but centralized issuer and redemption dependencies keep it conservative.",
  },
  USDY: {
    label: "Ondo USDY",
    tier: "B",
    rationale: "Institutional-style yield sleeve with real-world asset dependencies; treated conservatively.",
  },
  bIB01: {
    label: "Backed IB01",
    tier: "B",
    rationale: "Tokenized treasury exposure with issuer and market-structure dependencies; conservative but recordable.",
  },
});

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function item({ id, label, tier, appliesTo = [], rationale, status = "recorded" }) {
  return {
    id,
    label,
    tier,
    multiplier: TIER_MULTIPLIER[tier] ?? 0,
    appliesTo: unique(appliesTo),
    rationale,
    status,
  };
}

function collectTargets({ wrappedBtcLendingLoopSlice = null, secondaryStrategyScaffolds = null } = {}) {
  const targets = new Map();
  const add = (id, appliesTo) => {
    if (!id) return;
    const current = targets.get(id) || [];
    targets.set(id, unique([...current, ...appliesTo]));
  };
  const wrappedStrategyId = wrappedBtcLendingLoopSlice?.strategy?.id || "wrapped-btc-loop-base-moonwell";
  add(wrappedBtcLendingLoopSlice?.strategy?.protocol, [wrappedStrategyId]);
  for (const scaffold of secondaryStrategyScaffolds?.scaffolds || []) {
    const protocolTrack = scaffold?.protocolTrack || {};
    for (const id of [...(protocolTrack.protocols || []), ...(protocolTrack.venues || []), ...(protocolTrack.assets || [])]) {
      add(id, [scaffold.id]);
    }
  }
  return [...targets.entries()].map(([id, appliesTo]) => ({ id, appliesTo }));
}

export function buildProtocolTrustTiers({
  wrappedBtcLendingLoopSlice = null,
  secondaryStrategyScaffolds = null,
  now = null,
} = {}) {
  const targets = collectTargets({ wrappedBtcLendingLoopSlice, secondaryStrategyScaffolds });
  const items = targets.map(({ id, appliesTo }) => {
    const catalogItem = TRUST_TIER_CATALOG[id];
    if (!catalogItem) {
      return item({
        id,
        label: id,
        tier: "X",
        appliesTo,
        rationale: "No trust-tier record exists yet for this dependency.",
        status: "review_required",
      });
    }
    return item({
      id,
      label: catalogItem.label,
      tier: catalogItem.tier,
      appliesTo,
      rationale: catalogItem.rationale,
      status: "recorded",
    });
  });
  const reviewRequired = items.filter((entry) => entry.status !== "recorded");
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      itemCount: items.length,
      recordedCount: items.filter((entry) => entry.status === "recorded").length,
      reviewRequiredCount: reviewRequired.length,
      nextAction: reviewRequired.length > 0 ? { code: "review_missing_protocol_tiers", command: null } : null,
    },
    items,
  };
}

export function resolveTrustTierDecision(report = null, targetIds = []) {
  const itemsById = new Map((report?.items || []).map((entry) => [entry.id, entry]));
  const entries = unique(targetIds).map((id) => itemsById.get(id)).filter(Boolean);
  const missingTargets = unique(targetIds).filter((id) => !itemsById.has(id));
  const reviewRequiredTargets = entries.filter((entry) => entry.status !== "recorded").map((entry) => entry.id);
  const forbiddenTargets = entries.filter((entry) => entry.tier === "X").map((entry) => entry.id);
  return {
    recorded: missingTargets.length === 0 && reviewRequiredTargets.length === 0 && forbiddenTargets.length === 0,
    missingTargets,
    reviewRequiredTargets,
    forbiddenTargets,
    entries,
  };
}

export function summarizeProtocolTrustTiers(report = null) {
  if (!report) return null;
  return {
    itemCount: report.summary?.itemCount ?? 0,
    recordedCount: report.summary?.recordedCount ?? 0,
    reviewRequiredCount: report.summary?.reviewRequiredCount ?? 0,
    nextAction: report.summary?.nextAction || null,
  };
}
