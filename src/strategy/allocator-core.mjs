function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
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
    protocols: [item.familyId],
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
      maxAllocationUsd: perItemLimit,
      blockers: item.blockers,
      nextAction: item.nextAction,
    };

    if (item.activeEligibility === "active_ready" && Number.isFinite(perItemLimit) && perItemLimit > 0) {
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
  const candidates = [
    recursiveLoopCandidate({ scaffold: recursiveWrappedBtcLoop, phase3Validation }),
    recursiveLoopCandidate({ scaffold: recursiveStablecoinLoop, phase3Validation }),
    recursiveWrappedBtcLoop ? null : wrappedLoopCandidate({ wrappedBtcLendingLoopSlice, phase3Validation }),
    ...((secondaryStrategyScaffolds?.scaffolds || []).map((item) => scaffoldCandidate(item, phase3Validation))),
    ...destinationGateCandidates(destinationPromotionGate),
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
  const activeView = buildAllocationView(candidates, budgets.activeBudgetUsd, constraints);
  const planningView = buildAllocationView(candidates, budgets.planningBudgetUsd, constraints);
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
    },
    candidates,
    activeView,
    planningView,
    notes: [
      "This allocator core is deterministic and evidence-bound; it does not authorize live execution on its own.",
      "Per-strategy, per-protocol, per-chain, and per-asset-family caps are enforced against cumulative active-plan exposure; candidates that would exceed any cap are deferred with an explicit cap_exceeded blocker rather than silently admitted.",
      "Destination-promotion-gate allocation_ready venues are surfaced as allocator candidates so that multi-chain diversification can run under the same cap policy as scaffold-driven strategies.",
      "Candidates stay review_only unless phase3 validation and downstream live/prelive gates both clear.",
      "Cross-chain reserve movement belongs in the allocator/rebalance layer; do not promote a unified multi-chain recursive loop until same-chain loop receipts, auto-unwind wiring, and native-BTC return paths are all proven.",
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
          maxAllocationUsd: topActiveAllocation.maxAllocationPerStrategyUsd ?? topActiveAllocation.maxAllocationUsd ?? null,
        }
      : null,
    topActiveReadyCandidate: topActiveReady
      ? {
          id: topActiveReady.id || null,
          label: topActiveReady.label || null,
          blockers: topActiveReady.blockers || [],
        }
      : null,
    topPlanningCandidate: topPlanning
      ? {
          id: topPlanning.id || null,
          label: topPlanning.label || null,
          maxAllocationUsd: topPlanning.maxAllocationPerStrategyUsd ?? topPlanning.maxAllocationUsd ?? null,
        }
      : null,
    activeNextAction: report.summary?.activeNextAction || null,
    nextAction: report.summary?.nextAction || null,
  };
}
