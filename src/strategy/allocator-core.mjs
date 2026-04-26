import { resolveVenueProtocols } from "../config/destination-venues.mjs";
import { representativeBindingForTemplate } from "../config/destination-representative-bindings.mjs";
import { resolveStableProtocols } from "../config/stable-venues.mjs";

const DIVERSIFICATION_TARGET_CHAINS = [
  "base",
  "bsc",
  "avalanche",
  "sonic",
  "bera",
  "unichain",
  "soneium",
];

const DIVERSIFICATION_TARGET_FAMILIES = [
  "stablecoin_lending_carry",
  "stablecoin_lp_or_basis",
  "wrapped_btc_lending",
  "wrapped_btc_lp_positions",
];

const PRIORITY_EXPANSION_CHAINS = ["avalanche", "sonic", "bera", "unichain", "soneium"];

const DESTINATION_PROTOCOL_OVERRIDES = {
  "base:stablecoin_lending_carry": ["aave_v3"],
  "bsc:stablecoin_lending_carry": ["venus"],
  "base:stablecoin_lp_or_basis": ["aerodrome"],
  "bsc:stablecoin_lp_or_basis": ["thena"],
  "avalanche:wrapped_btc_lending": ["benqi"],
  "bera:wrapped_btc_lending": ["dolomite"],
  "base:wrapped_btc_lp_positions": ["aerodrome"],
  "bsc:wrapped_btc_lp_positions": ["pancakeswap_v3"],
  "avalanche:wrapped_btc_lp_positions": ["lfj"],
  "bera:wrapped_btc_lp_positions": ["kodiak"],
  "bob:wrapped_btc_lp_positions": ["gamma"],
  "soneium:wrapped_btc_lp_positions": ["kyo"],
  "sonic:wrapped_btc_lp_positions": ["shadow"],
  "unichain:wrapped_btc_lp_positions": ["catex"],
};

const PROTOCOL_RISK_SCORE = Object.freeze({
  aave_v3: 0.86,
  aave: 0.84,
  compound_v3: 0.84,
  compound_v2: 0.78,
  morpho: 0.78,
  moonwell: 0.76,
  euler: 0.74,
  "euler-v2": 0.74,
  euler_v2: 0.74,
  venus: 0.70,
  benqi: 0.68,
  dolomite: 0.66,
  erc4626: 0.64,
  gateway: 0.82,
  odos: 0.72,
});

const CHAIN_EXECUTION_SCORE = Object.freeze({
  base: 0.92,
  bsc: 0.84,
  unichain: 0.78,
  avalanche: 0.76,
  optimism: 0.75,
  sonic: 0.70,
  soneium: 0.68,
  bera: 0.64,
  bob: 0.62,
  ethereum: 0.58,
  sei: 0.56,
});

const SCORE_WEIGHTS = Object.freeze({
  evidence: 0.30,
  execution: 0.25,
  risk: 0.20,
  return: 0.15,
  diversification: 0.10,
});

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function candidate({
  id,
  label,
  chain,
  protocols = [],
  assetFamily,
  category,
  activeEligibility = "blocked",
  planningEligibility = "review_only",
  blockers = [],
  evidence = null,
  nextAction = null,
}) {
  return {
    id,
    label,
    chain,
    protocols: unique(protocols),
    assetFamily,
    category,
    activeEligibility,
    planningEligibility,
    blockers: unique(blockers),
    evidence,
    nextAction,
  };
}

function allocationLimitUsd({ budgetUsd, constraints = {} } = {}) {
  if (!Number.isFinite(budgetUsd)) return null;
  const caps = [
    (constraints.capPerStrategyPct ?? 0) * budgetUsd,
    (constraints.capPerProtocolPct ?? 0) * budgetUsd,
    (constraints.capPerChainPct ?? 0) * budgetUsd,
    (constraints.capPerAssetFamilyPct ?? 0) * budgetUsd,
  ].filter(Number.isFinite);
  return caps.length ? Math.min(...caps) : null;
}

function destinationFamilyAssetFamily(familyId = "") {
  if (!familyId) return null;
  if (familyId.startsWith("stablecoin")) return "stables";
  if (familyId.startsWith("wrapped_btc") || familyId.startsWith("native_btc")) return "btc_wrappers";
  if (familyId.includes("reserve")) return "reserve_assets";
  return familyId;
}

function destinationCategory(familyId = "") {
  if (familyId?.includes("lp") || familyId?.includes("basis")) return "yield_lp";
  if (familyId?.includes("lending") || familyId?.includes("carry")) return "yield";
  return "yield";
}

function destinationProtocolIds(item = {}) {
  const explicit = item?.protocolIds || item?.protocols || item?.metadata?.protocolIds || null;
  if (Array.isArray(explicit) && explicit.length > 0) return unique(explicit);
  const override = DESTINATION_PROTOCOL_OVERRIDES[item?.templateId] || null;
  if (override?.length) return unique(override);
  const chain = item?.chain;
  const familyId = item?.familyId;
  if (chain && familyId) {
    const resolved = resolveVenueProtocols(chain, familyId);
    if (resolved?.protocols?.length) return unique(resolved.protocols);
    if (resolved?.status === "template_only") {
      return unique(["template_only"]);
    }
    if (familyId.startsWith("stablecoin")) {
      const stableResolved = resolveStableProtocols(chain);
      if (stableResolved?.protocols?.length) return unique(stableResolved.protocols);
      if (stableResolved?.status === "template_only") {
        return unique(["template_only"]);
      }
    }
  }
  if (item?.familyId) return [item.familyId];
  return [];
}

function representativeProtocolIds(item = {}) {
  if (Array.isArray(item?.protocols) && item.protocols.length > 0) return unique(item.protocols);
  if (item?.protocolId) return unique([item.protocolId]);
  const binding = representativeBindingForTemplate(item?.templateId);
  if (binding?.protocolId) return unique([binding.protocolId]);
  return destinationProtocolIds({
    templateId: item?.templateId,
    chain: item?.chain,
    familyId: item?.familyId || "stablecoin_lending_carry",
  });
}

function representativeCoverageCandidates(destinationRepresentative = null) {
  return (destinationRepresentative?.candidates || [])
    .filter((item) => item?.status === "covered" && item?.templateId && item?.chain)
    .map((item) => candidate({
      id: item.templateId,
      label: item.label || "Representative stablecoin lending carry",
      chain: item.chain,
      protocols: representativeProtocolIds(item),
      assetFamily: "stables",
      category: "yield",
      activeEligibility: "active_ready",
      planningEligibility: "allocation_ready",
      blockers: [],
      evidence: {
        source: "destination_representative_autopilot",
        status: "covered",
        latestObservedAt: destinationRepresentative.observedAt || null,
        proofStatus: item.proofStatus || destinationRepresentative?.summary?.proofStatus || null,
      },
      nextAction: { code: "monitor_representative_receipts" },
    }));
}

function mergeCandidatesById(candidates = []) {
  const rank = (item = {}) => {
    if (item.activeEligibility === "active_ready") return 0;
    if (item.planningEligibility === "allocation_ready") return 1;
    if (item.planningEligibility === "review_only") return 2;
    return 3;
  };
  const byId = new Map();
  for (const item of candidates) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (!existing || rank(item) < rank(existing) || (rank(item) === rank(existing) && (item.blockers || []).length < (existing.blockers || []).length)) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function destinationGateCandidate(item = {}) {
  if (!item?.templateId || !item?.familyId || !item?.chain) return null;
  const allocationStatus = item.allocationGate?.status || null;
  const gateStatus = item.gate?.status || null;
  const allocationBlockers = item.allocationGate?.blockers || [];
  const gateBlockers = item.gate?.blockers || [];
  const activeEligibility = allocationStatus === "allocation_ready" && gateStatus === "promotable"
    ? "active_ready"
    : "blocked";
  const planningEligibility = allocationStatus === "allocation_ready"
    ? "allocation_ready"
    : allocationStatus === "review_only"
      ? "review_only"
      : "blocked";
  const blockers = [...allocationBlockers, ...gateBlockers];
  if (gateStatus && gateStatus !== "promotable") blockers.push(`gate_${gateStatus}`);
  return candidate({
    id: item.templateId,
    label: item.label || item.templateId,
    chain: item.chain,
    protocols: destinationProtocolIds(item),
    assetFamily: destinationFamilyAssetFamily(item.familyId),
    category: destinationCategory(item.familyId),
    activeEligibility,
    planningEligibility,
    blockers,
    evidence: item.allocationGate?.evidence || item.evidence || null,
    nextAction: item.allocationGate?.nextAction || item.recommendation || null,
  });
}

function destinationGateCandidates(promotionGate = null) {
  const items = promotionGate?.items || [];
  return items
    .map((item) => destinationGateCandidate(item))
    .filter((item) => item?.id)
    .filter((item) => item.activeEligibility === "active_ready" || item.planningEligibility === "review_only" || item.planningEligibility === "allocation_ready");
}

function buildChainSupportIndex(destinationStrategyRegistry = null) {
  const map = new Map();
  for (const chain of destinationStrategyRegistry?.chains || []) {
    map.set(chain.chain, {
      arrivalAssetFamilies: new Set(chain.arrivalAssetFamilies || []),
      strategyFamilies: new Set((chain.strategies || []).map((item) => item.familyId).filter(Boolean)),
    });
  }
  return map;
}

function missingTemplateBlockers(chain, family, chainSupportIndex) {
  const support = chainSupportIndex.get(chain);
  const blockers = ["template_missing_for_chain_family"];
  if (!support) {
    blockers.push("chain_not_in_destination_registry");
    return blockers;
  }
  if (family?.startsWith("stablecoin")) {
    if (support.arrivalAssetFamilies.has("stablecoin")) {
      blockers.push("stablecoin_family_not_yet_seeded");
    } else {
      blockers.push("stablecoin_gateway_arrival_missing");
      if (support.arrivalAssetFamilies.has("wrapped_btc")) {
        blockers.push("stablecoin_indirect_via_wrapped_btc_possible");
      }
    }
  } else if (family?.startsWith("wrapped_btc")) {
    blockers.push(
      support.arrivalAssetFamilies.has("wrapped_btc")
        ? "wrapped_btc_family_not_yet_seeded"
        : "wrapped_btc_gateway_arrival_missing",
    );
  }
  return unique(blockers);
}

function buildChainCoverageMatrix(
  promotionGate = null,
  destinationStrategyRegistry = null,
  targetChains = DIVERSIFICATION_TARGET_CHAINS,
  targetFamilies = DIVERSIFICATION_TARGET_FAMILIES,
) {
  const items = promotionGate?.items || [];
  const chainSupportIndex = buildChainSupportIndex(destinationStrategyRegistry);
  const byKey = new Map();
  for (const item of items) {
    if (!item?.chain || !item?.familyId) continue;
    byKey.set(`${item.chain}:${item.familyId}`, item);
  }
  const matrix = [];
  const perChainStatuses = new Map();
  for (const chain of targetChains) {
    perChainStatuses.set(chain, { allocation_ready: 0, review_only: 0, blocked: 0, template_missing: 0 });
    for (const family of targetFamilies) {
      const key = `${chain}:${family}`;
      const item = byKey.get(key);
      if (!item) {
        matrix.push({
          chain,
          family,
          status: "template_missing",
          templateId: null,
          gateStatus: null,
          allocationStatus: null,
          blockers: missingTemplateBlockers(chain, family, chainSupportIndex),
        });
        perChainStatuses.get(chain).template_missing += 1;
        continue;
      }
      const allocationStatus = item.allocationGate?.status || "blocked";
      const gateStatus = item.gate?.status || null;
      const bucket = allocationStatus === "allocation_ready"
        ? "allocation_ready"
        : allocationStatus === "review_only"
          ? "review_only"
          : "blocked";
      perChainStatuses.get(chain)[bucket] += 1;
      matrix.push({
        chain,
        family,
        status: bucket,
        templateId: item.templateId || null,
        gateStatus,
        allocationStatus,
        blockers: unique([...(item.allocationGate?.blockers || []), ...(item.gate?.blockers || [])]),
      });
    }
  }
  const tier1ActiveReady = [];
  const tier2ReviewOnly = [];
  const tier3BlockedOnly = [];
  const tier4TemplateOnly = [];
  for (const [chain, counts] of perChainStatuses.entries()) {
    if (counts.allocation_ready > 0) tier1ActiveReady.push(chain);
    else if (counts.review_only > 0) tier2ReviewOnly.push(chain);
    else if (counts.blocked > 0) tier3BlockedOnly.push(chain);
    else tier4TemplateOnly.push(chain);
  }
  const perChain = targetChains.map((chain) => {
    const counts = perChainStatuses.get(chain);
    const chainRows = matrix.filter((row) => row.chain === chain);
    const support = chainSupportIndex.get(chain);
    const tier = tier1ActiveReady.includes(chain)
      ? "tier1_active_ready"
      : tier2ReviewOnly.includes(chain)
        ? "tier2_review_only"
        : tier3BlockedOnly.includes(chain)
          ? "tier3_blocked_only"
          : "tier4_template_only";
    const dominantBlockers = unique(chainRows.flatMap((row) => row.blockers || [])).slice(0, 8);
    return {
      chain,
      tier,
      counts: { ...counts },
      familyCount: chainRows.length,
      dominantBlockers,
      support: {
        arrivalAssetFamilies: [...(support?.arrivalAssetFamilies || [])].sort(),
        stablecoinArrivalSupported: support?.arrivalAssetFamilies?.has("stablecoin") || false,
        wrappedBtcArrivalSupported: support?.arrivalAssetFamilies?.has("wrapped_btc") || false,
        stablecoinIndirectViaWrappedBtcPossible:
          !(support?.arrivalAssetFamilies?.has("stablecoin") || false) &&
          (support?.arrivalAssetFamilies?.has("wrapped_btc") || false),
      },
      templateMissingFamilies: chainRows.filter((row) => row.status === "template_missing").map((row) => row.family),
    };
  });
  return {
    targetChains,
    targetFamilies,
    matrix,
    perChain,
    tiers: {
      tier1_active_ready: tier1ActiveReady,
      tier2_review_only: tier2ReviewOnly,
      tier3_blocked_only: tier3BlockedOnly,
      tier4_template_only: tier4TemplateOnly,
    },
    summary: {
      chainCount: targetChains.length,
      familyCount: targetFamilies.length,
      cellCount: matrix.length,
      allocationReadyCellCount: matrix.filter((row) => row.status === "allocation_ready").length,
      reviewOnlyCellCount: matrix.filter((row) => row.status === "review_only").length,
      blockedCellCount: matrix.filter((row) => row.status === "blocked").length,
      templateMissingCellCount: matrix.filter((row) => row.status === "template_missing").length,
      tier1ActiveReadyChainCount: tier1ActiveReady.length,
      tier2ReviewOnlyChainCount: tier2ReviewOnly.length,
      tier3BlockedOnlyChainCount: tier3BlockedOnly.length,
      tier4TemplateOnlyChainCount: tier4TemplateOnly.length,
      stablecoinGatewayArrivalMissingChains: perChain
        .filter((row) => !row.support.stablecoinArrivalSupported)
        .map((row) => row.chain),
      stablecoinIndirectViaWrappedBtcChains: perChain
        .filter((row) => row.support.stablecoinIndirectViaWrappedBtcPossible)
        .map((row) => row.chain),
    },
  };
}

function statusRank(candidate = null) {
  if (candidate?.activeEligibility === "active_ready") return 0;
  if (candidate?.planningEligibility === "allocation_ready") return 1;
  if (candidate?.planningEligibility === "review_only") return 2;
  if (candidate?.planningEligibility === "cap_deferred") return 3;
  return 4;
}

function protocolRiskScore(protocols = []) {
  const scores = (protocols || [])
    .map((protocol) => PROTOCOL_RISK_SCORE[String(protocol || "").trim()] ?? 0.60)
    .filter(Number.isFinite);
  if (scores.length === 0) return 0.55;
  return scores.reduce((sum, item) => sum + item, 0) / scores.length;
}

function evidenceScore(item = {}) {
  if (item.activeEligibility === "active_ready" && item.evidence?.source === "destination_representative_autopilot") return 1;
  if (item.activeEligibility === "active_ready") return 0.9;
  if (item.planningEligibility === "allocation_ready") return 0.78;
  if (item.planningEligibility === "review_only") return clamp(0.55 - (item.blockers || []).length * 0.06);
  return clamp(0.25 - (item.blockers || []).length * 0.04);
}

function executionScore(item = {}) {
  const base = CHAIN_EXECUTION_SCORE[item.chain] ?? 0.60;
  if (item.evidence?.source === "destination_representative_autopilot") return clamp(base + 0.12);
  if (item.activeEligibility === "active_ready") return base;
  if (item.planningEligibility === "allocation_ready") return clamp(base - 0.08);
  if (item.planningEligibility === "review_only") return clamp(base - 0.22);
  return clamp(base - 0.40);
}

function returnScore(item = {}) {
  const estimate =
    Number(item.evidence?.estimatedNetBps) ??
    Number(item.evidence?.grossReturnBps) ??
    Number(item.evidence?.projectedAnnualNetCarryUsd) ??
    null;
  if (Number.isFinite(estimate) && estimate > 0) return clamp(estimate / 1_000);
  if (item.assetFamily === "stables") return 0.58;
  if (item.assetFamily === "btc_wrappers") return 0.52;
  if (item.assetFamily === "reserve_assets") return 0.42;
  return 0.46;
}

function buildCandidateScores(items = []) {
  const chainCounts = new Map();
  for (const item of items.filter((candidate) => candidate.activeEligibility === "active_ready")) {
    chainCounts.set(item.chain, (chainCounts.get(item.chain) || 0) + 1);
  }
  return items.map((item) => {
    const details = {
      evidence: round(evidenceScore(item), 4),
      execution: round(executionScore(item), 4),
      risk: round(protocolRiskScore(item.protocols), 4),
      return: round(returnScore(item), 4),
      diversification: round(1 / (1 + (chainCounts.get(item.chain) || 0)), 4),
    };
    const score =
      details.evidence * SCORE_WEIGHTS.evidence +
      details.execution * SCORE_WEIGHTS.execution +
      details.risk * SCORE_WEIGHTS.risk +
      details.return * SCORE_WEIGHTS.return +
      details.diversification * SCORE_WEIGHTS.diversification;
    return {
      ...item,
      score: round(score, 4),
      scoreDetails: details,
    };
  });
}

function compareCandidates(left = null, right = null) {
  const leftRank = statusRank(left);
  const rightRank = statusRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  const scoreDelta = (right?.score ?? 0) - (left?.score ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  const leftBlockers = left?.blockers?.length || 0;
  const rightBlockers = right?.blockers?.length || 0;
  if (leftBlockers !== rightBlockers) return leftBlockers - rightBlockers;
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function topChainCandidate(items = []) {
  return [...items].sort(compareCandidates)[0] || null;
}

function buildPriorityChainExpansion(candidates = [], targetChains = PRIORITY_EXPANSION_CHAINS) {
  const perChain = targetChains.map((chain) => {
    const chainCandidates = candidates.filter((candidate) => candidate.chain === chain);
    const activeReady = chainCandidates.filter((candidate) => candidate.activeEligibility === "active_ready");
    const reviewOnly = chainCandidates.filter((candidate) => ["allocation_ready", "review_only"].includes(candidate.planningEligibility));
    const blocked = chainCandidates.filter((candidate) => !["allocation_ready", "review_only"].includes(candidate.planningEligibility));
    const topCandidate = topChainCandidate(chainCandidates);
    return {
      chain,
      activeReadyCount: activeReady.length,
      reviewOnlyCount: reviewOnly.length,
      blockedCount: blocked.length,
      topCandidate: topCandidate
        ? {
            id: topCandidate.id,
            label: topCandidate.label,
            protocols: topCandidate.protocols || [],
            assetFamily: topCandidate.assetFamily || null,
            activeEligibility: topCandidate.activeEligibility || null,
            planningEligibility: topCandidate.planningEligibility || null,
            blockers: topCandidate.blockers || [],
            nextAction: topCandidate.nextAction || null,
          }
        : null,
    };
  });
  return {
    targetChains,
    tier1ActiveReadyChains: perChain.filter((item) => item.activeReadyCount > 0).map((item) => item.chain),
    tier2ReviewOnlyChains: perChain.filter((item) => item.activeReadyCount === 0 && item.reviewOnlyCount > 0).map((item) => item.chain),
    tier3BlockedOnlyChains: perChain.filter((item) => item.activeReadyCount === 0 && item.reviewOnlyCount === 0 && item.blockedCount > 0).map((item) => item.chain),
    perChain,
  };
}

function preferredPortfolioCandidates(candidates = []) {
  return [...candidates].sort((left, right) => {
    const leftAnchor = left?.id === "recursive_wrapped_btc_lending_loop" ? 1 : 0;
    const rightAnchor = right?.id === "recursive_wrapped_btc_lending_loop" ? 1 : 0;
    if (leftAnchor !== rightAnchor && Math.abs((right?.score ?? 0) - (left?.score ?? 0)) < 0.08) return rightAnchor - leftAnchor;
    return compareCandidates(left, right);
  });
}

function buildDiversifiedPortfolioDraft({ candidates = [], priorityChainExpansion = null } = {}) {
  const selected = [];
  const usedChains = new Set();
  const usedProtocols = new Set();
  const usedFamilies = new Set();
  for (const item of preferredPortfolioCandidates(candidates).filter((candidate) => candidate.activeEligibility === "active_ready")) {
    const sameChain = usedChains.has(item.chain);
    const sameFamily = usedFamilies.has(item.assetFamily);
    const sameProtocol = (item.protocols || []).some((protocol) => usedProtocols.has(protocol));
    if (selected.length > 0 && sameChain && sameFamily && sameProtocol) continue;
    selected.push({
      id: item.id,
      label: item.label,
      chain: item.chain,
      protocols: item.protocols || [],
      assetFamily: item.assetFamily || null,
      planningEligibility: item.planningEligibility || null,
    });
    usedChains.add(item.chain);
    usedFamilies.add(item.assetFamily);
    for (const protocol of item.protocols || []) usedProtocols.add(protocol);
    if (selected.length >= 4) break;
  }
  const expansionQueue = (priorityChainExpansion?.perChain || [])
    .filter((item) => item.activeReadyCount === 0 && item.reviewOnlyCount > 0 && item.topCandidate)
    .map((item) => ({
      chain: item.chain,
      ...item.topCandidate,
    }));
  return {
    activeDraft: selected,
    reviewQueue: expansionQueue,
    summary: {
      activeDraftCount: selected.length,
      reviewQueueCount: expansionQueue.length,
      activeDraftChains: unique(selected.map((item) => item.chain)),
      activeDraftAssetFamilies: unique(selected.map((item) => item.assetFamily)),
    },
  };
}

function capBlockers({ chain, protocols, assetFamily, perItemLimit, budgetUsd, constraints, chainUsage, protocolUsage, assetFamilyUsage }) {
  if (!Number.isFinite(budgetUsd) || !Number.isFinite(perItemLimit)) return [];
  const blockers = [];
  const chainCap = (constraints.capPerChainPct ?? 0) * budgetUsd;
  if (chainCap > 0 && round((chainUsage.get(chain) || 0) + perItemLimit) > round(chainCap)) {
    blockers.push("chain_cap_exceeded");
  }
  const protocolCap = (constraints.capPerProtocolPct ?? 0) * budgetUsd;
  if (protocolCap > 0) {
    for (const protocol of protocols) {
      if (round((protocolUsage.get(protocol) || 0) + perItemLimit) > round(protocolCap)) {
        blockers.push("protocol_cap_exceeded");
        break;
      }
    }
  }
  const assetCap = (constraints.capPerAssetFamilyPct ?? 0) * budgetUsd;
  if (assetCap > 0 && round((assetFamilyUsage.get(assetFamily) || 0) + perItemLimit) > round(assetCap)) {
    blockers.push("asset_family_cap_exceeded");
  }
  return blockers;
}

function remainingCapLimit({ chain, protocols, assetFamily, perItemLimit, budgetUsd, constraints, chainUsage, protocolUsage, assetFamilyUsage }) {
  if (!Number.isFinite(budgetUsd) || !Number.isFinite(perItemLimit)) return perItemLimit;
  const limits = [perItemLimit];
  const chainCap = (constraints.capPerChainPct ?? 0) * budgetUsd;
  if (chainCap > 0) limits.push(Math.max(0, chainCap - (chainUsage.get(chain) || 0)));
  const protocolCap = (constraints.capPerProtocolPct ?? 0) * budgetUsd;
  if (protocolCap > 0) {
    for (const protocol of protocols || []) {
      limits.push(Math.max(0, protocolCap - (protocolUsage.get(protocol) || 0)));
    }
  }
  const assetCap = (constraints.capPerAssetFamilyPct ?? 0) * budgetUsd;
  if (assetCap > 0) limits.push(Math.max(0, assetCap - (assetFamilyUsage.get(assetFamily) || 0)));
  return round(Math.min(...limits));
}

function wrappedLoopCandidate({ wrappedBtcLendingLoopSlice = null, phase3Validation = null } = {}) {
  const validation = (phase3Validation?.validations || []).find((item) => item.id === "wrapped_btc_loop_validation") || null;
  const strategy = wrappedBtcLendingLoopSlice?.strategy || {};
  return candidate({
    id: strategy.id || "wrapped-btc-loop-base-moonwell",
    label: strategy.label || "Wrapped BTC lending loop",
    chain: strategy.chain || "base",
    protocols: [strategy.protocol || "moonwell"],
    assetFamily: "btc_wrappers",
    category: "yield",
    activeEligibility: validation?.overallStatus === "passed" ? "active_ready" : "blocked",
    planningEligibility: validation ? "review_only" : "blocked",
    blockers: validation?.blockers || ["phase3_validation_missing"],
    evidence: validation?.evidence || null,
    nextAction: validation?.nextAction || null,
  });
}

function recursiveLoopCandidate({ scaffold = null, phase3Validation = null } = {}) {
  const strategy = scaffold?.strategy || {};
  const validation = (phase3Validation?.validations || []).find((item) => item.id === `${strategy.id}_validation`) || null;
  if (!strategy.id) return null;
  return candidate({
    id: strategy.id,
    label: strategy.label || "Recursive lending loop",
    chain: strategy.chain || null,
    protocols: [strategy.protocol].filter(Boolean),
    assetFamily: strategy.arrivalFamily === "stablecoin" ? "stables" : "btc_wrappers",
    category: "yield",
    activeEligibility: validation?.overallStatus === "passed" ? "active_ready" : "blocked",
    planningEligibility: validation ? "review_only" : "blocked",
    blockers: validation?.blockers || ["phase3_validation_missing"],
    evidence: validation?.evidence || null,
    nextAction: validation?.nextAction || null,
  });
}

function scaffoldCandidate(scaffold = null, phase3Validation = null) {
  const validation = (phase3Validation?.validations || []).find((item) => item.id === `${scaffold?.id}_validation`) || null;
  const protocolTrack = scaffold?.protocolTrack || {};
  return candidate({
    id: scaffold?.id || null,
    label: scaffold?.label || null,
    chain: protocolTrack.chains?.[0] || null,
    protocols: [...(protocolTrack.protocols || []), ...(protocolTrack.venues || [])],
    assetFamily:
      scaffold?.id === "stablecoin_spread_loop"
        ? "stables"
        : scaffold?.id === "tokenized_reserve_sleeve"
          ? "reserve_assets"
          : "btc_wrappers",
    category: scaffold?.category || null,
    activeEligibility: validation?.overallStatus === "passed" ? "active_ready" : "blocked",
    planningEligibility: validation ? "review_only" : "blocked",
    blockers: [...(validation?.blockers || []), ...(scaffold?.blockers || [])],
    evidence: validation?.evidence || scaffold?.evidence || null,
    nextAction: validation?.nextAction || scaffold?.nextAction || null,
  });
}

function watcherBlockers(candidateId = null, protocolMarketWatchers = null) {
  return (protocolMarketWatchers?.watchers || [])
    .filter((item) => (item.targets || []).includes(candidateId) && item.status !== "passed")
    .flatMap((item) => item.blockers || []);
}

function watcherNextAction(candidateId = null, protocolMarketWatchers = null) {
  return (
    (protocolMarketWatchers?.watchers || []).find(
      (item) => (item.targets || []).includes(candidateId) && item.status !== "passed" && item.nextAction,
    )?.nextAction || null
  );
}

function buildAllocationView(items = [], budgetUsd, constraints) {
  const maxAllocationUsd = allocationLimitUsd({ budgetUsd, constraints });
  const activePlan = [];
  const planningQueue = [];
  const chainUsage = new Map();
  const protocolUsage = new Map();
  const assetFamilyUsage = new Map();

  for (const item of items) {
    const perItemLimit = round(maxAllocationUsd);
    const allocation = {
      id: item.id,
      label: item.label,
      chain: item.chain,
      protocols: item.protocols,
      assetFamily: item.assetFamily,
      category: item.category,
      score: item.score ?? null,
      scoreDetails: item.scoreDetails ?? null,
      maxAllocationUsd: perItemLimit,
      blockers: item.blockers,
      nextAction: item.nextAction,
    };

    if (item.activeEligibility === "active_ready" && Number.isFinite(perItemLimit) && perItemLimit > 0) {
      const allocationUsd = remainingCapLimit({
        chain: item.chain,
        protocols: item.protocols,
        assetFamily: item.assetFamily,
        perItemLimit,
        budgetUsd,
        constraints,
        chainUsage,
        protocolUsage,
        assetFamilyUsage,
      });
      if (allocationUsd > 0) {
        activePlan.push({
          ...allocation,
          maxAllocationUsd: allocationUsd,
          partialCapAllocation: allocationUsd < perItemLimit,
        });
        chainUsage.set(item.chain, round((chainUsage.get(item.chain) || 0) + allocationUsd));
        for (const protocol of item.protocols) {
          protocolUsage.set(protocol, round((protocolUsage.get(protocol) || 0) + allocationUsd));
        }
        assetFamilyUsage.set(item.assetFamily, round((assetFamilyUsage.get(item.assetFamily) || 0) + allocationUsd));
        continue;
      }
      const exceeded = capBlockers({
        chain: item.chain,
        protocols: item.protocols,
        assetFamily: item.assetFamily,
        perItemLimit,
        budgetUsd,
        constraints,
        chainUsage,
        protocolUsage,
        assetFamilyUsage,
      });
      if (exceeded.length === 0) {
        activePlan.push(allocation);
        chainUsage.set(item.chain, round((chainUsage.get(item.chain) || 0) + perItemLimit));
        for (const protocol of item.protocols) {
          protocolUsage.set(protocol, round((protocolUsage.get(protocol) || 0) + perItemLimit));
        }
        assetFamilyUsage.set(item.assetFamily, round((assetFamilyUsage.get(item.assetFamily) || 0) + perItemLimit));
        continue;
      }
      const capBlockedBlockers = unique([...(item.blockers || []), ...exceeded]);
      planningQueue.push({
        ...allocation,
        blockers: capBlockedBlockers,
        planningEligibility: "cap_deferred",
        blockerCount: capBlockedBlockers.length,
      });
      continue;
    }

    planningQueue.push({
      ...allocation,
      planningEligibility: item.planningEligibility,
      blockerCount: item.blockers.length,
    });
  }

  planningQueue.sort(
    (left, right) =>
      left.blockerCount - right.blockerCount ||
      String(left.id || "").localeCompare(String(right.id || "")),
  );

  return {
    budgetUsd: round(budgetUsd),
    maxAllocationPerStrategyUsd: round(maxAllocationUsd),
    activePlan,
    planningQueue,
    exposureUsage: {
      byChain: Object.fromEntries(chainUsage.entries()),
      byProtocol: Object.fromEntries(protocolUsage.entries()),
      byAssetFamily: Object.fromEntries(assetFamilyUsage.entries()),
    },
  };
}

function topReadyCandidate(items = []) {
  return (
    items
      .filter((item) => item.activeEligibility === "active_ready")
      .sort((left, right) => {
        const leftBlockers = left.blockers?.length || 0;
        const rightBlockers = right.blockers?.length || 0;
        if (leftBlockers !== rightBlockers) return leftBlockers - rightBlockers;
        return String(left.id || "").localeCompare(String(right.id || ""));
      })[0] || null
  );
}

export function buildAllocatorCore({
  strategySnapshot = null,
  phase3Validation = null,
  wrappedBtcLendingLoopSlice = null,
  recursiveWrappedBtcLoop = null,
  recursiveStablecoinLoop = null,
  secondaryStrategyScaffolds = null,
  protocolMarketWatchers = null,
  destinationPromotionGate = null,
  destinationStrategyRegistry = null,
  destinationRepresentative = null,
  indirectStablecoinLaneInventory = null,
  now = null,
} = {}) {
  const budgets = {
    activeBudgetUsd: strategySnapshot?.currentSystem?.activeBudgetUsd ?? null,
    planningBudgetUsd: strategySnapshot?.summary?.planningBudgetUsd ?? null,
  };
  const constraints = {
    capPerStrategyPct: 0.2,
    capPerProtocolPct: 0.25,
    capPerChainPct: 0.4,
    capPerAssetFamilyPct: 0.5,
    reserveSleeveMinPct: 0.05,
  };
  const rawCandidates = [
    recursiveLoopCandidate({ scaffold: recursiveWrappedBtcLoop, phase3Validation }),
    recursiveLoopCandidate({ scaffold: recursiveStablecoinLoop, phase3Validation }),
    recursiveWrappedBtcLoop ? null : wrappedLoopCandidate({ wrappedBtcLendingLoopSlice, phase3Validation }),
    ...((secondaryStrategyScaffolds?.scaffolds || []).map((item) => scaffoldCandidate(item, phase3Validation))),
    ...destinationGateCandidates(destinationPromotionGate),
    ...representativeCoverageCandidates(destinationRepresentative),
  ]
    .filter((item) => item?.id)
    .map((item) => {
      const watcherRelatedBlockers = watcherBlockers(item.id, protocolMarketWatchers);
      return {
        ...item,
        blockers: unique([...(item.blockers || []), ...watcherRelatedBlockers]),
        nextAction: item.nextAction || watcherNextAction(item.id, protocolMarketWatchers),
      };
    });
  const candidates = buildCandidateScores(mergeCandidatesById(rawCandidates)).sort(compareCandidates);
  const activeView = buildAllocationView(candidates, budgets.activeBudgetUsd, constraints);
  const planningView = buildAllocationView(candidates, budgets.planningBudgetUsd, constraints);
  const chainCoverage = buildChainCoverageMatrix(destinationPromotionGate, destinationStrategyRegistry);
  const priorityChainExpansion = buildPriorityChainExpansion(candidates);
  const diversifiedPortfolioDraft = buildDiversifiedPortfolioDraft({ candidates, priorityChainExpansion });
  const combinedReviewOnlyChains = unique([
    ...(priorityChainExpansion.tier2ReviewOnlyChains || []),
    ...(indirectStablecoinLaneInventory?.summary?.indirectStableReviewChains || []),
  ]).filter((chain) => PRIORITY_EXPANSION_CHAINS.includes(chain));
  const topPlanningCandidate = planningView.planningQueue[0] || null;
  const topActiveAllocation = activeView.activePlan[0] || null;
  const topActiveReadyCandidate = topReadyCandidate(candidates);

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    budgets,
    constraints,
    summary: {
      candidateCount: candidates.length,
      activeAllocationCount: activeView.activePlan.length,
      activeReadyCandidateCount: candidates.filter((item) => item.activeEligibility === "active_ready").length,
      planningCandidateCount: planningView.planningQueue.length,
      activeBudgetUsd: budgets.activeBudgetUsd,
      planningBudgetUsd: budgets.planningBudgetUsd,
      topActiveAllocationId: topActiveAllocation?.id || null,
      topActiveReadyCandidateId: topActiveReadyCandidate?.id || null,
      topPlanningCandidateId: topPlanningCandidate?.id || null,
      activeNextAction: topActiveAllocation?.nextAction || topActiveReadyCandidate?.nextAction || null,
      nextAction: topActiveAllocation?.nextAction || topActiveReadyCandidate?.nextAction || topPlanningCandidate?.nextAction || null,
      tier1ActiveReadyChains: chainCoverage.tiers.tier1_active_ready,
      tier2ReviewOnlyChains: chainCoverage.tiers.tier2_review_only,
      tier3BlockedOnlyChains: chainCoverage.tiers.tier3_blocked_only,
      tier4TemplateOnlyChains: chainCoverage.tiers.tier4_template_only,
      templateMissingCellCount: chainCoverage.summary.templateMissingCellCount,
      stablecoinGatewayArrivalMissingChains: chainCoverage.summary.stablecoinGatewayArrivalMissingChains,
      stablecoinIndirectViaWrappedBtcChains: chainCoverage.summary.stablecoinIndirectViaWrappedBtcChains,
      priorityExpansionActiveReadyChains: priorityChainExpansion.tier1ActiveReadyChains,
      priorityExpansionReviewOnlyChains: priorityChainExpansion.tier2ReviewOnlyChains,
      priorityExpansionBlockedOnlyChains: priorityChainExpansion.tier3BlockedOnlyChains,
      priorityExpansionCombinedReviewOnlyChains: combinedReviewOnlyChains,
      indirectStableDirectChains: indirectStablecoinLaneInventory?.summary?.directStableChains || [],
      indirectStableReviewChains: indirectStablecoinLaneInventory?.summary?.indirectStableReviewChains || [],
      indirectStableQuoteOnlyChains: indirectStablecoinLaneInventory?.summary?.indirectQuoteOnlyChains || [],
      indirectStableRouterMissingChains: indirectStablecoinLaneInventory?.summary?.indirectRouterMissingChains || [],
      indirectStableDexVenueCount: (indirectStablecoinLaneInventory?.summary?.indirectLanesWithDexVenue || []).length,
    },
    candidates,
    activeView,
    planningView,
    chainCoverage,
    priorityChainExpansion,
    diversifiedPortfolioDraft,
    indirectStablecoinLaneInventory: indirectStablecoinLaneInventory || null,
    notes: [
      "This allocator core is deterministic and evidence-bound; it does not authorize live execution on its own.",
      "Per-strategy, per-protocol, per-chain, and per-asset-family caps are enforced against cumulative active-plan exposure; candidates that would exceed any cap are deferred with an explicit cap_exceeded blocker rather than silently admitted.",
      "Destination venue protocol IDs are inferred where needed so that same-family venues on different chains (for example Aave Base versus Venus BSC) do not collapse into one synthetic protocol bucket.",
      "Destination-promotion-gate allocation_ready venues are surfaced as allocator candidates so that multi-chain diversification can run under the same cap policy as scaffold-driven strategies.",
      "chainCoverage tiers list the Gateway target chains by evidence readiness: tier1 has at least one allocation_ready family, tier2 only has review_only families, tier3 only has blocked families, and tier4 means the (chain, family) template is missing entirely and must be filled in by destination registry work before allocation can be considered.",
      "Priority expansion chains are tracked separately so Avalanche, Sonic, Berachain, Unichain, and Soneium can stay in a review-only cohort without being overstated as live-ready.",
      "Combined priority review includes raw promotion-gate review_only plus indirect-stable review lanes; this puts Avalanche, Sonic, Berachain, Unichain, and Soneium on the same review track while preserving their exact blockers.",
      "Candidates stay review_only unless phase3 validation and downstream live/prelive gates both clear.",
      "Cross-chain reserve movement belongs in the allocator/rebalance layer; do not promote a unified multi-chain recursive loop until same-chain loop receipts, auto-unwind wiring, and native-BTC return paths are all proven.",
      "Indirect stablecoin lane (wBTC.OFT -> local DEX -> USDC/USDT) is tracked separately from direct stable Gateway arrival. Avalanche, Sonic, and Unichain now have quote-only untrusted wBTC.OFT->USDC observations; they still stay review_only until the route clears a trusted execution whitelist or live execution proof exists.",
      "Berachain and Soneium indirect stable lanes are narrower now: wBTC.OFT arrival is proven, but repo-safe stable conversion needs dedicated Kodiak/Kyo routing because the current Odos path reports no_supported_router_for_chain.",
      "Direct stable lane for base/bsc is blocked only by evidence_stale and stale gate artifact; fresh economics observations unblock them without requiring new strategy work.",
    ],
  };
}

export function summarizeAllocatorCore(report = null) {
  if (!report) return null;
  const topActiveAllocation =
    report.activeView?.activePlan?.find((item) => item.id === report.summary?.topActiveAllocationId) ||
    report.activeView?.activePlan?.[0] ||
    null;
  const topActiveReady =
    report.candidates?.find((candidate) => candidate.id === report.summary?.topActiveReadyCandidateId) ||
    null;
  const topPlanning =
    report.planningView?.planningQueue?.find((item) => item.id === report.summary?.topPlanningCandidateId) ||
    report.planningView?.planningQueue?.[0] ||
    null;
  return {
    candidateCount: report.summary?.candidateCount ?? 0,
    activeAllocationCount: report.summary?.activeAllocationCount ?? 0,
    activeReadyCandidateCount: report.summary?.activeReadyCandidateCount ?? 0,
    planningCandidateCount: report.summary?.planningCandidateCount ?? 0,
    activeBudgetUsd: report.summary?.activeBudgetUsd ?? null,
    planningBudgetUsd: report.summary?.planningBudgetUsd ?? null,
    topActiveAllocation: topActiveAllocation
      ? {
          id: topActiveAllocation.id || null,
          label: topActiveAllocation.label || null,
          score: topActiveAllocation.score ?? null,
          scoreDetails: topActiveAllocation.scoreDetails || null,
          maxAllocationUsd: topActiveAllocation.maxAllocationPerStrategyUsd ?? topActiveAllocation.maxAllocationUsd ?? null,
        }
      : null,
    topActiveReadyCandidate: topActiveReady
      ? {
          id: topActiveReady.id || null,
          label: topActiveReady.label || null,
          score: topActiveReady.score ?? null,
          scoreDetails: topActiveReady.scoreDetails || null,
          blockers: topActiveReady.blockers || [],
        }
      : null,
    topPlanningCandidate: topPlanning
      ? {
          id: topPlanning.id || null,
          label: topPlanning.label || null,
          score: topPlanning.score ?? null,
          scoreDetails: topPlanning.scoreDetails || null,
          maxAllocationUsd: topPlanning.maxAllocationPerStrategyUsd ?? topPlanning.maxAllocationUsd ?? null,
        }
      : null,
    activeNextAction: report.summary?.activeNextAction || null,
    nextAction: report.summary?.nextAction || null,
    chainCoverage: report.chainCoverage
      ? {
          tier1ActiveReadyChains: report.chainCoverage.tiers?.tier1_active_ready || [],
          tier2ReviewOnlyChains: report.chainCoverage.tiers?.tier2_review_only || [],
          tier3BlockedOnlyChains: report.chainCoverage.tiers?.tier3_blocked_only || [],
          tier4TemplateOnlyChains: report.chainCoverage.tiers?.tier4_template_only || [],
          templateMissingCellCount: report.chainCoverage.summary?.templateMissingCellCount ?? 0,
          stablecoinGatewayArrivalMissingChains: report.chainCoverage.summary?.stablecoinGatewayArrivalMissingChains || [],
          stablecoinIndirectViaWrappedBtcChains: report.chainCoverage.summary?.stablecoinIndirectViaWrappedBtcChains || [],
          allocationReadyCellCount: report.chainCoverage.summary?.allocationReadyCellCount ?? 0,
          reviewOnlyCellCount: report.chainCoverage.summary?.reviewOnlyCellCount ?? 0,
          blockedCellCount: report.chainCoverage.summary?.blockedCellCount ?? 0,
        }
      : null,
    priorityChainExpansion: report.priorityChainExpansion
      ? {
          tier1ActiveReadyChains: report.priorityChainExpansion.tier1ActiveReadyChains || [],
          tier2ReviewOnlyChains: report.priorityChainExpansion.tier2ReviewOnlyChains || [],
          tier3BlockedOnlyChains: report.priorityChainExpansion.tier3BlockedOnlyChains || [],
          combinedReviewOnlyChains: report.summary?.priorityExpansionCombinedReviewOnlyChains || [],
          perChain: report.priorityChainExpansion.perChain || [],
        }
      : null,
    diversifiedPortfolioDraft: report.diversifiedPortfolioDraft
      ? {
          summary: report.diversifiedPortfolioDraft.summary || null,
          activeDraft: report.diversifiedPortfolioDraft.activeDraft || [],
          reviewQueue: report.diversifiedPortfolioDraft.reviewQueue || [],
        }
      : null,
    indirectStableLane: report.indirectStablecoinLaneInventory
      ? {
          directStableChains: report.summary?.indirectStableDirectChains || [],
          indirectStableReviewChains: report.summary?.indirectStableReviewChains || [],
          indirectStableQuoteOnlyChains: report.summary?.indirectStableQuoteOnlyChains || [],
          indirectStableRouterMissingChains: report.summary?.indirectStableRouterMissingChains || [],
          indirectStableDexVenueCount: report.summary?.indirectStableDexVenueCount ?? 0,
          indirectLanesWithDexVenue: report.indirectStablecoinLaneInventory.summary?.indirectLanesWithDexVenue || [],
        }
      : null,
  };
}
