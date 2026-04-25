function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scalePart(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

function evidenceWeight(status) {
  return {
    live_transport_supported: 1,
    live_transport_supported_destination_unscored: 0.9,
    docs_supported_live_arrival_asset: 0.7,
    docs_surface_supported: 0.55,
    blog_surface_supported: 0.35,
  }[status] ?? 0.2;
}

function automationWeight(status) {
  return {
    transport_ready_destination_missing: 0.9,
    research_only: 0.6,
    template_only: 0.45,
    blocked_by_overfit: 0.15,
    blocked_by_evidence: 0.05,
  }[status] ?? 0.2;
}

function allowlistWeight(status) {
  return {
    pending_review: 0.6,
    blocked_by_evidence: 0.05,
    denied_until_verified: 0.1,
    not_capital_strategy: 0.2,
  }[status] ?? 0.25;
}

function phaseWeight(status) {
  return {
    research_only_until_scored: 0.7,
    blocked_until_new_evidence: 0.05,
    allowed_when_positive_ev: 0.65,
    observe_only_until_reapproved: 0.1,
    manual_review_only: 0.2,
    non_trading_track: 0.3,
  }[status] ?? 0.2;
}

function categoryBias(category) {
  return {
    transport: 0.85,
    arbitrage: 0.7,
    yield: 0.8,
    macro_rotation: 0.45,
    platform: 0.65,
    monetization: 0.35,
    experimental: 0.2,
  }[category] ?? 0.3;
}

function blockerPenalty(blockers = []) {
  return Math.min(0.6, (blockers || []).length * 0.06);
}

function strategyTrack(strategy = {}) {
  if (strategy.phasePolicy === "non_trading_track" || strategy.category === "monetization") return "monetization_track";
  if (
    strategy.phasePolicy === "blocked_until_new_evidence" ||
    strategy.automationReadiness === "blocked_by_overfit" ||
    strategy.automationReadiness === "blocked_by_evidence" ||
    strategy.allowlistStatus === "blocked_by_evidence" ||
    strategy.allowlistStatus === "denied_until_verified"
  ) {
    return "blocked_research";
  }
  if (strategy.category === "transport" && strategy.actionType === "hold") return "transport_rail";
  if (strategy.category === "macro_rotation") return "macro_rotation";
  if (strategy.category === "experimental") return "experimental_research";
  return "deployment_candidate";
}

function deploymentEligible(track) {
  return track === "deployment_candidate" || track === "macro_rotation";
}

function buildChainRouteMap(nativeBtcSurface = null) {
  const map = new Map();
  for (const route of nativeBtcSurface?.liveSurface?.liveRoutes || []) {
    const list = map.get(route.dstChain) || [];
    list.push(route);
    map.set(route.dstChain, list);
  }
  return map;
}

function arrivalFamilyFit(strategy = {}, chainRoutes = []) {
  if (strategy.arrivalFamily === "multi_asset" || strategy.arrivalFamily === "none") return 1;
  return chainRoutes.some((route) => route.dstFamily === strategy.arrivalFamily || route.dstTicker === strategy.arrivalFamily) ? 1 : 0;
}

function strategyScore(strategy, chain, chainRoutes, maxRoutes) {
  const transportDepthScore = scalePart(chain.liveRouteCount, maxRoutes);
  const routeSupportScore = arrivalFamilyFit(strategy, chainRoutes);
  const evidenceScore = evidenceWeight(strategy.evidenceStatus);
  const automationScore = automationWeight(strategy.automationReadiness);
  const allowlistScore = allowlistWeight(strategy.allowlistStatus);
  const phaseScore = phaseWeight(strategy.phasePolicy);
  const categoryScore = categoryBias(strategy.category);
  const penalty = blockerPenalty(strategy.blockers);

  const researchPriorityScore =
    transportDepthScore * 0.2 +
    routeSupportScore * 0.15 +
    evidenceScore * 0.2 +
    automationScore * 0.15 +
    allowlistScore * 0.1 +
    phaseScore * 0.1 +
    categoryScore * 0.1 -
    penalty;

  const track = strategyTrack(strategy);
  const deploymentPriorityScore = deploymentEligible(track)
    ? transportDepthScore * 0.15 +
      routeSupportScore * 0.15 +
      evidenceScore * 0.2 +
      automationScore * 0.15 +
      allowlistScore * 0.15 +
      phaseScore * 0.1 +
      categoryScore * 0.1 -
      penalty
    : 0;

  return {
    track,
    transportDepthScore: round(transportDepthScore),
    routeSupportScore: round(routeSupportScore),
    evidenceScore: round(evidenceScore),
    automationScore: round(automationScore),
    allowlistScore: round(allowlistScore),
    phaseScore: round(phaseScore),
    categoryScore: round(categoryScore),
    blockerPenalty: round(penalty),
    researchPriorityScore: round(Math.max(0, researchPriorityScore)),
    deploymentPriorityScore: round(Math.max(0, deploymentPriorityScore)),
  };
}

export function buildDestinationScoringInputs({ registry = null, nativeBtcSurface = null } = {}) {
  const generatedAt = registry?.generatedAt || nativeBtcSurface?.generatedAt || new Date().toISOString();
  const chainRouteMap = buildChainRouteMap(nativeBtcSurface);
  const maxRoutes = Math.max(1, ...(registry?.chains || []).map((chain) => chain.liveRouteCount || 0));

  const chainScorecards = (registry?.chains || []).map((chain) => {
    const chainRoutes = chainRouteMap.get(chain.chain) || [];
    const strategies = (chain.strategies || [])
      .map((strategy) => ({
        ...strategy,
        scoring: strategyScore(strategy, chain, chainRoutes, maxRoutes),
      }))
      .sort(
        (left, right) =>
        (right.scoring?.researchPriorityScore ?? 0) - (left.scoring?.researchPriorityScore ?? 0) ||
          String(left.familyId).localeCompare(String(right.familyId)),
      );

    const topTransportRail =
      strategies
        .filter((strategy) => strategy.scoring?.track === "transport_rail")
        .sort(
          (left, right) =>
            (right.scoring?.researchPriorityScore ?? 0) - (left.scoring?.researchPriorityScore ?? 0) ||
            String(left.familyId).localeCompare(String(right.familyId)),
        )[0] || null;

    const topDeploymentCandidate =
      strategies
        .filter((strategy) => deploymentEligible(strategy.scoring?.track))
        .sort(
          (left, right) =>
            (right.scoring?.deploymentPriorityScore ?? 0) - (left.scoring?.deploymentPriorityScore ?? 0) ||
            (right.scoring?.researchPriorityScore ?? 0) - (left.scoring?.researchPriorityScore ?? 0) ||
            String(left.familyId).localeCompare(String(right.familyId)),
        )[0] || null;

    return {
      chain: chain.chain,
      liveRouteCount: chain.liveRouteCount,
      arrivalAssets: chain.arrivalAssets || [],
      topTransportRail: topTransportRail
        ? {
            familyId: topTransportRail.familyId,
            label: topTransportRail.label,
            score: topTransportRail.scoring.researchPriorityScore,
          }
        : null,
      topDeploymentCandidate: topDeploymentCandidate
        ? {
            familyId: topDeploymentCandidate.familyId,
            label: topDeploymentCandidate.label,
            score: topDeploymentCandidate.scoring.deploymentPriorityScore,
          }
        : null,
      strategies,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      chainCount: chainScorecards.length,
      scoredStrategyCount: chainScorecards.reduce((sum, chain) => sum + chain.strategies.length, 0),
      deploymentCandidateCount: chainScorecards.reduce(
        (sum, chain) => sum + chain.strategies.filter((strategy) => deploymentEligible(strategy.scoring?.track)).length,
        0,
      ),
      observeOnlyResearchCount: chainScorecards.reduce(
        (sum, chain) =>
          sum + chain.strategies.filter((strategy) => strategy.scoring?.track === "observe_only_research").length,
        0,
      ),
      blockedResearchCount: chainScorecards.reduce(
        (sum, chain) => sum + chain.strategies.filter((strategy) => strategy.scoring?.track === "blocked_research").length,
        0,
      ),
      topTransportRails: chainScorecards
        .map((chain) => ({
          chain: chain.chain,
          ...chain.topTransportRail,
        }))
        .filter((item) => item.familyId)
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, 10),
      topObserveOnlyResearch: chainScorecards
        .flatMap((chain) =>
          chain.strategies
            .filter((strategy) => strategy.scoring?.track === "observe_only_research")
            .map((strategy) => ({
              chain: chain.chain,
              familyId: strategy.familyId,
              label: strategy.label,
              score: strategy.scoring.researchPriorityScore,
            })),
        )
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, 10),
      topDeploymentCandidates: chainScorecards
        .map((chain) => ({
          chain: chain.chain,
          ...chain.topDeploymentCandidate,
        }))
        .filter((item) => item.familyId)
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, 10),
    },
    chains: chainScorecards,
  };
}
