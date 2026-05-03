import { isOfficialGatewayDestinationChain } from "../config/gateway-destinations.mjs";

export const DEFAULT_ROUTE_REMEDIATION_POLICY = Object.freeze({
  minSampleCount: 2,
  minDistinctOpportunityCount: 2,
  minDistinctChainCount: 2,
  minDistinctProtocolCount: 2,
  minDistinctWindowCount: 2,
  minBlockerFamilyCount: 1,
  minEvidenceSourceCount: 2,
  maxCostVarianceBps: 250,
  minCostVarianceBufferUsd: 0.01,
  allowedExecutionPaths: Object.freeze([
    "gateway_destination",
    "base_native_evm",
    "gateway_to_evm_bridged",
  ]),
  defaultBuildCostUsd: Object.freeze({
    bind_executor: 1.5,
    build_exit_unwind_proof: 2.5,
    build_protocol_binding: 4,
    build_route_adapter: 3,
    optimize_cost_route: 2,
    plan_inventory_refill: 0.5,
  }),
});

const ROUTE_BLOCKER_PATTERNS = [
  "gateway_route_missing",
  "route_missing",
  "no_route",
  "no_stablecoin_gateway_arrival_route",
  "stablecoin_gateway_arrival_missing",
  "wrapped_btc_gateway_arrival_missing",
  "gateway_arrival_missing",
  "destination_dex_missing",
  "bridge_pair_unsupported",
  "lifi_quote_rejected",
  "dex_quote_failed",
];

const PROTOCOL_BLOCKER_PATTERNS = [
  "protocol_adapter_not_built",
  "protocol_not_bound",
  "protocol_binding_missing",
  "stable_loop_protocol_adapter_not_built",
  "destination_venue_missing",
  "venue_template_missing",
  "protocol_position_binding_required",
  "unsupported_protocol_binding",
];

const EXECUTOR_BLOCKER_PATTERNS = [
  "executor_missing",
  "executor_not_bound",
  "supported_executor_missing",
  "executor_binding_missing",
  "protocol_executor_missing",
];

const COST_BLOCKER_PATTERNS = [
  "bridge_unprofitable",
  "cost_above_edge",
  "gas_above_edge",
  "unprofitable",
  "variance_floor",
  "route_refill_economically_unjustified",
];

const INVENTORY_BLOCKER_PATTERNS = [
  "inventory_shortfall",
  "source_inventory_below_target_amount",
  "wallet_funding_required",
  "funding_required",
  "gas_float_missing",
  "current_inventory_entry_route_required",
  "native_gas_inventory_required",
];

const EXIT_BLOCKER_PATTERNS = [
  "unwind_missing",
  "missing_unwind_plan",
  "claim_unproven",
  "exit_liquidity_unproven",
  "reward_exit_unproven",
  "receipt_proof_missing",
  "unwind_route_missing",
];

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countBy(items = [], selector = (item) => item) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function parseRouteKey(routeKey = null) {
  const [src = "", dst = ""] = String(routeKey || "").split("->");
  const [srcChain, srcToken] = src.split(":");
  const [dstChain, dstToken] = dst.split(":");
  if (!srcChain || !dstChain) return null;
  return {
    srcChain,
    srcToken: srcToken || null,
    dstChain,
    dstToken: dstToken || null,
  };
}

function candidateId(candidate = {}) {
  return candidate.id || candidate.strategyId || candidate.opportunityId || candidate.label || "unknown_candidate";
}

function candidateLabel(candidate = {}) {
  return candidate.label || candidate.candidateLabel || candidate.protocol || candidateId(candidate);
}

function candidateRoute(candidate = {}) {
  if (candidate.route) return candidate.route;
  return parseRouteKey(candidate.routeKey || candidate.gatewayRouteKey || null);
}

function normalizeChain(chain = null) {
  if (!chain) return null;
  const normalized = String(chain).toLowerCase().replace(/\s+/g, "").replace(/mainnet/g, "ethereum");
  const aliases = {
    berachain: "bera",
    bnb: "bsc",
    bnbchain: "bsc",
    bnbsmartchain: "bsc",
    binance: "bsc",
    binancesmartchain: "bsc",
    bobl2: "bob",
    bobnetwork: "bob",
  };
  return aliases[normalized] || normalized;
}

function candidateChain(candidate = {}) {
  const route = candidateRoute(candidate);
  return normalizeChain(candidate.chain || candidate.dstChain || route?.dstChain || null);
}

function expectedNetProfitUsd(candidate = {}) {
  return finite(
    candidate.expectedNetProfitUsd ??
      candidate.expectedRealizedNetPnlUsd ??
      candidate.netExpectedPnlUsd ??
      candidate.evidence?.expectedNetProfitUsd ??
      candidate.evidence?.expectedRealizedNetPnlUsd,
  );
}

function evidenceValue(candidate = {}, field) {
  return finite(candidate.evidence?.[field] ?? candidate[field]);
}

function evidenceSamples(candidate = {}) {
  const samples = candidate.evidence?.evidenceSamples || candidate.evidence?.samples || candidate.evidenceSamples || candidate.samples || [];
  return Array.isArray(samples) ? samples : [];
}

function firstPresent(item = {}, fields = []) {
  for (const field of fields) {
    const value = item?.[field];
    if (value !== null && value !== undefined && value !== "") return String(value);
  }
  return null;
}

function distinctSampleCount(candidate = {}, field) {
  const samples = evidenceSamples(candidate);
  if (!samples.length) return 0;
  const fieldsByKind = {
    distinctOpportunityCount: ["opportunityId", "id", "campaignId", "routeKey", "gatewayRouteKey"],
    distinctChainCount: ["chain", "dstChain", "destinationChain"],
    distinctProtocolCount: ["protocol", "protocolId", "venue", "project"],
    distinctWindowCount: ["windowId", "campaignWindowId", "periodId", "observedWindow", "observedAt"],
    evidenceSourceCount: ["source", "sourceId", "provider", "feed"],
  };
  const fields = fieldsByKind[field] || [];
  return new Set(samples.map((sample) => firstPresent(sample, fields)).filter(Boolean)).size;
}

function distinctCountFrom(candidate = {}, field) {
  const direct = evidenceValue(candidate, field);
  if (direct !== null) return direct;
  const sampleCount = distinctSampleCount(candidate, field);
  if (sampleCount > 0) return sampleCount;
  const ids = candidate.evidence?.[field.replace("Count", "Ids")] || candidate[field.replace("Count", "Ids")] || [];
  return Array.isArray(ids) ? new Set(ids.filter(Boolean)).size : 0;
}

function measuredCostKnown(candidate = {}) {
  return (
    evidenceValue(candidate, "measuredP90RoundTripCostUsd") !== null ||
    evidenceValue(candidate, "p90RoundTripCostUsd") !== null ||
    evidenceValue(candidate, "estimatedGasClaimSwapBridgeCostUsd") !== null ||
    evidenceValue(candidate, "p90RealizedCostUsd") !== null
  );
}

function isDisplayedAprOnly(candidate = {}) {
  return (
    candidate.displayedAprOnly === true ||
    candidate.evidence?.displayedAprOnly === true ||
    (
      finite(candidate.displayedApr) !== null &&
      expectedNetProfitUsd(candidate) === null &&
      evidenceValue(candidate, "sampleCount") <= 1
    )
  );
}

function blockerMatches(blocker, patterns) {
  const normalized = String(blocker || "").toLowerCase();
  return patterns.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

function blockerFamilyFor(blocker) {
  if (blockerMatches(blocker, ROUTE_BLOCKER_PATTERNS)) return "route";
  if (blockerMatches(blocker, PROTOCOL_BLOCKER_PATTERNS)) return "protocol";
  if (blockerMatches(blocker, EXECUTOR_BLOCKER_PATTERNS)) return "executor";
  if (blockerMatches(blocker, EXIT_BLOCKER_PATTERNS)) return "exit";
  if (blockerMatches(blocker, COST_BLOCKER_PATTERNS)) return "cost";
  if (blockerMatches(blocker, INVENTORY_BLOCKER_PATTERNS)) return "inventory";
  return "other";
}

function blockerFamilies(blockers = []) {
  return unique(blockers.map(blockerFamilyFor));
}

function actionForBlockers(blockers = []) {
  if (blockers.some((blocker) => blockerMatches(blocker, ROUTE_BLOCKER_PATTERNS))) {
    return "build_route_adapter";
  }
  if (blockers.some((blocker) => blockerMatches(blocker, PROTOCOL_BLOCKER_PATTERNS))) {
    return "build_protocol_binding";
  }
  if (blockers.some((blocker) => blockerMatches(blocker, EXECUTOR_BLOCKER_PATTERNS))) {
    return "bind_executor";
  }
  if (blockers.some((blocker) => blockerMatches(blocker, EXIT_BLOCKER_PATTERNS))) {
    return "build_exit_unwind_proof";
  }
  if (blockers.some((blocker) => blockerMatches(blocker, COST_BLOCKER_PATTERNS))) {
    return "optimize_cost_route";
  }
  if (blockers.some((blocker) => blockerMatches(blocker, INVENTORY_BLOCKER_PATTERNS))) {
    return "plan_inventory_refill";
  }
  return null;
}

function resolvedBlockersForAction(action, blockers = []) {
  const patternsByAction = {
    bind_executor: EXECUTOR_BLOCKER_PATTERNS,
    build_exit_unwind_proof: EXIT_BLOCKER_PATTERNS,
    build_protocol_binding: PROTOCOL_BLOCKER_PATTERNS,
    build_route_adapter: ROUTE_BLOCKER_PATTERNS,
    optimize_cost_route: COST_BLOCKER_PATTERNS,
    plan_inventory_refill: INVENTORY_BLOCKER_PATTERNS,
  };
  const patterns = patternsByAction[action] || [];
  return blockers.filter((blocker) => blockerMatches(blocker, patterns));
}

function implementationPlanFor(action, candidate = {}) {
  const id = candidateId(candidate);
  const chain = candidateChain(candidate);
  const base = {
    strategyId: id,
    chain,
    requiredTests: [
      "unit test for deterministic policy approval/rejection",
      "dry-run or shadow receipt path before any autoExecute config change",
    ],
    promotionRule:
      "A later live canary still requires committed caps, policy approval, signer isolation, kill-switch green state, and receipt proof.",
  };
  if (action === "build_route_adapter") {
    return {
      ...base,
      writeScope: ["src/strategy/", "src/treasury/", "src/executor/policy/", "test/"],
      steps: [
        "Add the missing route adapter or route-family binding for the destination chain.",
        "Quote entry, exit, claim, swap, bridge, and unwind costs with p90 defaults.",
        "Feed intents only through proposer -> policy -> signer; no direct signer call.",
      ],
    };
  }
  if (action === "build_protocol_binding") {
    return {
      ...base,
      writeScope: ["src/strategy/", "src/config/", "src/executor/policy/", "test/"],
      steps: [
        "Add protocol adapter metadata, supported assets, unwind path, and reward-token exit proof requirements.",
        "Bind the adapter to the existing allocator/capital-manager policy hook instead of creating a parallel lane.",
        "Keep caps disabled or tiny-canary-only until receipt evidence exists.",
      ],
    };
  }
  if (action === "bind_executor") {
    return {
      ...base,
      writeScope: ["src/executor/", "src/strategy/", "test/"],
      steps: [
        "Bind the existing executor surface to the strategy intent type.",
        "Add policy fixtures proving cap, slippage, stale-quote, kill-switch, and receipt checks.",
        "Reject any path that bypasses policy or sends raw tx bytes to the signer.",
      ],
    };
  }
  if (action === "build_exit_unwind_proof") {
    return {
      ...base,
      writeScope: ["src/strategy/", "src/executor/", "test/"],
      steps: [
        "Add deterministic exit and emergency-unwind path before entry support is considered complete.",
        "Measure claim, swap, withdraw, bridge, and destination proof costs.",
        "Record pending, estimated, and realized PnL separately.",
      ],
    };
  }
  if (action === "optimize_cost_route") {
    return {
      ...base,
      writeScope: ["src/strategy/", "src/scoring/", "src/treasury/", "test/"],
      steps: [
        "Search cheaper same-chain or Gateway-backed execution paths using measured p90 cost.",
        "Reject paths whose edge is inside gas/slippage variance.",
        "Do not lower safety caps to make a route pass.",
      ],
    };
  }
  return {
    ...base,
    writeScope: ["src/treasury/", "src/executor/capital/", "test/"],
    steps: [
      "Plan inventory refill through Capital Manager targets and existing funding-source policy.",
      "Keep unknown tokens in pending whitelist until committed config approval.",
      "Do not move funds outside the deterministic policy pipeline.",
    ],
  };
}

export function evaluateRouteRemediationOverfit(candidate = {}, policy = DEFAULT_ROUTE_REMEDIATION_POLICY) {
  const effectivePolicy = { ...DEFAULT_ROUTE_REMEDIATION_POLICY, ...(policy || {}) };
  const blockers = [];
  const chain = candidateChain(candidate);
  const executionPath = candidate.executionPath || candidate.evidence?.executionPath || null;
  const netProfitUsd = expectedNetProfitUsd(candidate);
  const sampleCount = evidenceValue(candidate, "sampleCount") ?? evidenceSamples(candidate).length;
  const distinctOpportunityCount = distinctCountFrom(candidate, "distinctOpportunityCount");
  const distinctChainCount = distinctCountFrom(candidate, "distinctChainCount");
  const distinctProtocolCount = distinctCountFrom(candidate, "distinctProtocolCount");
  const distinctWindowCount = distinctCountFrom(candidate, "distinctWindowCount");
  const evidenceSourceCount = distinctCountFrom(candidate, "evidenceSourceCount");
  const costVarianceBps = evidenceValue(candidate, "costVarianceBps");
  const p90CostUsd =
    evidenceValue(candidate, "measuredP90RoundTripCostUsd") ??
    evidenceValue(candidate, "p90RoundTripCostUsd") ??
    evidenceValue(candidate, "p90RealizedCostUsd");
  const familyCount = blockerFamilies(unique(candidate.blockers || candidate.blockerReasons || [])).length;

  if (!chain) {
    blockers.push("missing_destination_chain");
  } else if (!isOfficialGatewayDestinationChain(chain)) {
    blockers.push("chain_not_gateway_official");
  }

  if (executionPath && !effectivePolicy.allowedExecutionPaths.includes(executionPath)) {
    blockers.push("execution_path_not_auto_remediable");
  }

  if (candidate.requiresRuntimeCapChange === true || candidate.runtimeMutation === true) {
    blockers.push("runtime_cap_or_policy_mutation_requested");
  }

  if (isDisplayedAprOnly(candidate)) {
    blockers.push("displayed_apr_only_not_strategy_evidence");
  }

  if (netProfitUsd === null) {
    blockers.push("expected_realized_net_pnl_unmeasured");
  } else if (netProfitUsd <= 0) {
    blockers.push("expected_realized_net_pnl_not_positive");
  }

  if (sampleCount < effectivePolicy.minSampleCount) {
    blockers.push("insufficient_sample_count");
  }

  if (distinctOpportunityCount < effectivePolicy.minDistinctOpportunityCount) {
    blockers.push("insufficient_distinct_opportunity_evidence");
  }

  if (
    distinctChainCount < effectivePolicy.minDistinctChainCount ||
    distinctProtocolCount < effectivePolicy.minDistinctProtocolCount
  ) {
    blockers.push("insufficient_chain_or_protocol_breadth");
  }

  if (distinctWindowCount < effectivePolicy.minDistinctWindowCount) {
    blockers.push("insufficient_window_breadth");
  }

  if (evidenceSourceCount < effectivePolicy.minEvidenceSourceCount) {
    blockers.push("insufficient_independent_evidence_sources");
  }

  if (familyCount < effectivePolicy.minBlockerFamilyCount) {
    blockers.push("insufficient_blocker_family_breadth");
  }

  if (!measuredCostKnown(candidate)) {
    blockers.push("measured_p90_cost_missing");
  }

  if (costVarianceBps === null) {
    blockers.push("cost_variance_unmeasured");
  }

  if (costVarianceBps !== null && costVarianceBps > effectivePolicy.maxCostVarianceBps) {
    blockers.push("cost_variance_above_policy");
  }

  if (netProfitUsd !== null && p90CostUsd !== null && costVarianceBps !== null) {
    const bufferUsd = Math.max(
      effectivePolicy.minCostVarianceBufferUsd,
      p90CostUsd * (costVarianceBps / 10_000),
    );
    if (netProfitUsd <= bufferUsd) {
      blockers.push("edge_not_above_cost_variance_buffer");
    }
  }

  return {
    passed: blockers.length === 0,
    candidate,
    id: candidateId(candidate),
    chain,
    expectedNetProfitUsd: netProfitUsd,
    blockers: unique(blockers),
    evidence: {
      sampleCount,
      distinctOpportunityCount,
      distinctChainCount,
      distinctProtocolCount,
      distinctWindowCount,
      evidenceSourceCount,
      measuredCostKnown: measuredCostKnown(candidate),
      measuredP90RoundTripCostUsd: p90CostUsd,
      costVarianceBps,
      blockerFamilyCount: familyCount,
    },
  };
}

function buildCostFor(action, candidate = {}, policy = DEFAULT_ROUTE_REMEDIATION_POLICY) {
  return finite(candidate.estimatedBuildCostUsd ?? candidate.evidence?.estimatedBuildCostUsd) ??
    policy.defaultBuildCostUsd[action] ??
    3;
}

function buildWorkOrder(candidate, guard, policy) {
  const sourceBlockers = unique(candidate.blockers || candidate.blockerReasons || []);
  const action = actionForBlockers(sourceBlockers);
  if (!action) {
    return {
      blocked: true,
      blockedCandidate: {
        id: guard.id,
        label: candidateLabel(candidate),
        chain: guard.chain,
        blockers: ["no_remediable_route_blocker"],
        sourceBlockers,
      },
    };
  }

  const buildCostUsd = buildCostFor(action, candidate, policy);
  const expectedUsd = guard.expectedNetProfitUsd;
  const estimatedNetAfterBuildUsd = round(expectedUsd - buildCostUsd, 4);
  if (estimatedNetAfterBuildUsd <= 0) {
    return {
      blocked: true,
      blockedCandidate: {
        id: guard.id,
        label: candidateLabel(candidate),
        chain: guard.chain,
        blockers: ["estimated_remediation_cost_exceeds_expected_edge"],
        sourceBlockers,
        expectedNetProfitUsd: expectedUsd,
        estimatedBuildCostUsd: buildCostUsd,
      },
    };
  }

  const resolves = resolvedBlockersForAction(action, sourceBlockers);
  return {
    blocked: false,
    workOrder: {
      schemaVersion: 1,
      candidateId: guard.id,
      candidateLabel: candidateLabel(candidate),
      chain: guard.chain,
      action,
      status: "ready_for_coding",
      reason: resolves[0] || sourceBlockers[0] || action,
      expectedNetProfitUsd: round(expectedUsd, 4),
      estimatedBuildCostUsd: round(buildCostUsd, 4),
      estimatedNetAfterBuildUsd,
      costEfficiencyScore: round(estimatedNetAfterBuildUsd / Math.max(0.01, buildCostUsd), 4),
      sourceBlockers,
      resolves,
      remainingBlockers: sourceBlockers.filter((blocker) => !resolves.includes(blocker)),
      overfitGuard: {
        passed: true,
        evidence: guard.evidence,
      },
      safety: {
        requiresCommittedDiff: true,
        runtimeMutation: false,
        signerBypass: false,
        allowedToAutocode: true,
        allowedToExecuteLive: false,
        liveExecutionAuthority: "none",
        policyPipelineRequired: true,
        llmSigningAllowed: false,
      },
      implementationPlan: implementationPlanFor(action, candidate),
    },
  };
}

function sortWorkOrders(left, right) {
  if (left.costEfficiencyScore !== right.costEfficiencyScore) {
    return right.costEfficiencyScore - left.costEfficiencyScore;
  }
  if (left.estimatedNetAfterBuildUsd !== right.estimatedNetAfterBuildUsd) {
    return right.estimatedNetAfterBuildUsd - left.estimatedNetAfterBuildUsd;
  }
  return left.candidateId.localeCompare(right.candidateId);
}

function normalizeCandidate(candidate = {}) {
  const id =
    candidate.id ||
    candidate.strategyId ||
    (
      candidate.opportunityId
        ? `campaign:${candidate.chain || "unknown"}:${candidate.protocol || "unknown"}:${candidate.opportunityId}`
        : null
    );
  return {
    ...candidate,
    id: id || candidateId(candidate),
    label: candidate.label || candidate.candidateLabel || candidate.protocol || id || candidateId(candidate),
    evidence: {
      ...(candidate.evidence || {}),
      expectedNetProfitUsd:
        candidate.evidence?.expectedNetProfitUsd ??
        candidate.expectedNetProfitUsd ??
        candidate.expectedRealizedNetPnlUsd ??
        null,
      estimatedGasClaimSwapBridgeCostUsd:
        candidate.evidence?.estimatedGasClaimSwapBridgeCostUsd ??
        candidate.estimatedGasClaimSwapBridgeCostUsd ??
        null,
    },
  };
}

export function buildRouteRemediationAutopilot({
  candidates = [],
  policy = DEFAULT_ROUTE_REMEDIATION_POLICY,
  now = new Date().toISOString(),
} = {}) {
  const effectivePolicy = {
    ...DEFAULT_ROUTE_REMEDIATION_POLICY,
    ...(policy || {}),
    defaultBuildCostUsd: {
      ...DEFAULT_ROUTE_REMEDIATION_POLICY.defaultBuildCostUsd,
      ...(policy?.defaultBuildCostUsd || {}),
    },
  };
  const normalizedCandidates = (candidates || []).map(normalizeCandidate);
  const blockedCandidates = [];
  const workOrders = [];

  for (const candidate of normalizedCandidates) {
    const guard = evaluateRouteRemediationOverfit(candidate, effectivePolicy);
    if (!guard.passed) {
      blockedCandidates.push({
        id: guard.id,
        label: candidateLabel(candidate),
        chain: guard.chain,
        blockers: guard.blockers,
        sourceBlockers: unique(candidate.blockers || candidate.blockerReasons || []),
        evidence: guard.evidence,
      });
      continue;
    }

    const result = buildWorkOrder(candidate, guard, effectivePolicy);
    if (result.blocked) {
      blockedCandidates.push(result.blockedCandidate);
    } else {
      workOrders.push(result.workOrder);
    }
  }

  const rankedWorkOrders = workOrders.sort(sortWorkOrders).map((order, index) => ({
    ...order,
    rank: index + 1,
  }));

  return {
    schemaVersion: 1,
    generatedAt: now,
    status: rankedWorkOrders.length > 0 ? "actionable" : blockedCandidates.length > 0 ? "blocked" : "clear",
    candidateCount: normalizedCandidates.length,
    workOrderCount: rankedWorkOrders.length,
    blockedCandidateCount: blockedCandidates.length,
    workOrders: rankedWorkOrders,
    blockedCandidates,
    summary: summarizeRouteRemediationAutopilot({
      workOrders: rankedWorkOrders,
      blockedCandidates,
    }),
  };
}

export function summarizeRouteRemediationAutopilot(report = {}) {
  const workOrders = report.workOrders || [];
  const blockedCandidates = report.blockedCandidates || [];
  const evidences = [
    ...workOrders.map((order) => order.overfitGuard?.evidence || null),
    ...blockedCandidates.map((candidate) => candidate.evidence || null),
  ].filter(Boolean);
  const maxEvidence = (field) => Math.max(0, ...evidences.map((evidence) => Number(evidence?.[field] || 0)));
  const costVarianceCoverageCount = evidences.filter(
    (evidence) =>
      evidence.measuredCostKnown === true &&
      evidence.costVarianceBps !== null &&
      evidence.costVarianceBps !== undefined &&
      Number.isFinite(Number(evidence.costVarianceBps)),
  ).length;
  return {
    status: workOrders.length > 0 ? "actionable" : blockedCandidates.length > 0 ? "blocked" : "clear",
    candidateCount: report.candidateCount ?? workOrders.length + blockedCandidates.length,
    workOrderCount: workOrders.length,
    blockedCandidateCount: blockedCandidates.length,
    actionCounts: countBy(workOrders, (order) => order.action),
    overfitBlockerCounts: countBy(
      blockedCandidates.flatMap((candidate) => candidate.blockers || []),
      (blocker) => blocker,
    ),
    breadth: {
      distinctChainCount: maxEvidence("distinctChainCount"),
      distinctProtocolCount: maxEvidence("distinctProtocolCount"),
      distinctOpportunityCount: maxEvidence("distinctOpportunityCount"),
      distinctWindowCount: maxEvidence("distinctWindowCount"),
      evidenceSourceCount: maxEvidence("evidenceSourceCount"),
      blockerFamilyCount: maxEvidence("blockerFamilyCount"),
      costVarianceCoverageCount,
    },
    topWorkOrder: workOrders[0]
      ? {
          rank: workOrders[0].rank ?? 1,
          candidateId: workOrders[0].candidateId,
          action: workOrders[0].action,
          chain: workOrders[0].chain,
          estimatedNetAfterBuildUsd: workOrders[0].estimatedNetAfterBuildUsd,
          costEfficiencyScore: workOrders[0].costEfficiencyScore,
        }
      : null,
  };
}
