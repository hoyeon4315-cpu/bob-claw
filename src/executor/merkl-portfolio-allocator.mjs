import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { merklPortfolioPolicy } from "../config/merkl-portfolio.mjs";
import { DIVERSIFICATION_POLICY, canAcceptNewAllocation, computeHhi } from "../config/diversification.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
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


function finite(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    const strategyId = position.strategyId || position.opportunityId || position.positionId;
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
      strategyId: queueItem.mappedStrategyId || queueItem.opportunityId,
      chainId: queueItem.chain,
      protocolIds: [queueItem.protocolId].filter(Boolean),
      directHolding: false,
      addShare: candidateUsd / denominatorUsd,
    },
  );
  const candidateStrategyId = queueItem.mappedStrategyId || queueItem.opportunityId;
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
} = {}) {
  const weights = policy.scoreWeights;
  const apr = finite(queueItem.nativeAprPct) ?? finite(queueItem.aprPct) ?? 0;
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

export function buildMerklPortfolioAllocationPlan({
  queue = {},
  inventorySnapshot = null,
  canaryExecutions = [],
  positionRecords = [],
  auditRecords = [],
  policy: policyInput = {},
  maxUsd = null,
  now = new Date().toISOString(),
} = {}) {
  const policy = merklPortfolioPolicy(policyInput);
  const activePositions = activeMerklPortfolioPositions(positionRecords);
  const activePositionUsd = activeUsd(activePositions);
  const activeChainUsd = activeBy(activePositions, (position) => position.chain);
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
    const opportunityActiveUsd = activeOpportunityUsd(activePositions, queueItem);
    const chainActiveUsd = activeChainUsd.get(queueItem.chain) || 0;
    const protocolActiveUsd = activeProtocolUsd.get(queueItem.protocolId) || 0;
    const sizing = sizeMerklCanaryAmount(queueItem, {
      maxUsd: Math.min(policy.perOpportunityMaxUsd, runBudgetUsd || policy.perOpportunityMaxUsd),
      minEthereumNotionalUsd: finite(policy.minEthereumNotionalUsd) ?? undefined,
      allowInefficientEthereum: Boolean(policy.allowSmallEthereumProofBackedEntries && canaryProof),
      useTinyLiveCap: false,
      auditRecords,
      now,
    });
    const score = merklPortfolioScore(queueItem, { policy, canaryProof });
    const blockers = [];
    if (!isSupportedBindingKind(bindingKind(queueItem))) blockers.push("hold_executor_missing");
    if (!canaryProof) blockers.push("live_canary_proof_required_before_hold");
    if (sameOpportunityActive(activePositions, queueItem) && !policy.allowTopUps) blockers.push("opportunity_already_open");
    if ((finite(queueItem.campaignRemainingHours) ?? Number.POSITIVE_INFINITY) < policy.minRemainingHoursForEntry) {
      blockers.push("campaign_too_close_to_expiry");
    }
    if (score < policy.minScoreForEntry) blockers.push("portfolio_score_below_entry_floor");
    if (sizing.status !== "ready") blockers.push(...(sizing.blockers || ["sizing_not_ready"]));
    const diversification = diversificationGateForAllocation({
      activePositions,
      queueItem,
      addUsd: sizing.amountUsd,
    });
    if (!diversification.accepted) blockers.push("diversification_policy_rejected");
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
      sizing,
      status: blockers.length ? "blocked" : "candidate",
      blockers,
      capitalJob: needsCapitalJob ? buildCapitalJob(queueItem) : null,
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
    if (resized.status !== "ready") {
      allocations.push({
        ...candidate,
        sizing: resized,
        status: "blocked",
        blockers: resized.blockers || ["resized_amount_not_ready"],
      });
      continue;
    }
    const resizedDiversification = diversificationGateForAllocation({
      activePositions,
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

  return {
    schemaVersion: 1,
    observedAt: now,
    policy,
    summary: {
      queueCount: queue.queue?.length || 0,
      activePositionCount: activePositions.length,
      activePositionUsd,
      activeChainUsd: Object.fromEntries(activeChainUsd),
      activeProtocolUsd: Object.fromEntries(activeProtocolUsd),
      runBudgetUsd,
      entryReadyCount: entryQueue.length,
      blockedCount: allocations.filter((item) => item.status === "blocked").length,
      capitalJobCount: capitalJobs.length,
      topEntryOpportunityId: entryQueue[0]?.queueItem?.opportunityId || null,
      topEntryScore: entryQueue[0]?.score ?? null,
    },
    activePositions,
    entryQueue,
    allocations,
    capitalJobs,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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
  if (parseInsufficientAssetBalance(error)) return ["insufficient_asset_balance"];
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
  const [inventoryRecords, protocolCanaryExecutions, autopilotExecutions, positionRecords, auditRecords] = await Promise.all([
    readJsonl(config.dataDir, "treasury-inventory"),
    readJsonl(config.dataDir, "erc4626-protocol-canaries"),
    readJsonl(config.dataDir, "merkl-canary-autopilot-runs").catch(() => []),
    readJsonl(config.dataDir, "merkl-portfolio-positions").catch(() => []),
    readJsonl("logs", "signer-audit").catch(() => []),
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
  if (refreshInventory) {
    inventoryRefresh = {
      attempted: true,
      status: "refreshing",
      observedAt: null,
      error: null,
    };
    try {
      const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
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
  const plan = buildMerklPortfolioAllocationPlan({
    queue,
    inventorySnapshot,
    canaryExecutions,
    positionRecords,
    auditRecords,
    policy: policyInput,
    maxUsd,
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
