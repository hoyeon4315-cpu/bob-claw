import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { merklPortfolioPolicy } from "../config/merkl-portfolio.mjs";
import { evaluateMerklUnderperformExit } from "../config/merkl-exit-rules.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import { activeMerklPortfolioPositions, merklPortfolioScore } from "./merkl-portfolio-allocator.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { buildScoredTargetBalances } from "./capital/scored-target-balances.mjs";
import { latestWholeWalletInventoryForAddress } from "../treasury/whole-wallet-scan.mjs";
import {
  executeAavePortfolioExit,
  executeErc4626PortfolioExit,
} from "./helpers/merkl-portfolio-exit-executors.mjs";

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positionUsd(position = {}) {
  return finite(position.amountUsd) ?? 0;
}

function objectFromTargetChainUsd(targetChainUsd = {}) {
  if (targetChainUsd instanceof Map) return Object.fromEntries(targetChainUsd);
  return targetChainUsd && typeof targetChainUsd === "object" ? targetChainUsd : {};
}

function amountCents(value) {
  const usd = finite(value) ?? 0;
  return Math.max(0, Math.round(usd * 100));
}

export function confirmationTimeoutMsForExit(timeoutMs = null) {
  const parsed = Number(timeoutMs);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 120_000) : 120_000;
}

function sumObjectValues(values = {}) {
  return Object.values(values || {})
    .map((value) => finite(value))
    .filter((value) => value != null)
    .reduce((sum, value) => sum + value, 0);
}

function addChainUsd(target, chain, usd) {
  const value = finite(usd);
  if (!chain || chain === "bitcoin" || value == null || value <= 0) return;
  target[chain] = (target[chain] || 0) + value;
}

function walletInventoryExposureByChainUsd(inventory = {}) {
  const result = {};
  for (const item of inventory?.native || []) addChainUsd(result, item.chain, item.estimatedUsd);
  for (const item of inventory?.tokenBalances || []) addChainUsd(result, item.chain, item.estimatedUsd);
  for (const item of inventory?.tokens || []) addChainUsd(result, item.chain, item.estimatedUsd);
  return result;
}

function chooseClosestExitSubset(positions = [], targetUsd = 0) {
  const target = amountCents(targetUsd);
  const candidates = positions
    .filter((position) => positionUsd(position) > 0)
    .map((position) => ({
      position,
      cents: amountCents(positionUsd(position)),
      score: finite(position.score) ?? 0,
    }))
    .filter((item) => item.cents > 0)
    .sort((left, right) => left.score - right.score || right.cents - left.cents);
  if (candidates.length === 0 || target <= 0) return [];

  const averageScore = (record) => record.scoreSum / Math.max(1, record.indexes.length);
  const shouldReplaceRecord = (nextRecord, existingRecord) => {
    if (!existingRecord) return true;
    const nextAverage = averageScore(nextRecord);
    const existingAverage = averageScore(existingRecord);
    return (
      nextAverage < existingAverage ||
      (nextAverage === existingAverage && nextRecord.scoreSum < existingRecord.scoreSum) ||
      (nextAverage === existingAverage &&
        nextRecord.scoreSum === existingRecord.scoreSum &&
        nextRecord.indexes.length > existingRecord.indexes.length)
    );
  };

  const dp = new Map([[0, { indexes: [], scoreSum: 0 }]]);
  candidates.forEach((candidate, index) => {
    const entries = [...dp.entries()];
    for (const [sum, record] of entries) {
      const nextSum = sum + candidate.cents;
      const nextRecord = {
        indexes: [...record.indexes, index],
        scoreSum: record.scoreSum + candidate.score,
      };
      const existing = dp.get(nextSum);
      if (shouldReplaceRecord(nextRecord, existing)) {
        dp.set(nextSum, nextRecord);
      }
    }
  });

  let bestSum = null;
  let bestRecord = null;
  for (const [sum, record] of dp.entries()) {
    if (sum === 0) continue;
    if (bestSum === null) {
      bestSum = sum;
      bestRecord = record;
      continue;
    }
    const diff = Math.abs(sum - target);
    const bestDiff = Math.abs(bestSum - target);
    const overshoots = sum > target;
    const bestOvershoots = bestSum > target;
    if (
      diff < bestDiff ||
      (diff === bestDiff && overshoots === false && bestOvershoots === true) ||
      (diff === bestDiff && overshoots === bestOvershoots && shouldReplaceRecord(record, bestRecord))
    ) {
      bestSum = sum;
      bestRecord = record;
    }
  }
  return (bestRecord?.indexes || []).map((index) => candidates[index].position);
}

export function buildMerklPortfolioRebalanceExitPlan({
  positions = [],
  targetChainUsd = {},
  externalChainUsd = {},
  toleranceUsd = 5,
} = {}) {
  const targets = objectFromTargetChainUsd(targetChainUsd);
  const external = objectFromTargetChainUsd(externalChainUsd);
  const chainPlans = {};
  const positionsById = {};
  const positionsToExit = [];
  const byChain = new Map();
  for (const position of positions || []) {
    if (!position?.positionId || position.status !== "open") continue;
    const chain = position.chain || "unknown";
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain).push(position);
  }

  for (const [chain, chainPositions] of byChain.entries()) {
    const activeUsd = chainPositions.reduce((sum, position) => sum + positionUsd(position), 0);
    const currentUsd = activeUsd + (finite(external[chain]) ?? 0);
    const targetUsd = finite(targets[chain]) ?? 0;
    const excessUsd = currentUsd - targetUsd;
    const selected = excessUsd > toleranceUsd
      ? chooseClosestExitSubset(chainPositions, excessUsd)
      : [];
    const selectedExitUsd = selected.reduce((sum, position) => sum + positionUsd(position), 0);
    chainPlans[chain] = {
      chain,
      currentUsd,
      activeUsd,
      externalUsd: finite(external[chain]) ?? 0,
      targetUsd,
      excessUsd: Math.max(0, excessUsd),
      selectedExitUsd,
      retainedUsd: currentUsd - selectedExitUsd,
      toleranceUsd,
      selectedPositionIds: selected.map((position) => position.positionId),
    };
    for (const position of selected) {
      const record = {
        trigger: "portfolio_chain_target_rebalance",
        chain,
        currentUsd,
        activeUsd,
        externalUsd: finite(external[chain]) ?? 0,
        targetUsd,
        excessUsd: Math.max(0, excessUsd),
        selectedExitUsd,
        retainedUsd: currentUsd - selectedExitUsd,
      };
      positionsById[position.positionId] = record;
      positionsToExit.push({
        positionId: position.positionId,
        opportunityId: position.opportunityId || null,
        chain,
        amountUsd: positionUsd(position),
        score: finite(position.score),
        ...record,
      });
    }
  }

  return {
    schemaVersion: 1,
    status: positionsToExit.length > 0 ? "rebalance_exit_ready" : "balanced",
    targetChainUsd: targets,
    externalChainUsd: external,
    toleranceUsd,
    positionsById,
    positionsToExit,
    chainPlans,
    summary: {
      exitPositionCount: positionsToExit.length,
      exitUsd: positionsToExit.reduce((sum, position) => sum + position.amountUsd, 0),
      overTargetChainCount: Object.values(chainPlans).filter((plan) => plan.excessUsd > toleranceUsd).length,
    },
  };
}

function queueItemByOpportunity(queue = {}, opportunityId = null) {
  return (queue.queue || []).find((item) => String(item.opportunityId) === String(opportunityId)) || null;
}

function bindingForPosition(position = {}, queueItem = null) {
  return {
    ...(queueItem?.protocolBindingPlan?.resolvedBinding || {}),
    poolAddress: position.poolAddress || queueItem?.protocolBindingPlan?.resolvedBinding?.poolAddress || null,
    poolAddressProviderAddress:
      position.poolAddressProviderAddress || queueItem?.protocolBindingPlan?.resolvedBinding?.poolAddressProviderAddress || null,
    marketName: position.marketName || queueItem?.protocolBindingPlan?.resolvedBinding?.marketName || null,
  };
}

function hydratePositionFromQueue(position = {}, queue = {}) {
  const queueItem = queueItemByOpportunity(queue, position?.opportunityId);
  const binding = bindingForPosition(position, queueItem);
  return {
    ...position,
    poolAddress: binding.poolAddress || position.poolAddress || null,
    poolAddressProviderAddress: binding.poolAddressProviderAddress || position.poolAddressProviderAddress || null,
    marketName: binding.marketName || position.marketName || null,
  };
}

export function evaluateMerklPositionExit({
  position,
  queue = {},
  policy: policyInput = {},
  now = new Date().toISOString(),
  force = false,
  rebalanceExitPlan = null,
} = {}) {
  const policy = merklPortfolioPolicy(policyInput);
  const queueItem = queueItemByOpportunity(queue, position?.opportunityId);
  const triggers = [];
  const blockers = [];
  if (!position || position.status !== "open") blockers.push("position_not_open");
  if (force) triggers.push("force_exit_requested");
  const minHoldUntil = position?.minHoldUntil ? new Date(position.minHoldUntil) : null;
  if (!force && minHoldUntil && minHoldUntil > new Date(now)) blockers.push("min_hold_not_elapsed");
  if (!queueItem) {
    triggers.push("opportunity_missing_from_merkl_queue");
  } else {
    const remainingHours = finite(queueItem.campaignRemainingHours);
    if (remainingHours != null && remainingHours <= policy.exitLookaheadHours) {
      triggers.push("campaign_expires_inside_exit_lookahead");
    }
    const score = merklPortfolioScore(queueItem, { policy });
    if (score < policy.minScoreForEntry) triggers.push("portfolio_score_drops_below_entry_floor");
    const underperform = evaluateMerklUnderperformExit({
      position,
      queueItem,
      rules: policyInput.exitRules || {},
    });
    triggers.push(...underperform.triggers);
  }
  const rebalance = position?.positionId ? rebalanceExitPlan?.positionsById?.[position.positionId] : null;
  if (rebalance) triggers.push(rebalance.trigger || "portfolio_chain_target_rebalance");
  return {
    positionId: position?.positionId || null,
    opportunityId: position?.opportunityId || null,
    status: triggers.length > 0 && blockers.length === 0 ? "exit_ready" : "hold",
    triggers,
    blockers,
    queueItemFound: Boolean(queueItem),
    ...(rebalance ? { rebalance } : {}),
  };
}

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readLatestWholeWalletInventory(address) {
  if (!address) return null;
  const records = await readJsonl(config.dataDir, "whole-wallet-inventory").catch(() => []);
  return latestWholeWalletInventoryForAddress(records, address);
}

async function buildRebalanceExitPlanForPositions({ positions = [], policy = {}, now, address = null } = {}) {
  const rebalancePolicy = policy.portfolioRebalance || {};
  if (rebalancePolicy.enabled === false || positions.length === 0) {
    return buildMerklPortfolioRebalanceExitPlan({ positions, targetChainUsd: {}, toleranceUsd: rebalancePolicy.toleranceUsd ?? 5 });
  }
  const wholeWalletInventory = await readLatestWholeWalletInventory(address);
  const externalChainUsd = walletInventoryExposureByChainUsd(wholeWalletInventory);
  const activeCapitalUsd = positions.reduce((sum, position) => sum + positionUsd(position), 0);
  const totalCapitalUsd = activeCapitalUsd + sumObjectValues(externalChainUsd);
  if (!(totalCapitalUsd > 0)) {
    return buildMerklPortfolioRebalanceExitPlan({ positions, targetChainUsd: {}, toleranceUsd: rebalancePolicy.toleranceUsd ?? 5 });
  }
  const [promotionGate, economics] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonIfExists(join(config.dataDir, "destination-economics-ledger.json")),
  ]);
  const scoredTargets = buildScoredTargetBalances({
    promotionGate,
    economics,
    strategyCaps: listStrategyCaps(),
    totalCapitalUsd,
    now,
  });
  const targetChainUsd = Object.fromEntries(
    (scoredTargets.perChain || []).map((entry) => [entry.chain, entry.settlementTargetUsd || 0]),
  );
  return {
    ...buildMerklPortfolioRebalanceExitPlan({
      positions,
      targetChainUsd,
      externalChainUsd,
      toleranceUsd: rebalancePolicy.toleranceUsd ?? 5,
    }),
    scoredTargets: {
      observedAt: scoredTargets.observedAt,
      totalCapitalUsd: scoredTargets.totalCapitalUsd,
      activeCapitalUsd,
      walletInventoryUsd: sumObjectValues(externalChainUsd),
      walletInventoryObservedAt: wholeWalletInventory?.observedAt || null,
      summary: scoredTargets.summary,
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function exitRecord({ evaluation, execution }) {
  return {
    schemaVersion: 1,
    event: "position_exit_confirmed",
    status: "closed",
    observedAt: execution.observedAt,
    positionId: evaluation.positionId,
    opportunityId: evaluation.opportunityId,
    triggers: evaluation.triggers,
    txHash: execution.signerResult?.broadcast?.txHash || null,
    redeemProof: execution.redeemProof,
  };
}

function executionErrorPayload(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
  };
}

function isZeroShareExitError(error) {
  return error?.name === "NoPositionShares" || error?.zeroShareProof?.status === "reconciled_zero_share_balance";
}

function zeroShareExitRecord({ evaluation, error }) {
  return {
    schemaVersion: 1,
    event: "position_exit_reconciled_zero_balance",
    status: "closed",
    observedAt: new Date().toISOString(),
    positionId: evaluation.positionId,
    opportunityId: evaluation.opportunityId,
    triggers: evaluation.triggers,
    txHash: null,
    redeemProof: error?.zeroShareProof || {
      status: "reconciled_zero_share_balance",
      proofSource: "erc20_balance_zero",
    },
  };
}

async function executePortfolioExitPosition({ position, senderAddress, socketPath, timeoutMs }) {
  if (position.bindingKind === "aave_v3_pool_supply_withdraw") {
    return executeAavePortfolioExit({
      position,
      senderAddress,
      socketPath,
      timeoutMs,
      confirmationTimeoutMs: confirmationTimeoutMsForExit(timeoutMs),
    });
  }
  return executeErc4626PortfolioExit({
    position,
    senderAddress,
    socketPath,
    timeoutMs,
    confirmationTimeoutMs: confirmationTimeoutMsForExit(timeoutMs),
  });
}

export async function executeReadyMerklPortfolioExits({
  exitReady = [],
  positions = [],
  queue = {},
  senderAddress,
  socketPath,
  timeoutMs,
  executePositionImpl = executePortfolioExitPosition,
  appendRecord = async () => {},
} = {}) {
  const executions = [];
  for (const evaluation of exitReady) {
    const position = hydratePositionFromQueue(
      positions.find((item) => item.positionId === evaluation.positionId),
      queue,
    );
    try {
      const execution = await executePositionImpl({
        position,
        senderAddress,
        socketPath,
        timeoutMs,
      });
      const record = execution.settlementStatus === "position_closed" ? exitRecord({ evaluation, execution }) : null;
      if (record) await appendRecord(record);
      executions.push({
        evaluation,
        execution,
        record,
        status: execution.settlementStatus === "position_closed" ? "position_closed" : execution.settlementStatus,
      });
    } catch (error) {
      if (isZeroShareExitError(error)) {
        const record = zeroShareExitRecord({ evaluation, error });
        await appendRecord(record);
        executions.push({
          evaluation,
          execution: {
            schemaVersion: 1,
            observedAt: record.observedAt,
            settlementStatus: "position_reconciled_zero_balance",
            redeemProof: record.redeemProof,
          },
          record,
          status: "position_reconciled_zero_balance",
        });
        continue;
      }
      executions.push({
        evaluation,
        execution: null,
        record: null,
        status: "error",
        error: executionErrorPayload(error),
      });
    }
  }
  return executions;
}

export async function runMerklPortfolioExit({
  execute = false,
  write = false,
  force = false,
  queuePath = join(config.dataDir, "merkl-canary-queue.json"),
  socketPath,
  timeoutMs,
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
    if (write) await writeExitReport(report);
    return report;
  }

  const [queue, positionRecords] = await Promise.all([
    readJson(queuePath),
    readJsonl(config.dataDir, "merkl-portfolio-positions").catch(() => []),
  ]);
  const positions = activeMerklPortfolioPositions(positionRecords);
  const rebalanceExitPlan = await buildRebalanceExitPlanForPositions({
    positions,
    policy: policyInput,
    now: new Date().toISOString(),
    address: preflight.senderAddress,
  });
  const evaluations = positions.map((position) => evaluateMerklPositionExit({
    position,
    queue,
    policy: policyInput,
    force,
    rebalanceExitPlan,
  }));
  const exitReady = evaluations.filter((item) => item.status === "exit_ready");
  const executions = [];
  const store = new JsonlStore(config.dataDir);
  if (execute) {
    executions.push(...await executeReadyMerklPortfolioExits({
      exitReady,
      positions,
      queue,
      senderAddress: preflight.senderAddress,
      socketPath,
      timeoutMs,
      appendRecord: (record) => store.append("merkl-portfolio-positions", record),
    }));
  }
  const closedCount = executions.filter((item) => item.status === "position_closed" || item.status === "position_reconciled_zero_balance").length;
  const executionErrorCount = executions.filter((item) => item.status === "error").length;
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: execute ? "execute" : "preview",
    status: execute
      ? closedCount > 0 && executionErrorCount > 0
        ? "partial_positions_closed"
        : closedCount > 0
          ? "positions_closed"
          : executionErrorCount > 0
            ? "position_exit_errors"
            : exitReady.length > 0
              ? "no_position_closed"
              : "hold"
      : exitReady.length > 0
        ? "exit_ready"
        : "hold",
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      killSwitchPath: preflight.killSwitchPath,
    },
    summary: {
      activePositionCount: positions.length,
      exitReadyCount: exitReady.length,
      holdCount: evaluations.filter((item) => item.status === "hold").length,
      closedCount,
      executionErrorCount,
    },
    rebalanceExitPlan,
    evaluations,
    executions,
  };
  if (write) await writeExitReport(report);
  return report;
}

async function writeExitReport(report) {
  await writeTextIfChanged(join(config.dataDir, "merkl-portfolio-exit-latest.json"), `${safeJsonStringify(report, 2)}\n`);
  await new JsonlStore(config.dataDir).append("merkl-portfolio-exit-runs", JSON.parse(safeJsonStringify(report)));
}
