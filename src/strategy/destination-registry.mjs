function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function defaultAllowlistStatus(family = null) {
  if (family?.status === "experimental_only") return "denied_until_verified";
  if (family?.status === "measured_blocked") return "blocked_by_evidence";
  if (family?.category === "monetization") return "not_capital_strategy";
  return "pending_review";
}

function defaultAutomationReadiness(family = null) {
  if (family?.status === "supported_now") return "transport_ready_destination_missing";
  if (family?.status === "product_surface_supported") return "template_only";
  if (family?.status === "research_only_overfit_blocked") return "blocked_by_overfit";
  if (family?.status === "measured_blocked") return "blocked_by_evidence";
  return "research_only";
}

function evidenceStatus(family = null) {
  if (family?.supportType === "live_route_inventory") return "live_transport_supported";
  if (family?.supportType === "live_route_plus_destination_scoring_needed") return "live_transport_supported_destination_unscored";
  if (family?.supportType === "docs_use_case_plus_live_arrival_assets") return "docs_supported_live_arrival_asset";
  if (family?.supportType === "official_docs_surface") return "docs_surface_supported";
  if (family?.supportType === "official_blog_surface") return "blog_surface_supported";
  return "unknown";
}

function phasePolicy(chain, family = null) {
  if (chain === "ethereum") return "allowed_when_positive_ev";
  if (family?.category === "monetization") return "non_trading_track";
  if (family?.status === "measured_blocked" || family?.status === "research_only_overfit_blocked") return "blocked_until_new_evidence";
  if (family?.status === "experimental_only") return "policy_review_only";
  return "research_only_until_scored";
}

function supportsCustomAction(chain) {
  return ["base", "ethereum", "bsc", "bob", "bera", "unichain", "avalanche", "sonic", "soneium"].includes(chain);
}

function buildChainRecord(chain, families = [], liveRoutes = []) {
  const chainRoutes = liveRoutes.filter((route) => route.dstChain === chain);
  const arrivalAssetFamilies = unique(chainRoutes.map((route) => route.dstFamily));
  const arrivalAssets = unique(chainRoutes.map((route) => route.dstTicker));

  const strategies = families
    .filter((family) => family.supportedChains?.includes(chain))
    .map((family) => ({
      id: `${chain}_${slug(family.id)}`,
      familyId: family.id,
      label: family.label,
      chain,
      category: family.category,
      actionType: family.actionType,
      arrivalFamily: family.arrivalFamily,
      supportType: family.supportType,
      familyStatus: family.status,
      allowlistStatus: defaultAllowlistStatus(family),
      automationReadiness: defaultAutomationReadiness(family),
      evidenceStatus: evidenceStatus(family),
      phasePolicy: phasePolicy(chain, family),
      unwindBackToBtcRequired: family.category !== "monetization",
      supportsCustomAction: supportsCustomAction(chain),
      blockers: family.blockers || [],
      notes: family.notes || [],
    }))
    .sort((left, right) => String(left.familyId).localeCompare(String(right.familyId)));

  return {
    chain,
    liveRouteCount: chainRoutes.length,
    arrivalAssetFamilies,
    arrivalAssets,
    supportsCustomAction: supportsCustomAction(chain),
    strategies,
  };
}

export function buildDestinationStrategyRegistry({ nativeBtcSurface = null } = {}) {
  const generatedAt = nativeBtcSurface?.generatedAt || new Date().toISOString();
  const liveRoutes = nativeBtcSurface?.liveSurface?.liveRoutes || [];
  const strategyFamilies = nativeBtcSurface?.allStrategyFamilies || [];
  const chains = nativeBtcSurface?.liveSurface?.destinationChains || [];

  const chainRecords = chains.map((chain) => buildChainRecord(chain, strategyFamilies, liveRoutes));
  const globalStrategies = strategyFamilies
    .filter((family) => !family.supportedChains?.length)
    .map((family) => ({
      id: slug(family.id),
      familyId: family.id,
      label: family.label,
      category: family.category,
      actionType: family.actionType,
      arrivalFamily: family.arrivalFamily,
      supportType: family.supportType,
      familyStatus: family.status,
      allowlistStatus: defaultAllowlistStatus(family),
      automationReadiness: defaultAutomationReadiness(family),
      evidenceStatus: evidenceStatus(family),
      phasePolicy: phasePolicy(null, family),
      unwindBackToBtcRequired: family.category !== "monetization",
      blockers: family.blockers || [],
      notes: family.notes || [],
    }));

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      chainCount: chainRecords.length,
      chainStrategyCount: chainRecords.reduce((sum, chain) => sum + chain.strategies.length, 0),
      globalStrategyCount: globalStrategies.length,
      pendingReviewCount:
        chainRecords.reduce(
          (sum, chain) => sum + chain.strategies.filter((item) => item.allowlistStatus === "pending_review").length,
          0,
        ) + globalStrategies.filter((item) => item.allowlistStatus === "pending_review").length,
    },
    policyDefaults: {
      defaultAllowlistStatus: "pending_review",
      ethereumL1PhasePolicy: "allowed_when_positive_ev",
      monetizationTrackPolicy: "non_trading_track",
      executionDefault: "blocked_until_destination_scored",
    },
    chains: chainRecords,
    globalStrategies,
  };
}
