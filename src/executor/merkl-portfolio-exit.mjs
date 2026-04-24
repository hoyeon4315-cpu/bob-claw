import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { merklPortfolioPolicy } from "../config/merkl-portfolio.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import { activeMerklPortfolioPositions, merklPortfolioScore } from "./merkl-portfolio-allocator.mjs";
import {
  executeAavePortfolioExit,
  executeErc4626PortfolioExit,
} from "./helpers/merkl-portfolio-exit-executors.mjs";

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  }
  return {
    positionId: position?.positionId || null,
    opportunityId: position?.opportunityId || null,
    status: triggers.length > 0 && blockers.length === 0 ? "exit_ready" : "hold",
    triggers,
    blockers,
    queueItemFound: Boolean(queueItem),
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

async function executePortfolioExitPosition({ position, senderAddress, socketPath, timeoutMs }) {
  if (position.bindingKind === "aave_v3_pool_supply_withdraw") {
    return executeAavePortfolioExit({
      position,
      senderAddress,
      socketPath,
      timeoutMs,
    });
  }
  return executeErc4626PortfolioExit({
    position,
    senderAddress,
    socketPath,
    timeoutMs,
  });
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
  const evaluations = positions.map((position) => evaluateMerklPositionExit({
    position,
    queue,
    policy: policyInput,
    force,
  }));
  const exitReady = evaluations.filter((item) => item.status === "exit_ready");
  const executions = [];
  const store = new JsonlStore(config.dataDir);
  if (execute) {
    for (const evaluation of exitReady) {
      const position = hydratePositionFromQueue(
        positions.find((item) => item.positionId === evaluation.positionId),
        queue,
      );
      const execution = await executePortfolioExitPosition({
        position,
        senderAddress: preflight.senderAddress,
        socketPath,
        timeoutMs,
      });
      const record = execution.settlementStatus === "position_closed" ? exitRecord({ evaluation, execution }) : null;
      if (record) await store.append("merkl-portfolio-positions", record);
      executions.push({ evaluation, execution, record });
    }
  }
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: execute ? "execute" : "preview",
    status: execute
      ? executions.some((item) => item.execution?.settlementStatus === "position_closed")
        ? "positions_closed"
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
    },
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
