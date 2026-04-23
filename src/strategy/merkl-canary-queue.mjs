import { MERKL_OPPORTUNITY_POLICY } from "../config/merkl-opportunity-policy.mjs";
import { buildProtocolCanaryBindingPlan } from "../defi/protocol-canary-bindings.mjs";

const LIVE_PROVEN_DEX_CHAINS = new Set(["base", "bsc", "avalanche", "sonic"]);
const PROTOCOL_BINDING_PROTOCOLS = new Set(["morpho", "aave", "euler", "moonwell", "venus", "pendle"]);

const EXECUTION_TEMPLATES = Object.freeze({
  lending: Object.freeze({
    canaryKind: "supply_withdraw_tiny_collateral",
    nextAction: "build_protocol_supply_withdraw_canary",
  }),
  stableBorrow: Object.freeze({
    canaryKind: "supply_borrow_repay_unwind_tiny",
    nextAction: "build_collateral_borrow_unwind_canary",
  }),
  ethLending: Object.freeze({
    canaryKind: "supply_withdraw_tiny_eth_family",
    nextAction: "build_eth_lending_supply_withdraw_canary",
  }),
  stableCarry: Object.freeze({
    canaryKind: "deposit_withdraw_tiny_stable_carry",
    nextAction: "build_stable_carry_deposit_withdraw_canary",
  }),
  fixedYield: Object.freeze({
    canaryKind: "enter_exit_tiny_fixed_yield",
    nextAction: "build_fixed_yield_entry_exit_canary",
  }),
  reserveAllocation: Object.freeze({
    canaryKind: "enter_exit_tiny_reserve_asset",
    nextAction: "build_reserve_asset_rotation_canary",
  }),
  assetRotation: Object.freeze({
    canaryKind: "enter_exit_tiny_asset_rotation",
    nextAction: "build_asset_rotation_canary",
  }),
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function countBy(items = [], fn) {
  return items.reduce((acc, item) => {
    const key = fn(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function overfitPenalty(item = {}) {
  if (item.overfitRisk === "high") return 18;
  if (item.overfitRisk === "medium") return 8;
  if (item.overfitRisk === "low") return 3;
  return 0;
}

function aprBoost(item = {}) {
  const apr = finite(item.nativeAprPct) ?? finite(item.aprPct) ?? 0;
  return Math.min(12, Math.max(0, apr));
}

function urgencyBoost(item = {}, policy = MERKL_OPPORTUNITY_POLICY) {
  const hours = finite(item.campaignRemainingHours);
  if (hours == null) return 0;
  if (hours < policy.entry.minHoursRemainingForNewEntry) return -50;
  if (hours <= policy.entry.rotationLookaheadHours) return 14;
  if (hours < policy.entry.minHoursRemainingForScaleUp) return 8;
  if (hours <= 14 * 24) return 4;
  return 0;
}

function chainExecutionBoost(chain) {
  if (LIVE_PROVEN_DEX_CHAINS.has(chain)) return 6;
  if (chain === "ethereum") return 2;
  return 0;
}

function priorityScore(item = {}, policy = MERKL_OPPORTUNITY_POLICY) {
  const raw =
    (Number(item.score) || 0) +
    aprBoost(item) +
    urgencyBoost(item, policy) +
    chainExecutionBoost(item.chain) -
    overfitPenalty(item);
  return Math.round(Math.max(0, raw) * 100) / 100;
}

function compareQueue(left, right) {
  if ((right.priorityScore ?? 0) !== (left.priorityScore ?? 0)) {
    return (right.priorityScore ?? 0) - (left.priorityScore ?? 0);
  }
  const leftHours = finite(left.campaignRemainingHours) ?? Number.POSITIVE_INFINITY;
  const rightHours = finite(right.campaignRemainingHours) ?? Number.POSITIVE_INFINITY;
  if (leftHours !== rightHours) return leftHours - rightHours;
  return String(left.opportunityId || "").localeCompare(String(right.opportunityId || ""));
}

function entryAssets(item = {}) {
  const symbols = item.tokenSymbols || [];
  if (item.hasStableExposure) return symbols.filter((symbol) => /^usd|dai|gho|eurc|usdt|usdc|pyusd|usde|usds/i.test(symbol));
  if (item.hasEthExposure) return symbols.filter((symbol) => /eth/i.test(symbol));
  if (item.hasBtcExposure) return symbols.filter((symbol) => /btc/i.test(symbol));
  if (item.hasGoldExposure) return symbols.filter((symbol) => /xaut|paxg|xau/i.test(symbol));
  if (item.hasReserveExposure) return symbols.filter((symbol) => /usdy|ousg|buidl|ustb/i.test(symbol));
  return symbols.slice(0, 4);
}

function capabilityGaps(item = {}) {
  const gaps = ["current_inventory_entry_route_required"];
  if (!LIVE_PROVEN_DEX_CHAINS.has(item.chain)) gaps.push("chain_live_dex_route_unproven_or_missing_stable_output");
  if (item.chain === "ethereum") gaps.push("ethereum_l1_gas_ev_positive_check_required");
  if (PROTOCOL_BINDING_PROTOCOLS.has(item.protocolId)) gaps.push("protocol_position_adapter_required");
  if (item.executionSurface === "fixedYield") gaps.push("maturity_or_secondary_exit_quote_required");
  if (item.executionSurface === "stableBorrow") gaps.push("health_factor_and_liquidation_buffer_required");
  return gaps;
}

function buildPreflightSteps(item = {}) {
  const steps = [
    "confirm_campaign_still_live",
    "resolve_entry_asset_from_current_inventory",
    "quote_entry_swap_or_gateway_route",
    "estimate_deposit_withdraw_and_unwind_gas",
    "verify_btc_payback_return_path",
    "build_policy_capped_tiny_live_canary_intent",
  ];
  if (item.executionSurface === "stableBorrow") {
    steps.splice(4, 0, "verify_health_factor_and_emergency_unwind");
  }
  if (item.executionSurface === "fixedYield") {
    steps.splice(4, 0, "verify_exit_liquidity_before_entry");
  }
  return steps;
}

function buildQueueItem(item = {}, index = 0, policy = MERKL_OPPORTUNITY_POLICY) {
  const template = EXECUTION_TEMPLATES[item.executionSurface] || {
    canaryKind: "enter_exit_tiny_generic_position",
    nextAction: "build_generic_protocol_canary",
  };
  return {
    queueId: `merkl:${item.opportunityId}`,
    rank: index + 1,
    opportunityId: item.opportunityId,
    chain: item.chain,
    protocolId: item.protocolId,
    protocolName: item.protocolName || null,
    name: item.name,
    family: item.family,
    assetFamilies: item.assetFamilies || [],
    entryAssets: entryAssets(item),
    mappedStrategyId: item.mappedStrategyId,
    executionSurface: item.executionSurface,
    canaryKind: template.canaryKind,
    nextAction: template.nextAction,
    validationMode: item.validationMode,
    queueStatus: "queued_for_tiny_live_canary_preflight",
    campaignRemainingHours: item.campaignRemainingHours ?? null,
    aprPct: item.aprPct ?? null,
    nativeAprPct: item.nativeAprPct ?? null,
    tvlUsd: item.tvlUsd ?? null,
    score: item.score ?? null,
    priorityScore: priorityScore(item, policy),
    overfitRisk: item.overfitRisk,
    overfitFlags: item.overfitFlags || [],
    riskControls: [
      "tiny_amount_only_until_receipts_exist",
      "policy_caps_required_before_signing",
      "unwind_path_required_before_entry",
      "btc_payback_path_required_before_scale",
    ],
    capabilityGaps: capabilityGaps(item),
    preflightSteps: buildPreflightSteps(item),
    protocolBindingPlan: buildProtocolCanaryBindingPlan({ opportunity: item }),
  };
}

export function buildMerklCanaryQueue({ report = null, policy = MERKL_OPPORTUNITY_POLICY, limit = null, now = null } = {}) {
  const sourceItems = report?.opportunities || report?.topCandidates || [];
  const candidates = sourceItems
    .filter((item) => item?.decision === "candidate")
    .filter((item) => item?.validationMode === "tiny_live_canary_only")
    .filter((item) => item?.mappedStrategyId)
    .map((item) => ({ ...item, priorityScore: priorityScore(item, policy) }))
    .sort(compareQueue);
  const queue = candidates
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : candidates.length)
    .map((item, index) => buildQueueItem(item, index, policy));

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    sourceReportGeneratedAt: report?.generatedAt || null,
    policyProfile: report?.policyProfile || policy.profileId,
    automationModel: {
      llmRole: "code_and_queue_only",
      signingRole: "deterministic_policy_and_signer_only",
      scaleUpRule: "tiny live canary receipts first, then committed caps before larger size",
    },
    summary: {
      queueCount: queue.length,
      topQueueId: queue[0]?.queueId || null,
      topOpportunityId: queue[0]?.opportunityId || null,
      topNextAction: queue[0]?.nextAction || null,
      chainCount: Object.keys(countBy(queue, (item) => item.chain)).length,
      byChain: countBy(queue, (item) => item.chain),
      byStrategy: countBy(queue, (item) => item.mappedStrategyId),
      byExecutionSurface: countBy(queue, (item) => item.executionSurface),
      highOverfitRiskCount: queue.filter((item) => item.overfitRisk === "high").length,
      protocolAdapterRequiredCount: queue.filter((item) => item.capabilityGaps.includes("protocol_position_adapter_required")).length,
      chainRouteGapCount: queue.filter((item) => item.capabilityGaps.includes("chain_live_dex_route_unproven_or_missing_stable_output")).length,
    },
    queue,
  };
}
