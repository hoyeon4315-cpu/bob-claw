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
  const caps = [
    (constraints.capPerStrategyPct ?? 0) * budgetUsd,
    (constraints.capPerProtocolPct ?? 0) * budgetUsd,
    (constraints.capPerChainPct ?? 0) * budgetUsd,
    (constraints.capPerAssetFamilyPct ?? 0) * budgetUsd,
  ].filter(Number.isFinite);
  return caps.length ? Math.min(...caps) : null;
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
      activePlan.push(allocation);
      chainUsage.set(item.chain, round((chainUsage.get(item.chain) || 0) + perItemLimit));
      for (const protocol of item.protocols) {
        protocolUsage.set(protocol, round((protocolUsage.get(protocol) || 0) + perItemLimit));
      }
      assetFamilyUsage.set(item.assetFamily, round((assetFamilyUsage.get(item.assetFamily) || 0) + perItemLimit));
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

export function buildAllocatorCore({
  strategySnapshot = null,
  phase3Validation = null,
  wrappedBtcLendingLoopSlice = null,
  secondaryStrategyScaffolds = null,
  protocolMarketWatchers = null,
  now = null,
} = {}) {
  const budgets = {
    activeBudgetUsd: strategySnapshot?.currentSystem?.activeBudgetUsd ?? 300,
    planningBudgetUsd: strategySnapshot?.summary?.planningBudgetUsd ?? 1000,
  };
  const constraints = {
    capPerStrategyPct: 0.2,
    capPerProtocolPct: 0.25,
    capPerChainPct: 0.4,
    capPerAssetFamilyPct: 0.5,
    reserveSleeveMinPct: 0.05,
  };
  const candidates = [
    wrappedLoopCandidate({ wrappedBtcLendingLoopSlice, phase3Validation }),
    ...((secondaryStrategyScaffolds?.scaffolds || []).map((item) => scaffoldCandidate(item, phase3Validation))),
  ]
    .filter((item) => item.id)
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

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    budgets,
    constraints,
    summary: {
      candidateCount: candidates.length,
      activeAllocationCount: activeView.activePlan.length,
      planningCandidateCount: planningView.planningQueue.length,
      activeBudgetUsd: budgets.activeBudgetUsd,
      planningBudgetUsd: budgets.planningBudgetUsd,
      topPlanningCandidateId: topPlanningCandidate?.id || null,
      nextAction: topPlanningCandidate?.nextAction || null,
    },
    candidates,
    activeView,
    planningView,
    notes: [
      "This allocator core is deterministic and evidence-bound; it does not authorize live execution on its own.",
      "Per-strategy, per-protocol, per-chain, and per-asset-family caps come from the Phase 4 reference defaults until operator overrides are wired.",
      "Candidates stay review_only unless phase3 validation and downstream live/prelive gates both clear.",
    ],
  };
}

export function summarizeAllocatorCore(report = null) {
  if (!report) return null;
  const topPlanning =
    report.planningView?.planningQueue?.find((item) => item.id === report.summary?.topPlanningCandidateId) ||
    report.planningView?.planningQueue?.[0] ||
    null;
  return {
    candidateCount: report.summary?.candidateCount ?? 0,
    activeAllocationCount: report.summary?.activeAllocationCount ?? 0,
    planningCandidateCount: report.summary?.planningCandidateCount ?? 0,
    activeBudgetUsd: report.summary?.activeBudgetUsd ?? null,
    planningBudgetUsd: report.summary?.planningBudgetUsd ?? null,
    topPlanningCandidate: topPlanning
      ? {
          id: topPlanning.id || null,
          label: topPlanning.label || null,
          maxAllocationUsd: topPlanning.maxAllocationPerStrategyUsd ?? topPlanning.maxAllocationUsd ?? null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
