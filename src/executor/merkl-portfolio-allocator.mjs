import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { merklPortfolioPolicy } from "../config/merkl-portfolio.mjs";
import { DIVERSIFICATION_POLICY, canAcceptNewAllocation, computeHhi, perChainMaxShareFor } from "../config/diversification.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd, latestPriceSnapshot, pricesFromSnapshot } from "../market/prices.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { buildScoredTargetBalances } from "./capital/scored-target-balances.mjs";
import { buildChainScoreLedger } from "../strategy/chain-score-ledger.mjs";
import {
  applyMerklCanaryExecutionReadiness,
  latestTreasuryInventoryForAddress,
} from "../strategy/merkl-canary-execution-readiness.mjs";
import {
  isSupportedBindingKind,
  resolvePlanBuilder,
  resolvePlanExecutor,
} from "./protocol-binding-registry.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { sizeMerklCanaryAmount } from "./merkl-canary-autopilot.mjs";
import { latestWholeWalletInventoryForAddress } from "../treasury/whole-wallet-scan.mjs";
import { tinyCanarySameChainRoundTripCostUsd, resolveTinyCanaryExpectedHoldDays } from "../config/sizing.mjs";
import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../config/small-capital-campaign-mode.mjs";
import { buildProofGraduationCanaryRequest } from "./canary/proof-graduation-bridge.mjs";


function finite(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finitePositive(value) {
  const parsed = finite(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function bindingKind(queueItem = {}) {
  return queueItem.protocolBindingPlan?.bindingKind || null;
}

function opportunityKey(record = {}) {
  return String(record.opportunityId || record.queueItem?.opportunityId || record.plan?.opportunityId || "");
}

function latestDeliveredCanary(records = [], opportunityId = null) {
  return [...records]
    .filter((record) => {
      return opportunityKey(record) === String(opportunityId || "") &&
        record.mode === "execute" &&
        record.execution?.settlementStatus === "delivered";
    })
    .sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0))[0] || null;
}

function activePositionKey(record = {}) {
  return String(record.positionId || "");
}

export function activeMerklPortfolioPositions(records = []) {
  const byId = new Map();
  for (const record of records) {
    const id = activePositionKey(record);
    if (!id) continue;
    if (record.event === "position_exit_confirmed" || record.status === "closed") {
      byId.set(id, { ...(byId.get(id) || {}), ...record, status: "closed" });
      continue;
    }
    if (record.event === "position_opened" || record.status === "open") {
      byId.set(id, { ...record, status: "open" });
    }
  }
  return [...byId.values()].filter((record) => record.status === "open");
}

function activeUsd(positions = []) {
  return positions.reduce((sum, item) => sum + (finite(item.amountUsd) ?? 0), 0);
}

function activeBy(positions = [], keyFn = () => "") {
  const values = new Map();
  for (const position of positions) {
    const key = keyFn(position);
    if (!key) continue;
    values.set(key, (values.get(key) || 0) + (finite(position.amountUsd) ?? 0));
  }
  return values;
}

function activeDiversificationAllocations(positions = [], denominatorUsd = null) {
  const totalUsd = finite(denominatorUsd) ?? activeUsd(positions);
  const allocations = {
    perStrategy: {},
    perChain: {},
    perProtocol: {},
    bobL2DirectShare: 0,
  };
  if (!(totalUsd > 0)) return allocations;
  for (const position of positions || []) {
    const usd = positionUsd(position);
    if (!(usd > 0)) continue;
    const share = usd / totalUsd;
    const strategyId = position.opportunityId || position.strategyId || position.positionId;
    if (strategyId) allocations.perStrategy[strategyId] = (allocations.perStrategy[strategyId] || 0) + share;
    if (position.chain) allocations.perChain[position.chain] = (allocations.perChain[position.chain] || 0) + share;
    if (position.protocolId) allocations.perProtocol[position.protocolId] = (allocations.perProtocol[position.protocolId] || 0) + share;
  }
  return allocations;
}

function positionUsd(position = {}) {
  return finite(position.amountUsd) ?? finite(position.targetUsd) ?? finite(position.plan?.amountUsd) ?? 0;
}

function diversificationGateForAllocation({ activePositions = [], queueItem = {}, addUsd = 0 } = {}) {
  const activePositionUsd = activeUsd(activePositions);
  const candidateUsd = finite(addUsd) ?? 0;
  const denominatorUsd = activePositionUsd + candidateUsd;
  if (!(candidateUsd > 0) || !(denominatorUsd > 0)) {
    return {
      accepted: true,
      verdict: { ok: true, violations: [] },
      activeUsd: activePositionUsd,
      candidateUsd,
      addShare: 0,
    };
  }
  if (denominatorUsd < 10) {
    return {
      accepted: true,
      verdict: { ok: true, violations: [] },
      activeUsd: activePositionUsd,
      candidateUsd,
      addShare: candidateUsd / denominatorUsd,
      bypassed: true,
    };
  }
  const result = canAcceptNewAllocation(
    activeDiversificationAllocations(activePositions, denominatorUsd),
    {
      strategyId: queueItem.opportunityId || queueItem.mappedStrategyId,
      chainId: queueItem.chain,
      protocolIds: [queueItem.protocolId].filter(Boolean),
      directHolding: false,
      addShare: candidateUsd / denominatorUsd,
    },
  );
  const candidateStrategyId = queueItem.opportunityId || queueItem.mappedStrategyId;
  const candidateChainId = queueItem.chain;
  const candidateProtocolIds = new Set([queueItem.protocolId].filter(Boolean));
  const candidateSpecificViolations = (result.verdict?.violations || []).filter((violation) => {
    if (violation.kind === "per_strategy_share_exceeded") return violation.id === candidateStrategyId;
    if (violation.kind === "per_chain_share_exceeded") return violation.id === candidateChainId;
    if (violation.kind === "per_protocol_share_exceeded") return candidateProtocolIds.has(violation.id);
    if (violation.kind === "chain_not_gateway_official") return violation.id === candidateChainId;
    return false;
  });
  const beforeHhi = computeHhi(activeDiversificationAllocations(activePositions, activePositionUsd).perStrategy);
  const hhiWorsened =
    (result.verdict?.hhi ?? 0) > DIVERSIFICATION_POLICY.hhiMax &&
    (result.verdict?.hhi ?? 0) > beforeHhi;
  const accepted = result.accepted || (candidateSpecificViolations.length === 0 && !hhiWorsened);
  return {
    ...result,
    accepted,
    activeUsd: activePositionUsd,
    candidateUsd,
    addShare: candidateUsd / denominatorUsd,
    bypassed: false,
  };
}

function maxAddForShareCap({ currentGroupUsd = 0, activeUsd = 0, maxShare = null } = {}) {
  const groupUsd = finite(currentGroupUsd) ?? 0;
  const totalUsd = finite(activeUsd) ?? 0;
  const share = finite(maxShare);
  if (!(share > 0) || share >= 1) return Number.POSITIVE_INFINITY;
  return Math.max(0, ((share * totalUsd) - groupUsd) / (1 - share));
}

function activeByStrategy(positions = []) {
  return activeBy(positions, (position) => position.opportunityId || position.strategyId || position.positionId);
}

function addChainUsd(target, chain, usd) {
  const value = finite(usd);
  if (!chain || chain === "bitcoin" || value == null || value <= 0) return;
  target[chain] = (target[chain] || 0) + value;
}

function inventoryExposureByChainUsd(inventory = {}) {
  const result = {};
  for (const item of inventory?.native || []) addChainUsd(result, item.chain, item.estimatedUsd);
  for (const item of inventory?.tokenBalances || []) addChainUsd(result, item.chain, item.estimatedUsd);
  for (const item of inventory?.tokens || []) addChainUsd(result, item.chain, item.estimatedUsd);
  return result;
}

function externalExposurePositions(externalChainUsd = {}) {
  return Object.entries(externalChainUsd || {})
    .map(([chain, amountUsd]) => ({
      event: "external_wallet_exposure",
      status: "open",
      positionId: `external:${chain}`,
      opportunityId: null,
      chain,
      protocolId: null,
      amountUsd: finite(amountUsd) ?? 0,
      external: true,
    }))
    .filter((position) => position.amountUsd > 0);
}

function sumUsd(values = {}) {
  return Object.values(values || {})
    .map((value) => finite(value))
    .filter((value) => value != null)
    .reduce((sum, value) => sum + value, 0);
}

function chainTargetMaxAddUsd({ chain, exposureChainUsd = new Map(), targetChainUsd = null, toleranceUsd = 5 } = {}) {
  if (!chain || !targetChainUsd || typeof targetChainUsd !== "object" || !(chain in targetChainUsd)) {
    return Number.POSITIVE_INFINITY;
  }
  const targetUsd = finite(targetChainUsd[chain]);
  if (targetUsd == null) return Number.POSITIVE_INFINITY;
  const currentUsd = exposureChainUsd instanceof Map
    ? exposureChainUsd.get(chain) || 0
    : finite(exposureChainUsd[chain]) ?? 0;
  return Math.max(0, targetUsd + (finite(toleranceUsd) ?? 5) - currentUsd);
}

function diversificationMaxAddUsd({ activePositions = [], queueItem = {} } = {}) {
  const activePositionUsd = activeUsd(activePositions);
  if (activePositionUsd < 10) return Number.POSITIVE_INFINITY;
  const strategyId = queueItem.opportunityId || queueItem.mappedStrategyId || null;
  const strategyUsd = strategyId ? activeByStrategy(activePositions).get(strategyId) || 0 : 0;
  const chainUsd = queueItem.chain ? activeBy(activePositions, (position) => position.chain).get(queueItem.chain) || 0 : 0;
  const protocolUsd = queueItem.protocolId ? activeBy(activePositions, (position) => position.protocolId).get(queueItem.protocolId) || 0 : 0;
  return Math.min(
    maxAddForShareCap({
      currentGroupUsd: strategyUsd,
      activeUsd: activePositionUsd,
      maxShare: DIVERSIFICATION_POLICY.perStrategyMaxShare,
    }),
    maxAddForShareCap({
      currentGroupUsd: chainUsd,
      activeUsd: activePositionUsd,
      maxShare: perChainMaxShareFor(queueItem.chain, DIVERSIFICATION_POLICY),
    }),
    maxAddForShareCap({
      currentGroupUsd: protocolUsd,
      activeUsd: activePositionUsd,
      maxShare: DIVERSIFICATION_POLICY.perProtocolMaxShare,
    }),
  );
}

function scoreTvl(tvlUsd) {
  const tvl = finite(tvlUsd);
  if (tvl == null || tvl <= 0) return 0;
  return Math.min(1, Math.log10(tvl) / 8);
}

function scoreDuration(hours) {
  const value = finite(hours);
  if (value == null) return 0.4;
  if (value < 36) return -1;
  if (value < 72) return 0.45;
  if (value < 168) return 0.75;
  return 1;
}

function overfitPenalty(item = {}) {
  if (item.overfitRisk === "high") return 1;
  if (item.overfitRisk === "medium") return 0.55;
  if (item.overfitRisk === "low") return 0.2;
  return 0.35;
}

export function merklPortfolioScore(queueItem = {}, {
  policy = merklPortfolioPolicy(),
  canaryProof = null,
  campaignAprMap = null,
} = {}) {
  const weights = policy.scoreWeights;
  let apr = finite(queueItem.nativeAprPct) ?? finite(queueItem.aprPct) ?? 0;
  if (campaignAprMap && campaignAprMap.has(queueItem.opportunityId)) {
    apr = campaignAprMap.get(queueItem.opportunityId);
  }
  const readiness = queueItem.executionReadiness || {};
  const raw =
    (finite(queueItem.priorityScore) ?? finite(queueItem.score) ?? 0) * weights.queuePriority +
    Math.min(30, Math.max(0, apr)) * weights.apr +
    scoreTvl(queueItem.tvlUsd) * weights.tvl +
    scoreDuration(queueItem.campaignRemainingHours) * weights.duration +
    (canaryProof ? weights.canaryProof : 0) +
    (readiness.status === "inventory_ready" ? weights.inventoryReady : 0) +
    (readiness.matchedNative ? weights.gasReady : 0) -
    overfitPenalty(queueItem) * weights.overfitPenalty -
    (queueItem.capabilityGaps || []).filter((gap) => gap === "chain_live_dex_route_unproven_or_missing_stable_output").length *
      weights.chainRouteGapPenalty;
  return Math.round(Math.max(0, raw) * 100) / 100;
}

function sameOpportunityActive(positions = [], queueItem = {}) {
  return positions.some((position) => String(position.opportunityId) === String(queueItem.opportunityId));
}

function activeOpportunityUsd(positions = [], queueItem = {}) {
  return positions
    .filter((position) => String(position.opportunityId) === String(queueItem.opportunityId))
    .reduce((sum, position) => sum + (finite(position.amountUsd) ?? 0), 0);
}

function tokenKey(queueItem = {}) {
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  return `${queueItem.chain}:${String(binding.assetAddress || queueItem.executionReadiness?.matchedToken?.token || "").toLowerCase()}`;
}

function buildCapitalJob(queueItem = {}) {
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  return {
    opportunityId: queueItem.opportunityId,
    chain: queueItem.chain,
    protocolId: queueItem.protocolId,
    requiredAsset: binding.assetSymbol || queueItem.entryAssets?.[0] || null,
    requiredAssetAddress: binding.assetAddress || null,
    reason: queueItem.executionReadiness?.status || queueItem.capabilityGaps?.[0] || "not_entry_ready",
    suggestedAction: "route_or_swap_inventory_to_required_entry_asset_then_rebuild_queue",
  };
}

function usdToSatsFloor(usd, btcPriceUsd) {
  if (!(Number.isFinite(usd) && usd >= 0 && Number.isFinite(btcPriceUsd) && btcPriceUsd > 0)) return null;
  return Math.floor((usd / btcPriceUsd) * 100_000_000);
}

function usdToSatsCeil(usd, btcPriceUsd) {
  if (!(Number.isFinite(usd) && usd >= 0 && Number.isFinite(btcPriceUsd) && btcPriceUsd > 0)) return null;
  return Math.ceil((usd / btcPriceUsd) * 100_000_000);
}

function resolveHoldWindow(queueItem = {}, now = new Date().toISOString()) {
  if (finitePositive(queueItem.expectedHoldDays) != null) {
    return {
      holdDays: finitePositive(queueItem.expectedHoldDays),
      holdWindowSource: "expectedHoldDays",
    };
  }
  if (finitePositive(queueItem.campaignRemainingHours) != null) {
    return {
      holdDays: finitePositive(queueItem.campaignRemainingHours) / 24,
      holdWindowSource: "campaignRemainingHours",
    };
  }
  if (queueItem.campaignEndsAt) {
    const remainingMs = new Date(queueItem.campaignEndsAt).getTime() - new Date(now).getTime();
    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      return {
        holdDays: remainingMs / 86_400_000,
        holdWindowSource: "campaignEndsAt",
      };
    }
  }
  return {
    holdDays: resolveTinyCanaryExpectedHoldDays({ now }),
    holdWindowSource: "fallback_7d_unknown_duration",
  };
}

function rewardHaircutPct(queueItem = {}, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  const tokenType = queueItem.rewardTokenType;
  if (tokenType == null && !queueItem.rewardToken && !queueItem.rewardTokenSymbol) return 0;
  const haircut = policy.rewardHaircuts?.[tokenType] ?? policy.rewardHaircuts?.defaultRewardToken ?? 0.5;
  return Math.max(0, Math.min(1, Number(haircut) || 0));
}

function candidateCostComponentsUsd(queueItem = {}) {
  const gas = finite(queueItem.estimatedGasCostUsd) ??
    tinyCanarySameChainRoundTripCostUsd({ chain: queueItem.chain });
  return {
    p90GasUsd: gas,
    p90BridgeUsd: finite(queueItem.estimatedBridgeCostUsd) ?? 0,
    p90ClaimUsd: finite(queueItem.estimatedClaimCostUsd) ?? 0,
    p90RewardSwapUsd: finite(queueItem.estimatedRewardSwapCostUsd) ?? 0,
    slippageUsd: finite(queueItem.estimatedSlippageUsd) ?? 0,
    unwindUsd: finite(queueItem.estimatedExitCostUsd) ?? finite(queueItem.estimatedUnwindCostUsd) ?? 0,
    extraEstimatedCostsUsd: finite(queueItem.estimatedCostsUsd) ?? 0,
  };
}

function buildCandidateDecision({
  queueItem = {},
  amountUsd = null,
  aprPct = null,
  btcPriceUsd = null,
  btcPriceSnapshotAt = null,
  now = new Date().toISOString(),
} = {}) {
  const positionUsd = finite(amountUsd);
  const price = finitePositive(btcPriceUsd);
  if (positionUsd == null || positionUsd <= 0 || price == null) return null;

  const { holdDays, holdWindowSource } = resolveHoldWindow(queueItem, now);
  const displayedAprPct = finite(aprPct) ?? finite(queueItem.nativeAprPct) ?? finite(queueItem.aprPct) ?? 0;
  const grossRewardUsd = positionUsd * (displayedAprPct / 100) * (holdDays / 365);
  const haircutPct = rewardHaircutPct(queueItem);
  const haircutRewardUsd = grossRewardUsd * (1 - haircutPct);
  const costs = candidateCostComponentsUsd(queueItem);
  const estimatedCostUsd = Object.values(costs).reduce((sum, value) => sum + (finite(value) ?? 0), 0);
  const grossRewardSats = usdToSatsFloor(grossRewardUsd, price);
  const haircutRewardSats = usdToSatsFloor(haircutRewardUsd, price);
  const estimatedCostSats = usdToSatsCeil(estimatedCostUsd, price);
  const bridgeCostSats = usdToSatsCeil(costs.p90BridgeUsd, price);
  const notionalSats = usdToSatsFloor(positionUsd, price);
  if ([grossRewardSats, haircutRewardSats, estimatedCostSats, bridgeCostSats, notionalSats].some((value) => value == null)) {
    return null;
  }
  const expectedNetSats = haircutRewardSats - estimatedCostSats;
  const expectedNetUsd = Number((haircutRewardUsd - estimatedCostUsd).toFixed(12));
  return {
    btcUsd: price,
    btcPriceSnapshotAt: btcPriceSnapshotAt || now,
    notionalSats,
    grossRewardSats,
    haircutRewardSats,
    estimatedCostSats,
    expectedNetSats,
    expectedNetUsd,
    holdDays,
    holdWindowSource,
    bridgeCostUsd: costs.p90BridgeUsd,
    bridgeCostSats,
    rewardHaircutPct: haircutPct,
    evidenceConfidence: "canary_proof",
    paybackConversionPath: queueItem.paybackConversionPath || queueItem.btcReturnPath || null,
    costComponentsUsd: costs,
    costComponentsSats: {
      p90GasSats: usdToSatsCeil(costs.p90GasUsd, price),
      p90BridgeSats: bridgeCostSats,
      p90ClaimSats: usdToSatsCeil(costs.p90ClaimUsd, price),
      p90RewardSwapSats: usdToSatsCeil(costs.p90RewardSwapUsd, price),
      slippageSats: usdToSatsCeil(costs.slippageUsd, price),
      unwindSats: usdToSatsCeil(costs.unwindUsd, price),
      extraEstimatedCostsSats: usdToSatsCeil(costs.extraEstimatedCostsUsd, price),
    },
    costSource: finite(queueItem.estimatedGasCostUsd) == null ? "config_fallback" : "measured_or_queue_estimate",
  };
}

export function buildMerklPortfolioAllocationPlan({
  queue = {},
  inventorySnapshot = null,
  canaryExecutions = [],
  positionRecords = [],
  auditRecords = [],
  externalChainUsd = {},
  targetChainUsd = null,
  chainTargetToleranceUsd = 5,
  policy: policyInput = {},
  maxUsd = null,
  btcPriceUsd = null,
  btcPriceSnapshotAt = null,
  now = new Date().toISOString(),
  campaignAprMap = null,
} = {}) {
  const policy = merklPortfolioPolicy(policyInput);
  const activePositions = activeMerklPortfolioPositions(positionRecords);
  const externalPositions = externalExposurePositions(externalChainUsd);
  const exposurePositions = [...activePositions, ...externalPositions];
  const activePositionUsd = activeUsd(activePositions);
  const activeChainUsd = activeBy(activePositions, (position) => position.chain);
  const exposureChainUsd = activeBy(exposurePositions, (position) => position.chain);
  const activeProtocolUsd = activeBy(activePositions, (position) => position.protocolId);
  const runBudgetUsd = Math.max(0, Math.min(
    finite(maxUsd) ?? Number.POSITIVE_INFINITY,
    policy.maxActiveUsd - activePositionUsd,
  ));
  const tokenBudgetUsd = new Map();

  const candidates = (queue.queue || []).map((rawItem) => {
    const queueItem = applyMerklCanaryExecutionReadiness(rawItem, {
      inventorySnapshot,
      canaryExecutions,
      now,
      cooldownMs: 0,
    });
    const canaryProof = latestDeliveredCanary(canaryExecutions, queueItem.opportunityId);
    const resolvedAprPct = campaignAprMap && campaignAprMap.has(queueItem.opportunityId)
      ? campaignAprMap.get(queueItem.opportunityId)
      : finite(queueItem.nativeAprPct) ?? finite(queueItem.aprPct) ?? finite(queueItem.apr) ?? 0;
    const opportunityActiveUsd = activeOpportunityUsd(activePositions, queueItem);
    const chainActiveUsd = exposureChainUsd.get(queueItem.chain) || 0;
    const protocolActiveUsd = activeProtocolUsd.get(queueItem.protocolId) || 0;
    const sizing = sizeMerklCanaryAmount(queueItem, {
      maxUsd: Math.min(policy.perOpportunityMaxUsd, runBudgetUsd || policy.perOpportunityMaxUsd),
      minEthereumNotionalUsd: finite(policy.minEthereumNotionalUsd) ?? undefined,
      allowInefficientEthereum: Boolean(policy.allowSmallEthereumProofBackedEntries && canaryProof),
      useTinyLiveCap: false,
      auditRecords,
      now,
    });
    const decision = buildCandidateDecision({
      queueItem,
      amountUsd: sizing.amountUsd,
      aprPct: resolvedAprPct,
      btcPriceUsd,
      btcPriceSnapshotAt,
      now,
    });
    const score = merklPortfolioScore(queueItem, { policy, canaryProof, campaignAprMap });
    const targetMaxAddUsd = chainTargetMaxAddUsd({
      chain: queueItem.chain,
      exposureChainUsd,
      targetChainUsd,
      toleranceUsd: chainTargetToleranceUsd,
    });
    const blockers = [];
    if (!isSupportedBindingKind(bindingKind(queueItem))) blockers.push("hold_executor_missing");
    if (!canaryProof) blockers.push("live_canary_proof_required_before_hold");
    if (sameOpportunityActive(activePositions, queueItem) && !policy.allowTopUps) blockers.push("opportunity_already_open");
    if ((finite(queueItem.campaignRemainingHours) ?? Number.POSITIVE_INFINITY) < policy.minRemainingHoursForEntry) {
      blockers.push("campaign_too_close_to_expiry");
    }
    if (score < policy.minScoreForEntry) blockers.push("portfolio_score_below_entry_floor");
    if (sizing.status !== "ready") blockers.push(...(sizing.blockers || ["sizing_not_ready"]));
    if (sizing.status === "ready" && !decision) blockers.push("btc_price_required_for_sats_decision");
    if (decision && decision.expectedNetSats <= 0) blockers.push("expected_net_sats_not_positive");
    const diversification = diversificationGateForAllocation({
      activePositions: exposurePositions,
      queueItem,
      addUsd: sizing.amountUsd,
    });
    const diversificationMaxUsd = diversificationMaxAddUsd({ activePositions: exposurePositions, queueItem });
    if (!diversification.accepted && diversificationMaxUsd < policy.minPositionUsd) {
      blockers.push("diversification_policy_rejected");
    }
    if (targetMaxAddUsd < policy.minPositionUsd) blockers.push("chain_target_exceeded");
    const needsCapitalJob =
      queueItem.capabilityGaps?.includes("current_inventory_entry_route_required") ||
      (sizing.blockers || []).some((blocker) => [
        "inventory_missing",
        "inventory_unknown",
        "matched_token_missing",
        "native_gas_missing",
      ].includes(blocker));
    return {
      queueItem,
      score,
      canaryProofObservedAt: canaryProof?.observedAt || null,
      opportunityActiveUsd,
      chainActiveUsd,
      protocolActiveUsd,
      diversification: {
        accepted: diversification.accepted,
        activeUsd: diversification.activeUsd,
        candidateUsd: diversification.candidateUsd,
        addShare: diversification.addShare,
        bypassed: diversification.bypassed || false,
        violations: diversification.verdict?.violations || [],
      },
      diversificationMaxUsd,
      targetChainUsd: targetChainUsd?.[queueItem.chain] ?? null,
      targetMaxAddUsd,
      sizing,
      decision,
      status: blockers.length ? "blocked" : "candidate",
      blockers,
      capitalJob: needsCapitalJob && canaryProof ? buildCapitalJob(queueItem) : null,
      graduationCanary: !canaryProof
        ? buildProofGraduationCanaryRequest({
            queueItem,
            canaryExecutions,
            auditRecords,
            now,
          })
        : null,
    };
  }).sort((left, right) => right.score - left.score || (right.sizing?.amountUsd ?? 0) - (left.sizing?.amountUsd ?? 0));

  const allocations = [];
  let remainingBudgetUsd = runBudgetUsd;
  for (const candidate of candidates) {
    if (candidate.status !== "candidate") {
      allocations.push(candidate);
      continue;
    }
    const key = tokenKey(candidate.queueItem);
    if (!tokenBudgetUsd.has(key)) {
      const tokenUsd = finite(candidate.queueItem.executionReadiness?.matchedToken?.estimatedUsd) ?? 0;
      tokenBudgetUsd.set(key, Math.max(0, tokenUsd * (1 - policy.reserveSourceInventoryPct)));
    }
    const remainingTokenUsd = tokenBudgetUsd.get(key) ?? 0;
    const chainLimitUsd = finite(policy.chainMaxUsd?.[candidate.queueItem.chain]) ?? Number.POSITIVE_INFINITY;
    const protocolLimitUsd = finite(policy.protocolMaxUsd?.[candidate.queueItem.protocolId]) ?? Number.POSITIVE_INFINITY;
    const targetUsd = Math.min(
      finite(candidate.sizing.amountUsd) ?? 0,
      Math.max(0, policy.perOpportunityMaxUsd - (finite(candidate.opportunityActiveUsd) ?? 0)),
      Math.max(0, chainLimitUsd - (finite(candidate.chainActiveUsd) ?? 0)),
      Math.max(0, protocolLimitUsd - (finite(candidate.protocolActiveUsd) ?? 0)),
      remainingBudgetUsd,
      remainingTokenUsd,
      finite(candidate.diversificationMaxUsd) ?? Number.POSITIVE_INFINITY,
      finite(candidate.targetMaxAddUsd) ?? Number.POSITIVE_INFINITY,
    );
    if (targetUsd < policy.minPositionUsd) {
      allocations.push({
        ...candidate,
        status: "blocked",
        blockers: ["target_allocation_below_min_position_usd"],
      });
      continue;
    }
    const resized = sizeMerklCanaryAmount(candidate.queueItem, {
      maxUsd: targetUsd,
      minEthereumNotionalUsd: finite(policy.minEthereumNotionalUsd) ?? undefined,
      allowInefficientEthereum: Boolean(policy.allowSmallEthereumProofBackedEntries && candidate.canaryProofObservedAt),
      useTinyLiveCap: false,
      auditRecords,
      now,
    });
    const resizedDecision = buildCandidateDecision({
      queueItem: candidate.queueItem,
      amountUsd: resized.amountUsd,
      aprPct: campaignAprMap && campaignAprMap.has(candidate.queueItem.opportunityId)
        ? campaignAprMap.get(candidate.queueItem.opportunityId)
        : finite(candidate.queueItem.nativeAprPct) ?? finite(candidate.queueItem.aprPct) ?? finite(candidate.queueItem.apr) ?? 0,
      btcPriceUsd,
      btcPriceSnapshotAt,
      now,
    });
    if (resized.status !== "ready") {
      allocations.push({
        ...candidate,
        sizing: resized,
        decision: resizedDecision,
        status: "blocked",
        blockers: resized.blockers || ["resized_amount_not_ready"],
      });
      continue;
    }
    if (!resizedDecision) {
      allocations.push({
        ...candidate,
        sizing: resized,
        decision: resizedDecision,
        status: "blocked",
        blockers: ["btc_price_required_for_sats_decision"],
      });
      continue;
    }
    if (resizedDecision && resizedDecision.expectedNetSats <= 0) {
      allocations.push({
        ...candidate,
        sizing: resized,
        decision: resizedDecision,
        status: "blocked",
        blockers: ["expected_net_sats_not_positive"],
      });
      continue;
    }
    const resizedDiversification = diversificationGateForAllocation({
      activePositions: exposurePositions,
      queueItem: candidate.queueItem,
      addUsd: resized.amountUsd,
    });
    if (!resizedDiversification.accepted) {
      allocations.push({
        ...candidate,
        sizing: resized,
        diversification: {
          accepted: false,
          activeUsd: resizedDiversification.activeUsd,
          candidateUsd: resizedDiversification.candidateUsd,
          addShare: resizedDiversification.addShare,
          bypassed: resizedDiversification.bypassed || false,
          violations: resizedDiversification.verdict?.violations || [],
        },
        status: "blocked",
        blockers: ["diversification_policy_rejected"],
      });
      continue;
    }
    const allocation = {
      ...candidate,
      sizing: resized,
      decision: resizedDecision,
      diversification: {
        accepted: true,
        activeUsd: resizedDiversification.activeUsd,
        candidateUsd: resizedDiversification.candidateUsd,
        addShare: resizedDiversification.addShare,
        bypassed: resizedDiversification.bypassed || false,
        violations: [],
      },
      status: "enter_ready",
      entryAction: candidate.opportunityActiveUsd > 0 ? "top_up" : "open",
      targetUsd: resized.amountUsd,
      targetAmount: resized.amount,
      blockers: [],
    };
    allocations.push(allocation);
    remainingBudgetUsd -= resized.amountUsd;
    tokenBudgetUsd.set(key, Math.max(0, remainingTokenUsd - resized.amountUsd));
  }

  const entryQueue = allocations
    .filter((item) => item.status === "enter_ready")
    .slice(0, Math.max(0, policy.maxOpenPositions - activePositions.length))
    .slice(0, policy.maxNewPositionsPerRun);
  const capitalJobs = allocations
    .map((item) => item.capitalJob)
    .filter(Boolean)
    .slice(0, 20);
  const graduationCanaryRequests = allocations
    .map((item) => item.graduationCanary?.request)
    .filter(Boolean)
    .slice(0, policy.maxNewPositionsPerRun);
  const graduationLimiters = (item) => {
    const evGate = item.graduationCanary?.evGate || null;
    const limiters = new Set();
    if (evGate?.limitingFactor) limiters.add(evGate.limitingFactor);
    if (
      Number.isFinite(evGate?.neededUsd) &&
      Number.isFinite(item.targetMaxAddUsd) &&
      item.targetMaxAddUsd < evGate.neededUsd
    ) {
      limiters.add("targetChainUsd");
    }
    return [...limiters];
  };
  const idleCapitalReport = {
    bridgeCostGreaterThanExpectedNet: allocations
      .filter((item) => item.decision && item.decision.bridgeCostSats > Math.max(0, item.decision.haircutRewardSats - item.decision.estimatedCostSats + item.decision.bridgeCostSats))
      .map((item) => ({
        opportunityId: item.queueItem?.opportunityId || null,
        chain: item.queueItem?.chain || null,
        bridgeCostSats: item.decision.bridgeCostSats,
        expectedNetSats: item.decision.expectedNetSats,
      })),
    minPositionBlocked: allocations
      .filter((item) => item.blockers?.includes("target_allocation_below_min_position_usd"))
      .map((item) => ({
        opportunityId: item.queueItem?.opportunityId || null,
        chain: item.queueItem?.chain || null,
        targetMaxAddUsd: item.targetMaxAddUsd ?? null,
      })),
    proofRequired: allocations
      .filter((item) => item.blockers?.includes("live_canary_proof_required_before_hold"))
      .map((item) => ({
        opportunityId: item.queueItem?.opportunityId || null,
        chain: item.queueItem?.chain || null,
        graduationReady: item.graduationCanary?.status === "ready",
        graduationBlockers: item.graduationCanary?.blockers || [],
        graduationEvGate: item.graduationCanary?.evGate || null,
        graduationLimiters: graduationLimiters(item),
        targetChainUsd: item.targetChainUsd ?? null,
        targetMaxAddUsd: item.targetMaxAddUsd ?? null,
      })),
    tokenDust: [...tokenBudgetUsd.entries()].map(([key, remainingUsd]) => ({
      tokenKey: key,
      remainingUsd,
    })),
  };

  return {
    schemaVersion: 1,
    observedAt: now,
    policy,
    summary: {
      queueCount: queue.queue?.length || 0,
      activePositionCount: activePositions.length,
      activePositionUsd,
      activeChainUsd: Object.fromEntries(activeChainUsd),
      externalChainUsd: { ...(externalChainUsd || {}) },
      exposureChainUsd: Object.fromEntries(exposureChainUsd),
      targetChainUsd: targetChainUsd ? { ...targetChainUsd } : null,
      activeProtocolUsd: Object.fromEntries(activeProtocolUsd),
      runBudgetUsd,
      entryReadyCount: entryQueue.length,
      graduationCanaryRequestCount: graduationCanaryRequests.length,
      blockedCount: allocations.filter((item) => item.status === "blocked").length,
      capitalJobCount: capitalJobs.length,
      topEntryOpportunityId: entryQueue[0]?.queueItem?.opportunityId || null,
      topEntryScore: entryQueue[0]?.score ?? null,
    },
    activePositions,
    entryQueue,
    allocations,
    capitalJobs,
    graduationCanaryRequests,
    idleCapitalReport,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readCampaignAwareAprMap(dataDir) {
  const raw = await readJsonIfExists(join(dataDir, "campaign-aware-opportunities.json"));
  const candidates = raw?.candidates || [];
  const map = new Map();
  for (const c of candidates) {
    if (c.opportunityId && Number.isFinite(c.expectedRealizedAprAfterHaircut)) {
      map.set(c.opportunityId, c.expectedRealizedAprAfterHaircut);
    }
  }
  return map;
}

function txHashForStep(execution = {}, stepIds = []) {
  return (execution.stepResults || [])
    .find((step) => stepIds.includes(step.id))
    ?.signerResult?.broadcast?.txHash || null;
}

export function parseInsufficientAssetBalance(error) {
  const message = error?.message || String(error || "");
  const match = message.match(/Insufficient asset balance:\s*required\s+(\d+),\s*available\s+(\d+)/u);
  if (!match) return null;
  return {
    required: match[1],
    available: match[2],
  };
}

export function retryAmountFromAvailableBalance({ available, reservePct = 0.01 } = {}) {
  let availableAmount = 0n;
  try {
    availableAmount = BigInt(available ?? 0);
  } catch {
    return null;
  }
  if (availableAmount <= 1n) return null;
  const reserveBps = BigInt(Math.max(0, Math.min(2_500, Math.ceil((finite(reservePct) ?? 0.01) * 10_000))));
  const retryAmount = (availableAmount * (10_000n - reserveBps)) / 10_000n;
  return retryAmount > 0n && retryAmount < availableAmount ? retryAmount.toString() : (availableAmount - 1n).toString();
}

function proportionalUsd(amountUsd, retryAmount, originalAmount) {
  const usd = finite(amountUsd);
  if (usd == null) return null;
  const retry = Number(retryAmount);
  const original = Number(originalAmount);
  if (!Number.isFinite(retry) || !Number.isFinite(original) || original <= 0) return usd;
  return usd * (retry / original);
}

export function executionErrorBlockers(error) {
  const message = error?.message || String(error);
  if (parseInsufficientAssetBalance(error)) return ["insufficient_asset_balance"];
  if (/insufficient_native_balance_for_gas/iu.test(message)) return ["insufficient_native_gas_balance"];
  if (/waitForTransaction failed .*timeout|code=TIMEOUT|timed out/iu.test(message)) return ["receipt_confirmation_timeout"];
  return ["portfolio_execution_error"];
}

function buildPositionRecord({ allocation, plan, execution, now = new Date().toISOString() } = {}) {
  const entryTxHash = txHashForStep(execution, ["deposit_asset_to_vault", "supply_asset_to_pool"]);
  const positionId = `merkl:${plan.chain}:${plan.opportunityId}:${entryTxHash || now}`;
  const minHoldUntil = new Date(new Date(now).getTime() + (allocation.policy?.minHoldMinutes || 30) * 60_000).toISOString();
  return {
    schemaVersion: 1,
    event: "position_opened",
    status: "open",
    observedAt: now,
    positionId,
    opportunityId: plan.opportunityId,
    chain: plan.chain,
    protocolId: plan.protocolId,
    bindingKind: plan.bindingKind,
    strategyId: plan.strategyId,
    name: plan.name,
    amount: plan.amount,
    amountUsd: plan.amountUsd,
    shareDelta: execution.positionProof?.observedDelta || execution.shareProof?.observedDelta || null,
    entryAprPct: allocation.queueItem?.nativeAprPct ?? allocation.queueItem?.aprPct ?? null,
    rewardTokenPriceUsdAtEntry: allocation.queueItem?.rewardTokenPriceUsd ?? null,
    volume24hUsdAtEntry: allocation.queueItem?.volume24hUsd ?? null,
    vaultAddress: plan.vaultAddress || plan.shareTokenAddress,
    poolAddress: plan.poolAddress || null,
    poolAddressProviderAddress: plan.poolAddressProviderAddress || null,
    marketName: plan.marketName || null,
    assetAddress: plan.assetAddress,
    shareTokenAddress: plan.shareTokenAddress,
    txHash: entryTxHash,
    entryTxHash,
    approvalTxHash: txHashForStep(execution, ["approve_asset_to_vault", "approve_asset_to_pool"]),
    score: allocation.score,
    campaignRemainingHoursAtEntry: allocation.queueItem?.campaignRemainingHours ?? null,
    minHoldUntil,
    exitTriggers: [
      "campaign_expires_inside_exit_lookahead",
      "opportunity_missing_from_merkl_queue",
      "portfolio_score_drops_below_entry_floor",
      "realized_apr_below_entry_ratio",
      "reward_token_price_drop",
      "volume_24h_drop",
      "kill_switch_or_policy_unwind",
    ],
  };
}

export async function runMerklPortfolioAllocator({
  execute = false,
  write = false,
  refreshInventory = true,
  queuePath = join(config.dataDir, "merkl-canary-queue.json"),
  socketPath,
  timeoutMs,
  maxUsd = null,
  policy: policyInput = {},
} = {}) {
  const preflight = await preflightLiveCanarySweep({
    socketPath,
    timeoutMs,
    requireLiveBaseline: false,
  });
  if (preflight.status !== "ready") {
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: preflight.blockedReason || "live_canary_preflight_not_ready",
      preflight,
    };
    if (write) await writePortfolioReport(report);
    return report;
  }

  const queue = await readJson(queuePath);
  const [inventoryRecords, protocolCanaryExecutions, autopilotExecutions, positionRecords, auditRecords, wholeWalletInventoryRecords] = await Promise.all([
    readJsonl(config.dataDir, "treasury-inventory"),
    readJsonl(config.dataDir, "erc4626-protocol-canaries"),
    readJsonl(config.dataDir, "merkl-canary-autopilot-runs").catch(() => []),
    readJsonl(config.dataDir, "merkl-portfolio-positions").catch(() => []),
    readJsonl("logs", "signer-audit").catch(() => []),
    readJsonl(config.dataDir, "whole-wallet-inventory").catch(() => []),
  ]);
  const canaryExecutions = [...protocolCanaryExecutions, ...autopilotExecutions];
  const store = new JsonlStore(config.dataDir);
  let inventorySnapshot = latestTreasuryInventoryForAddress(inventoryRecords, preflight.senderAddress);
  let inventoryRefresh = {
    attempted: false,
    status: inventorySnapshot ? "stored_snapshot" : "missing",
    observedAt: inventorySnapshot?.observedAt || null,
    error: null,
  };
  let livePrices = null;
  if (refreshInventory) {
    inventoryRefresh = {
      attempted: true,
      status: "refreshing",
      observedAt: null,
      error: null,
    };
    try {
      const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
      livePrices = prices;
      inventorySnapshot = await scanTreasuryInventory({
        policy: validateTreasuryPolicy(buildDefaultTreasuryPolicy()),
        address: preflight.senderAddress,
        prices,
      });
      await store.append("treasury-inventory", inventorySnapshot);
      inventoryRefresh = {
        attempted: true,
        status: "live_scan",
        observedAt: inventorySnapshot.observedAt,
        error: null,
      };
    } catch (error) {
      inventoryRefresh = {
        attempted: true,
        status: inventorySnapshot ? "fallback_stored_snapshot" : "failed",
        observedAt: inventorySnapshot?.observedAt || null,
        error: error.message,
      };
    }
  }
  const externalChainUsd = inventoryExposureByChainUsd(
    latestWholeWalletInventoryForAddress(wholeWalletInventoryRecords, preflight.senderAddress) || inventorySnapshot,
  );
  const activePositions = activeMerklPortfolioPositions(positionRecords);
  const totalCapitalUsd = activeUsd(activePositions) + sumUsd(externalChainUsd);
  const [promotionGate, economics] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonIfExists(join(config.dataDir, "destination-economics-ledger.json")),
  ]);
  const scoredTargets = totalCapitalUsd > 0
    ? buildScoredTargetBalances({
        promotionGate,
        economics,
        strategyCaps: listStrategyCaps(),
        totalCapitalUsd,
        chainScoreLedger: buildChainScoreLedger({
          records: auditRecords,
          now: new Date().toISOString(),
        }),
      })
    : null;
  const targetChainUsd = scoredTargets
    ? Object.fromEntries((scoredTargets.perChain || []).map((entry) => [entry.chain, entry.settlementTargetUsd || 0]))
    : null;
  const campaignAprMap = await readCampaignAwareAprMap(config.dataDir);
  const [storedPriceSnapshot, marketPriceSnapshots] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "price-snapshot.json")),
    readJsonl(config.dataDir, "market-price-snapshots").catch(() => []),
  ]);
  const observedPriceSnapshot = storedPriceSnapshot || latestPriceSnapshot(marketPriceSnapshots);
  const observedPrices = observedPriceSnapshot ? pricesFromSnapshot(observedPriceSnapshot) : emptyPricesUsd();
  const btcPriceUsd = finitePositive(livePrices?.btc) ?? finitePositive(observedPrices.btc);
  const btcPriceSnapshotAt = finitePositive(livePrices?.btc)
    ? inventoryRefresh.observedAt || new Date().toISOString()
    : observedPriceSnapshot?.observedAt || null;
  const plan = buildMerklPortfolioAllocationPlan({
    queue,
    inventorySnapshot,
    canaryExecutions,
    positionRecords,
    auditRecords,
    externalChainUsd,
    targetChainUsd,
    policy: policyInput,
    maxUsd,
    btcPriceUsd,
    btcPriceSnapshotAt,
    campaignAprMap,
  });

  const executions = [];
  if (execute) {
    for (const allocation of plan.entryQueue) {
      const queueItem = allocation.queueItem;
      const buildPlan = resolvePlanBuilder(bindingKind(queueItem));
      const executePlan = resolvePlanExecutor(bindingKind(queueItem));
      if (!buildPlan || !executePlan) {
        executions.push({
          opportunityId: queueItem.opportunityId,
          status: "blocked",
          blockers: ["hold_executor_missing"],
        });
        continue;
      }
      const protocolPlan = await buildPlan({
        queueItem,
        senderAddress: preflight.senderAddress,
        amount: allocation.targetAmount,
      });
      let execution = null;
      let executedPlan = protocolPlan;
      let executedAllocation = allocation;
      try {
        execution = await executePlan({
          plan: protocolPlan,
          socketPath,
          timeoutMs,
          exitAfterProof: false,
        });
      } catch (error) {
        const insufficient = parseInsufficientAssetBalance(error);
        const retryAmount = insufficient
          ? retryAmountFromAvailableBalance({
              available: insufficient.available,
              reservePct: plan.policy.reserveSourceInventoryPct,
            })
          : null;
        if (retryAmount && BigInt(retryAmount) > 0n && BigInt(retryAmount) < BigInt(allocation.targetAmount)) {
          const retryPlan = await buildPlan({
            queueItem,
            senderAddress: preflight.senderAddress,
            amount: retryAmount,
          });
          try {
            execution = await executePlan({
              plan: retryPlan,
              socketPath,
              timeoutMs,
              exitAfterProof: false,
            });
            executedPlan = retryPlan;
            executedAllocation = {
              ...allocation,
              targetAmount: retryAmount,
              targetUsd: proportionalUsd(allocation.targetUsd, retryAmount, allocation.targetAmount),
            };
          } catch (retryError) {
            executions.push({
              opportunityId: queueItem.opportunityId,
              status: "blocked",
              blockers: executionErrorBlockers(retryError),
              retryAttempted: true,
              error: {
                message: retryError?.message || String(retryError),
              },
              plan: {
                chain: retryPlan.chain,
                amount: retryPlan.amount,
                assetAddress: retryPlan.assetAddress,
              },
            });
            continue;
          }
        } else {
          executions.push({
            opportunityId: queueItem.opportunityId,
            status: "blocked",
            blockers: executionErrorBlockers(error),
            retryAttempted: Boolean(insufficient),
            error: {
              message: error?.message || String(error),
            },
            plan: {
              chain: protocolPlan.chain,
              amount: protocolPlan.amount,
              assetAddress: protocolPlan.assetAddress,
            },
          });
          continue;
        }
      }
      const positionRecord = execution.settlementStatus === "position_opened"
        ? buildPositionRecord({
            allocation: { ...executedAllocation, policy: plan.policy },
            plan: executedPlan,
            execution,
            now: execution.observedAt,
          })
        : null;
      if (positionRecord) await store.append("merkl-portfolio-positions", positionRecord);
      executions.push({
        opportunityId: queueItem.opportunityId,
        status: execution.settlementStatus,
        txHashes: (execution.stepResults || [])
          .map((step) => step.signerResult?.broadcast?.txHash)
          .filter(Boolean),
        positionRecord,
        execution,
      });
    }
  }

  const openedCount = executions.filter((item) => item.status === "position_opened").length;
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: execute ? "execute" : "preview",
    status: execute
      ? openedCount > 0
        ? "positions_opened"
        : plan.entryQueue.length > 0
          ? "no_position_opened"
          : "blocked"
      : plan.entryQueue.length > 0
        ? "preview_ready"
        : "blocked",
    blockedReason: plan.entryQueue.length > 0 ? null : "no_portfolio_entry_ready",
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      killSwitchPath: preflight.killSwitchPath,
    },
    inventoryRefresh,
    plan,
    executions,
  };
  if (write) await writePortfolioReport(report);
  return report;
}

async function writePortfolioReport(report) {
  await writeTextIfChanged(join(config.dataDir, "merkl-portfolio-allocator-latest.json"), `${safeJsonStringify(report, 2)}\n`);
  await new JsonlStore(config.dataDir).append("merkl-portfolio-allocator-runs", JSON.parse(safeJsonStringify(report)));
}
