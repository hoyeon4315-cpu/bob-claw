function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function laneById(laneReclassification = null) {
  return new Map((laneReclassification?.lanes || []).map((lane) => [lane.id, lane]));
}

function buildStableLoopResearchEntry(lane = null) {
  if (!lane || lane.clearsNewFloor !== true) return null;
  return {
    rank: 1,
    id: "stablecoin_entry_exit_loop_revalidation",
    label: "Stablecoin entry/exit loop revalidation",
    category: "arbitrage",
    status: lane.statusNew === "candidate_for_validation" ? "candidate_for_validation" : "overfit_blocked_revalidation",
    whyNow:
      "The relaxed positive-EV floor lets small measured stablecoin loops matter again, and this lane now clears the new measured floor outside the old flat USD 0.30 policy gate.",
    requiredInfrastructure: [
      "stable-loop amount ladder refresh",
      "fresh gas and quote coverage across matching amounts",
      "variance-aware overfit rerun",
    ],
    failureModes: unique(["stable-loop amount mismatch", ...(lane.remainingBlockers || [])]),
    missingEvidence: unique([
      lane.passesOverfitGate === false ? "overfit-safe amount diversity" : null,
      lane.statusReasonCode === "measured_net_missing" ? "measured USD net mapping" : null,
      "repeatable out-of-sample durable samples",
    ]),
    promotionPrerequisites: [
      "passes_overfit_gate",
      "repeated_positive_net_outside_noise_floor",
      "receipt-backed exit-cost confirmation",
    ],
    evidence: {
      laneId: lane.id,
      statusNew: lane.statusNew,
      netPnlMeasuredUsd: lane.netPnlMeasuredUsd ?? null,
      gasSlippageVarianceUsd: lane.gasSlippageVarianceUsd ?? null,
      passesOverfitGate: lane.passesOverfitGate ?? null,
    },
    nextAction: {
      code: "refresh_stable_loop_validation",
      command: "npm run audit:overfit -- --write && npm run report:lane-reclassification -- --write",
    },
  };
}

function buildProxySpreadResearchEntry(lane = null) {
  if (!lane) return null;
  return {
    rank: 6,
    id: "gateway_proxy_spread_rebalance_recheck",
    label: "Gateway BTC proxy spread rebalance recheck",
    category: "arbitrage",
    status: lane.clearsNewFloor === true ? "overfit_blocked_revalidation" : "deferred",
    whyNow:
      "The project-wide floor is gone, so proxy-spread edges should now be judged purely against measured variance and coverage quality rather than a flat profit threshold.",
    requiredInfrastructure: [
      "broader wrapper amount coverage",
      "fresh quote/receipt samples on the same rebalance legs",
    ],
    failureModes: unique(lane.remainingBlockers || []),
    missingEvidence: unique([
      lane.passesOverfitGate === false ? "overfit-safe coverage expansion" : null,
      lane.clearsNewFloor === true ? null : "positive measured net outside noise floor",
    ]),
    promotionPrerequisites: [
      "positive_measured_net_outside_noise_floor",
      "passes_overfit_gate",
    ],
    evidence: {
      laneId: lane.id,
      statusNew: lane.statusNew,
      netPnlMeasuredUsd: lane.netPnlMeasuredUsd ?? null,
      gasSlippageVarianceUsd: lane.gasSlippageVarianceUsd ?? null,
    },
    nextAction: {
      code: "expand_proxy_spread_samples",
      command: "npm run report:btc-proxy-spreads",
    },
  };
}

function buildLendingLoopEntry(entry = null) {
  if (!entry) return null;
  return {
    rank: entry.id === "recursive_wrapped_btc_lending_loop" ? 2 : 4,
    id: entry.id,
    label: entry.label || null,
    category: entry.category || null,
    status: entry.status || "candidate_for_design",
    whyNow:
      entry.arrivalFamily === "wrapped_btc"
        ? "Per-strategy sizing and the relaxed leverage policy make a wrapped-BTC loop a first-class candidate once runtime caps, watcher thresholds, and unwind automation exist."
        : "Stablecoin looping is now policy-permitted, but it still needs deterministic peg, unwind, and liquidation controls before any promotion.",
    requiredInfrastructure: unique([
      ...(entry.requiredPolicyFields || []),
      ...(entry.notBuilt || []),
    ]),
    failureModes: unique([
      "health-factor drift",
      "liquidation buffer breach",
      "unwind cost exceeds carry",
    ]),
    missingEvidence: unique([
      "protocol adapter benchmark",
      "dry-run unwind receipt",
      "measured post-fee loop economics",
    ]),
    promotionPrerequisites: [
      "runtime_per_trade_cap_enforced",
      "health_factor_watcher_live",
      "dry_run_emergency_unwind_passed",
    ],
    evidence: {
      source: "lending_loop_research",
      actionType: entry.actionType || null,
      arrivalFamily: entry.arrivalFamily || null,
    },
    nextAction: {
      code: "build_lending_loop_vertical_slice",
      command: null,
    },
  };
}

function buildSurfaceResearchEntry(family = null) {
  if (!family || !String(family.status || "").includes("research")) return null;
  const base = {
    destination_wrapped_btc_rotation: {
      rank: 3,
      status: "research_priority",
      whyNow:
        "Gateway already lands native BTC into wrapped-BTC destinations across multiple chains, and the relaxed per-strategy cap model now supports smaller sleeves without a repo-wide wallet ring-fence.",
      promotionPrerequisites: [
        "destination_venue_registry_built",
        "deterministic_unwind_scoring",
        "per_strategy_cap_and_exit_path_declared",
      ],
      nextAction: {
        code: "measure_wrapped_btc_destination_yield",
        command: "npm run report:native-btc-surface -- --write",
      },
    },
    stablecoin_treasury_rotation: {
      rank: 5,
      status: "research_priority",
      whyNow:
        "Relaxed minimum profit handling makes small, treasury-like BTC-to-stable sleeves worth measuring when they improve allocator robustness or create low-friction exit inventory.",
      promotionPrerequisites: [
        "stable_destination_registry_ranked",
        "exit_cost_capacity_confirmed",
        "positive_ev_outside_variance_after_round_trip",
      ],
      nextAction: {
        code: "rank_stablecoin_destinations",
        command: "npm run report:destination-research-queue -- --write",
      },
    },
    macro_asset_rotation: {
      rank: 7,
      status: "research_backlog",
      whyNow:
        "ETH/store-of-value destination routes are now allowed when measured positive EV survives gas and slippage, but they remain secondary because they add market-risk drift.",
      promotionPrerequisites: [
        "market_risk_policy_confirmed",
        "destination_strategy_edge_measured",
      ],
      nextAction: {
        code: "measure_non_btc_destination_edges",
        command: "npm run analyze:ethereum-routes",
      },
    },
  }[family.id];
  if (!base) return null;
  return {
    rank: base.rank,
    id: family.id,
    label: family.label || null,
    category: "allocation",
    status: base.status,
    whyNow: base.whyNow,
    requiredInfrastructure: unique([
      ...(family.blockers || []),
      "destination economics registry",
    ]),
    failureModes: unique(family.blockers || []),
    missingEvidence: unique([
      `${family.id}_measured_destination_surface`,
      family.liveRouteCount > 0 ? null : "live arrival route inventory",
    ]),
    promotionPrerequisites: base.promotionPrerequisites,
    evidence: {
      source: "native_btc_opportunity_surface",
      liveRouteCount: family.liveRouteCount ?? 0,
      destinationChains: family.destinationChains || [],
    },
    nextAction: base.nextAction,
  };
}

function priority(entry = null) {
  const rank = Number.isFinite(entry?.rank) ? entry.rank : 999;
  const statusBias = {
    candidate_for_validation: 0,
    research_priority: 1,
    overfit_blocked_revalidation: 2,
    candidate_for_design: 3,
    research_backlog: 4,
    deferred: 5,
  }[entry?.status] ?? 6;
  return [rank, statusBias, String(entry?.id || "")];
}

export function buildStrategyResearchBoard({
  laneReclassification = null,
  nativeBtcOpportunitySurface = null,
  lendingLoopResearchEntries = [],
  now = null,
} = {}) {
  const lanes = laneById(laneReclassification);
  const surfaceFamilies =
    nativeBtcOpportunitySurface?.rankedOpportunityFamilies ||
    nativeBtcOpportunitySurface?.families ||
    [];
  const candidates = [
    buildStableLoopResearchEntry(lanes.get("stablecoin_entry_exit_loops") || null),
    buildProxySpreadResearchEntry(lanes.get("btc_proxy_spreads") || null),
    ...lendingLoopResearchEntries.map((entry) => buildLendingLoopEntry(entry)),
    ...(surfaceFamilies.map((family) => buildSurfaceResearchEntry(family))),
  ]
    .filter(Boolean)
    .sort((left, right) => {
      const [leftRank, leftStatus, leftId] = priority(left);
      const [rightRank, rightStatus, rightId] = priority(right);
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (leftStatus !== rightStatus) return leftStatus - rightStatus;
      return leftId.localeCompare(rightId);
    });

  const topCandidate = candidates[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      candidateCount: candidates.length,
      statusCounts: countBy(candidates, (item) => item.status || "unknown"),
      topCandidateId: topCandidate?.id || null,
      nextAction: topCandidate?.nextAction || null,
    },
    candidates,
  };
}

export function summarizeStrategyResearchBoard(board = null) {
  if (!board) return null;
  const topCandidate =
    board.candidates?.find((candidate) => candidate.id === board.summary?.topCandidateId) ||
    board.candidates?.[0] ||
    null;
  return {
    candidateCount: board.summary?.candidateCount ?? 0,
    statusCounts: board.summary?.statusCounts || {},
    topCandidate: topCandidate
      ? {
          id: topCandidate.id || null,
          label: topCandidate.label || null,
          status: topCandidate.status || null,
        }
      : null,
    nextAction: board.summary?.nextAction || null,
  };
}
