import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { merklPortfolioPolicy } from "../config/merkl-portfolio.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import {
  buildAaveProtocolCanaryPlan,
  executeAaveProtocolCanaryPlan,
} from "./helpers/aave-protocol-canary.mjs";
import {
  buildErc4626ProtocolCanaryPlan,
  executeErc4626ProtocolCanaryPlan,
} from "./helpers/erc4626-protocol-canary.mjs";
import {
  applyMerklCanaryExecutionReadiness,
  latestTreasuryInventoryForAddress,
} from "../strategy/merkl-canary-execution-readiness.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { sizeMerklCanaryAmount } from "./merkl-canary-autopilot.mjs";

const SUPPORTED_HOLD_BINDINGS = new Set([
  "erc4626_vault_supply_withdraw",
  "euler_evault_deposit_withdraw",
  "aave_v3_pool_supply_withdraw",
]);

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
    });
    const canaryProof = latestDeliveredCanary(canaryExecutions, queueItem.opportunityId);
    const opportunityActiveUsd = activeOpportunityUsd(activePositions, queueItem);
    const sizing = sizeMerklCanaryAmount(queueItem, {
      maxUsd: Math.min(policy.perOpportunityMaxUsd, runBudgetUsd || policy.perOpportunityMaxUsd),
      auditRecords,
      now,
    });
    const score = merklPortfolioScore(queueItem, { policy, canaryProof });
    const blockers = [];
    if (!SUPPORTED_HOLD_BINDINGS.has(bindingKind(queueItem))) blockers.push("hold_executor_missing");
    if (!canaryProof) blockers.push("live_canary_proof_required_before_hold");
    if (sameOpportunityActive(activePositions, queueItem) && !policy.allowTopUps) blockers.push("opportunity_already_open");
    if ((finite(queueItem.campaignRemainingHours) ?? Number.POSITIVE_INFINITY) < policy.minRemainingHoursForEntry) {
      blockers.push("campaign_too_close_to_expiry");
    }
    if (score < policy.minScoreForEntry) blockers.push("portfolio_score_below_entry_floor");
    if (sizing.status !== "ready") blockers.push(...(sizing.blockers || ["sizing_not_ready"]));
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
    const targetUsd = Math.min(
      finite(candidate.sizing.amountUsd) ?? 0,
      Math.max(0, policy.perOpportunityMaxUsd - (finite(candidate.opportunityActiveUsd) ?? 0)),
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
    const allocation = {
      ...candidate,
      sizing: resized,
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

function builderFor(queueItem) {
  return bindingKind(queueItem) === "aave_v3_pool_supply_withdraw"
    ? buildAaveProtocolCanaryPlan
    : buildErc4626ProtocolCanaryPlan;
}

function executorFor(queueItem) {
  return bindingKind(queueItem) === "aave_v3_pool_supply_withdraw"
    ? executeAaveProtocolCanaryPlan
    : executeErc4626ProtocolCanaryPlan;
}

function txHashForStep(execution = {}, stepIds = []) {
  return (execution.stepResults || [])
    .find((step) => stepIds.includes(step.id))
    ?.signerResult?.broadcast?.txHash || null;
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
    vaultAddress: plan.vaultAddress || plan.shareTokenAddress,
    poolAddress: plan.poolAddress || null,
    poolAddressProviderAddress: plan.poolAddressProviderAddress || null,
    marketName: plan.marketName || null,
    assetAddress: plan.assetAddress,
    shareTokenAddress: plan.shareTokenAddress,
    entryTxHash,
    approvalTxHash: txHashForStep(execution, ["approve_asset_to_vault", "approve_asset_to_pool"]),
    score: allocation.score,
    campaignRemainingHoursAtEntry: allocation.queueItem?.campaignRemainingHours ?? null,
    minHoldUntil,
    exitTriggers: [
      "campaign_expires_inside_exit_lookahead",
      "opportunity_missing_from_merkl_queue",
      "portfolio_score_drops_below_entry_floor",
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
      const buildPlan = builderFor(queueItem);
      const executePlan = executorFor(queueItem);
      const protocolPlan = await buildPlan({
        queueItem,
        senderAddress: preflight.senderAddress,
        amount: allocation.targetAmount,
      });
      const execution = await executePlan({
        plan: protocolPlan,
        socketPath,
        timeoutMs,
        exitAfterProof: false,
      });
      const positionRecord = execution.settlementStatus === "position_opened"
        ? buildPositionRecord({
            allocation: { ...allocation, policy: plan.policy },
            plan: protocolPlan,
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
