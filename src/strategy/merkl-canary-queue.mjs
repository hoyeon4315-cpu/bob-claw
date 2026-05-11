import { MERKL_OPPORTUNITY_POLICY, selectMerklOpportunityPolicy } from "../config/merkl-opportunity-policy.mjs";
import { resolvePendleMerklBinding } from "./pendle-merkl-binding-join.mjs";
import { evaluateMerklAutoEntry } from "../config/merkl-auto-entry.mjs";
import { buildProtocolCanaryBindingPlan } from "../defi/protocol-canary-bindings.mjs";
import { isSupportedBindingKind } from "../executor/protocol-binding-registry.mjs";
import { applyMerklCanaryExecutionReadiness } from "./merkl-canary-execution-readiness.mjs";
import { buildRepresentativeChainCoverage } from "./representative-chain-coverage.mjs";
import { evaluatePendleYtEv, isPendleYtQueueItem } from "./pendle-yt-ev.mjs";

const LIVE_PROVEN_DEX_CHAINS = new Set(["base", "bsc", "avalanche", "sonic"]);
const PROTOCOL_BINDING_PROTOCOLS = new Set(["morpho", "aave", "euler", "moonwell", "venus", "pendle", "yei"]);
const EXECUTABLE_NOW_STAGE = "inventory_ready_before_sizing_policy_and_signer";
const DEFAULT_CHAIN_QUOTA = Object.freeze({
  bsc: 1,
});
const FINAL_EXECUTION_REQUIRES = Object.freeze([
  "tiny_live_cap_sizing",
  "opportunity_policy_positive_ev",
  "plan_builder_available",
  "deterministic_signer_policy_approval",
]);
const MERKL_CANARY_COMMANDS = Object.freeze({
  dryRun: "npm run executor:merkl-canary-autopilot -- --json --write",
  liveExecute: "npm run executor:merkl-canary-autopilot -- --json --write --execute",
});

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

function capabilityGapCounts(queue = []) {
  const counts = {};
  for (const item of queue) {
    for (const gap of item.capabilityGaps || []) {
      counts[gap] = (counts[gap] || 0) + 1;
    }
  }
  return counts;
}

function latestAutopilotReport(reports = []) {
  return [...(reports || [])]
    .filter(Boolean)
    .sort((left, right) => {
      const leftTs = new Date(left.observedAt || left.generatedAt || 0).getTime();
      const rightTs = new Date(right.observedAt || right.generatedAt || 0).getTime();
      return rightTs - leftTs;
    })[0] || null;
}

function compactEvGate(evGate = null) {
  if (!evGate?.blocker) return null;
  return {
    blocker: evGate.blocker,
    currentAmountUsd: finite(evGate.currentAmountUsd),
    neededUsd: finite(evGate.neededUsd),
    holdDays: finite(evGate.holdDays),
    limitingFactor: evGate.limitingFactor || null,
  };
}

function autopilotStageSummary(reports = []) {
  const latest = latestAutopilotReport(reports);
  const summary = latest?.summary || {};
  const topEvBlocker = compactEvGate(summary.topEvGate);
  return {
    latestAutopilotObservedAt: latest?.observedAt || latest?.generatedAt || null,
    latestAutopilotMode: latest?.mode || null,
    policyReadyCount: Number.isFinite(summary.executionReadyCount) ? summary.executionReadyCount : 0,
    signerIntentReadyCount: Number.isFinite(summary.previewReadyCount) ? summary.previewReadyCount : 0,
    actualBroadcastCount: Number.isFinite(summary.deliveredCount) ? summary.deliveredCount : 0,
    topEvBlockers: topEvBlocker ? [topEvBlocker] : [],
  };
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

function selectCandidatesWithChainQuota(candidates = [], { limit = null, chainQuota = DEFAULT_CHAIN_QUOTA } = {}) {
  const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : candidates.length;
  const selected = candidates.slice(0, boundedLimit);
  const selectedIds = new Set(selected.map((item) => item.opportunityId));
  const quotaEvents = [];
  for (const [chain, quota] of Object.entries(chainQuota || {})) {
    const required = Math.max(0, Number(quota) || 0);
    if (required === 0) continue;
    const currentCount = selected.filter((item) => item.chain === chain).length;
    if (currentCount >= required) continue;
    const replacements = candidates.filter((item) => item.chain === chain && !selectedIds.has(item.opportunityId));
    for (const replacement of replacements.slice(0, required - currentCount)) {
      const replaceIndex = [...selected].map((item, index) => ({ item, index }))
        .reverse()
        .find(({ item }) => !Object.keys(chainQuota).includes(item.chain))?.index;
      if (replaceIndex == null) break;
      const removed = selected[replaceIndex];
      selectedIds.delete(removed.opportunityId);
      selected[replaceIndex] = replacement;
      selectedIds.add(replacement.opportunityId);
      quotaEvents.push({
        chain,
        required,
        insertedOpportunityId: replacement.opportunityId,
        removedOpportunityId: removed.opportunityId,
      });
    }
  }
  return {
    candidates: selected.sort(compareQueue),
    quotaEvents,
  };
}

function entryAssets(item = {}) {
  const symbols = item.entryTokenSymbols?.length ? item.entryTokenSymbols : item.tokenSymbols || [];
  if (item.hasStableExposure) return symbols.filter((symbol) => /^usd|dai|gho|eurc|usdt|usdc|pyusd|usde|usds/i.test(symbol));
  if (item.hasEthExposure) return symbols.filter((symbol) => /eth/i.test(symbol));
  if (item.hasBtcExposure) return symbols.filter((symbol) => /btc/i.test(symbol));
  if (item.hasGoldExposure) return symbols.filter((symbol) => /xaut|paxg|xau/i.test(symbol));
  if (item.hasReserveExposure) return symbols.filter((symbol) => /usdy|ousg|buidl|ustb/i.test(symbol));
  return symbols.slice(0, 4);
}

function capabilityGaps(item = {}, protocolBindingPlan = null) {
  const gaps = ["current_inventory_entry_route_required"];
  const pendleYt = protocolBindingPlan?.bindingKind === "pendle_yt_buy_sell_redeem";
  if (!LIVE_PROVEN_DEX_CHAINS.has(item.chain)) gaps.push("chain_live_dex_route_unproven_or_missing_stable_output");
  if (item.chain === "ethereum") gaps.push("ethereum_l1_gas_ev_positive_check_required");
  if (PROTOCOL_BINDING_PROTOCOLS.has(item.protocolId) && protocolBindingPlan?.status !== "binding_ready") {
    gaps.push("protocol_position_binding_required");
  }
  if (item.executionSurface === "fixedYield" && !pendleYt) gaps.push("maturity_or_secondary_exit_quote_required");
  if (pendleYt) {
    const ytEv = evaluatePendleYtEv({
      ...item,
      protocolBindingPlan,
    });
    gaps.push(...(ytEv?.blockers || []));
  }
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

function buildQueueItem(item = {}, index = 0, policy = MERKL_OPPORTUNITY_POLICY, { pendleMarkets = [], now = Date.now() } = {}) {
  const template = EXECUTION_TEMPLATES[item.executionSurface] || {
    canaryKind: "enter_exit_tiny_generic_position",
    nextAction: "build_generic_protocol_canary",
  };
  let bindingSource = item.protocolBinding;
  let pendleJoined = false;
  if (!bindingSource && String(item.protocolId || "").toLowerCase() === "pendle") {
    const joined = resolvePendleMerklBinding({ opportunity: item, markets: pendleMarkets, now });
    if (joined) {
      bindingSource = joined;
      pendleJoined = true;
    }
  }
  const protocolBindingPlan = buildProtocolCanaryBindingPlan({
    opportunity: item,
    binding: bindingSource,
  });
  if (pendleJoined) protocolBindingPlan.bindingSource = "pendle_markets_api";
  const pendleYtEv = evaluatePendleYtEv({
    ...item,
    protocolBindingPlan,
  });
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
    capabilityGaps: capabilityGaps(item, protocolBindingPlan),
    preflightSteps: buildPreflightSteps(item),
    protocolBindingPlan,
    pendleYt: isPendleYtQueueItem({ ...item, protocolBindingPlan }) ? {
      family: "pendle_yt",
      ev: pendleYtEv,
    } : null,
  };
}

function attachAutoEntry(queueItem = {}) {
  return {
    ...queueItem,
    autoEntry: evaluateMerklAutoEntry(queueItem, {
      bindingSupported: isSupportedBindingKind(queueItem.protocolBindingPlan?.bindingKind),
    }),
  };
}

export function buildMerklCanaryQueue({
  report = null,
  policy,
  operatingCapitalUsd,
  limit = null,
  now = null,
  inventorySnapshot = null,
  canaryExecutions = [],
  positionRecords = [],
  representativeRuns = [],
  autopilotReports = [],
  chainQuota = DEFAULT_CHAIN_QUOTA,
  pendleMarkets = [],
} = {}) {
  const resolvedPolicy = policy || selectMerklOpportunityPolicy(operatingCapitalUsd);
  const sourceItems = report?.opportunities || report?.topCandidates || [];
  const candidates = sourceItems
    .filter((item) => item?.decision === "candidate")
    .filter((item) => item?.validationMode === "tiny_live_canary_only")
    .filter((item) => item?.mappedStrategyId)
    .filter((item) => !(item?.type === "ERC20LOGPROCESSOR" && item?.action === "HOLD" && !item?.protocolId))
    .map((item) => ({ ...item, priorityScore: priorityScore(item, resolvedPolicy) }))
    .sort(compareQueue);
  const selectedCandidates = selectCandidatesWithChainQuota(candidates, { limit, chainQuota });
  const queue = selectedCandidates.candidates
    .map((item, index) => buildQueueItem(item, index, resolvedPolicy, { pendleMarkets, now: now ? new Date(now).getTime() : Date.now() }))
    .map((item) => applyMerklCanaryExecutionReadiness(item, {
      inventorySnapshot,
      canaryExecutions,
      now: now || new Date().toISOString(),
    }))
    .map(attachAutoEntry);

  const executableQueue = queue.filter((item) => item.executionReadiness?.status === "inventory_ready");
  const autoExecutableQueue = queue.filter((item) => item.autoEntry?.autoExecute === true);
  const readinessByStatus = countBy(queue, (item) => item.executionReadiness?.status);
  const gapCounts = capabilityGapCounts(queue);
  const stageSummary = autopilotStageSummary(autopilotReports);
  const generatedAt = now || new Date().toISOString();
  const byChain = countBy(queue, (item) => item.chain);
  const representedChainCount = Object.keys(byChain).length;
  const representationGap = {
    flag: selectedCandidates.quotaEvents.length > 0 || representedChainCount < 5 ? "representation_gap" : null,
    representedChainCount,
    forcedChainQuota: { ...(chainQuota || {}) },
    quotaEvents: selectedCandidates.quotaEvents,
  };
  const representativeCoverage = buildRepresentativeChainCoverage({
    queue,
    positionRecords,
    representativeRuns,
    now: generatedAt,
  });
  const topBlockingReason =
    queue.length === 0
      ? null
      : executableQueue.length > 0
        ? "executable_candidate_available"
        : queue[0]?.executionReadiness?.status || queue[0]?.capabilityGaps?.[0] || "unknown";

  return {
    schemaVersion: 1,
    generatedAt,
    sourceReportGeneratedAt: report?.generatedAt || null,
    policyProfile: report?.policyProfile || resolvedPolicy.profileId,
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
      topExecutableQueueId: executableQueue[0]?.queueId || null,
      topExecutableOpportunityId: executableQueue[0]?.opportunityId || null,
      chainCount: representedChainCount,
      byChain,
      byStrategy: countBy(queue, (item) => item.mappedStrategyId),
      byExecutionSurface: countBy(queue, (item) => item.executionSurface),
      highOverfitRiskCount: queue.filter((item) => item.overfitRisk === "high").length,
      protocolBindingReadyCount: queue.filter((item) => item.protocolBindingPlan?.status === "binding_ready").length,
      protocolBindingRequiredCount: queue.filter((item) => item.capabilityGaps.includes("protocol_position_binding_required")).length,
      unsupportedProtocolBindingCount: queue.filter((item) => item.protocolBindingPlan?.status === "unsupported_protocol_binding").length,
      pendleYtCount: queue.filter((item) => item.pendleYt).length,
      pendleYtCanaryReadyCount: queue.filter((item) => item.pendleYt?.ev?.canaryReady === true).length,
      chainRouteGapCount: queue.filter((item) => item.capabilityGaps.includes("chain_live_dex_route_unproven_or_missing_stable_output")).length,
      inventoryReadyCount: executableQueue.length,
      autoEntryReadyCount: autoExecutableQueue.length,
      queueAutoEntryReadyCount: autoExecutableQueue.length,
      policyReadyCount: stageSummary.policyReadyCount,
      planBuilderReadyCount: stageSummary.signerIntentReadyCount,
      signerIntentReadyCount: stageSummary.signerIntentReadyCount,
      actualBroadcastCount: stageSummary.actualBroadcastCount,
      executableNowCount: executableQueue.length,
      autoExecutableNowCount: autoExecutableQueue.length,
      executableNowStage: EXECUTABLE_NOW_STAGE,
      finalExecutionRequires: [...FINAL_EXECUTION_REQUIRES],
      commands: { ...MERKL_CANARY_COMMANDS },
      topEvBlockers: stageSummary.topEvBlockers,
      latestAutopilotObservedAt: stageSummary.latestAutopilotObservedAt,
      latestAutopilotMode: stageSummary.latestAutopilotMode,
      cooldownActiveCount: queue.filter((item) => item.executionReadiness?.status === "cooldown_active").length,
      nativeGasGapCount: queue.filter((item) => item.executionReadiness?.status === "native_gas_missing").length,
      executorMissingCount: queue.filter((item) => item.executionReadiness?.status === "executor_missing").length,
      readinessByStatus,
      capabilityGapCounts: gapCounts,
      topBlockingReason,
      representationGap,
      representativeCoverage: representativeCoverage.summary,
    },
    representativeCoverage,
    queue,
  };
}
