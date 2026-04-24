import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Interface } from "ethers";
import { tokenAsset } from "../assets/tokens.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { config } from "../config/env.mjs";
import { assertStrategyCaps } from "../config/strategy-caps.mjs";
import { merklPortfolioPolicy } from "../config/merkl-portfolio.mjs";
import { estimateGas } from "../gas/rpc-gas.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import { activeMerklPortfolioPositions, merklPortfolioScore } from "./merkl-portfolio-allocator.mjs";
import { sendSignerCommand } from "./signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./helpers/gateway-btc-consolidation.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./helpers/settlement-proof.mjs";

const ERC4626_INTERFACE = new Interface([
  "function redeem(uint256 shares,address receiver,address owner) returns (uint256 assets)",
]);

const DEFAULT_REDEEM_GAS_UNITS = 260_000;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minimumRedeemDelta(amount, minimumReturnBps = 9_500) {
  const bps = BigInt(Math.max(1, Math.min(10_000, Number(minimumReturnBps) || 9_500)));
  return ((BigInt(amount || 0) * bps) / 10_000n).toString();
}

function gasLimitWithFallback(gas, fallbackUnits, gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS) {
  const units = Number(gas?.gasUnits);
  const baseUnits = Number.isFinite(units) && units > 0 ? Math.ceil(units) : fallbackUnits;
  return String(applyGasBuffer(baseUnits, gasBufferBps));
}

function queueItemByOpportunity(queue = {}, opportunityId = null) {
  return (queue.queue || []).find((item) => String(item.opportunityId) === String(opportunityId)) || null;
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

function buildExitIntent({ position, senderAddress, shareAmount, now }) {
  const strategyCaps = assertStrategyCaps(position.strategyId);
  const vaultAddress = position.vaultAddress || position.shareTokenAddress;
  return {
    strategyId: position.strategyId,
    chain: position.chain,
    family: "evm",
    intentType: "erc4626_redeem",
    amountUsd: 0,
    mode: "live",
    observedAt: now,
    executionReason: "strategy_execution",
    tx: {
      to: vaultAddress,
      data: ERC4626_INTERFACE.encodeFunctionData("redeem", [shareAmount, senderAddress, senderAddress]),
      value: "0",
      gasLimit: String(applyGasBuffer(DEFAULT_REDEEM_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS)),
    },
    strategyConfig: {
      intentTtlMs: strategyCaps.intentTtlMs,
    },
    metadata: {
      skipAutoIngest: true,
      capCheckAmountUsd: 0,
      opportunityId: position.opportunityId,
      protocol: position.protocolId,
      vaultAddress,
      assetAddress: position.assetAddress,
      shareTokenAddress: position.shareTokenAddress,
      shareDelta: shareAmount,
      positionId: position.positionId,
    },
  };
}

export async function executeErc4626PortfolioExit({
  position,
  senderAddress,
  sendCommand = sendSignerCommand,
  readErc20BalanceImpl,
  readNativeBalanceImpl,
  estimateGasImpl = estimateGas,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  settlementTimeoutMs = defaultSettlementTimeoutMs(0, { minimumMs: 60_000, extraSeconds: 0 }),
  pollIntervalMs = 5_000,
  sleepImpl = sleep,
} = {}) {
  if (!position) throw new Error("position is required");
  if (position.bindingKind !== "erc4626_vault_supply_withdraw" && position.bindingKind !== "euler_evault_deposit_withdraw") {
    throw new Error(`Unsupported position binding for exit: ${position.bindingKind}`);
  }
  if (!getEvmChainConfig(position.chain)) throw new Error(`Unsupported EVM chain: ${position.chain}`);
  const now = new Date().toISOString();
  const asset = tokenAsset(position.chain, position.assetAddress, {
    ticker: "USDC",
    family: "stablecoin",
    decimals: 6,
    priceKey: "usd_stable",
  });
  const shareAsset = tokenAsset(position.chain, position.shareTokenAddress, {
    ticker: "VaultShare",
    family: "protocol_share",
    decimals: 18,
    priceKey: null,
  });
  const assetBalanceBefore = await readEvmAssetBalance({
    asset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const shareBalanceBefore = await readEvmAssetBalance({
    asset: shareAsset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const currentShares = BigInt(shareBalanceBefore.balance || 0);
  const recordedShares = BigInt(position.shareDelta || 0);
  const shareAmount = (recordedShares > 0n && recordedShares < currentShares ? recordedShares : currentShares).toString();
  if (BigInt(shareAmount) <= 0n) throw new Error("No shares available to redeem");

  const intent = buildExitIntent({ position, senderAddress, shareAmount, now });
  try {
    const gas = await estimateGasImpl(
      position.chain,
      {
        from: senderAddress,
        to: position.vaultAddress || position.shareTokenAddress,
        data: intent.tx.data,
        valueWei: "0",
      },
      getEvmChainConfig(position.chain),
    );
    intent.tx.gasLimit = gasLimitWithFallback(gas, DEFAULT_REDEEM_GAS_UNITS);
  } catch {
    intent.tx.gasLimit = gasLimitWithFallback(null, DEFAULT_REDEEM_GAS_UNITS);
  }

  const signerResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: {
      command: "sign_and_broadcast",
      intent,
      awaitConfirmation,
      confirmations,
      timeoutMs: confirmationTimeoutMs,
    },
  });
  if (signerResult?.status !== "ok" || !signerResult?.broadcast?.txHash) {
    const error = new Error(signerResult?.error?.message || "Signer did not complete erc4626 portfolio exit");
    error.name = signerResult?.error?.name || "SignerExecutionFailed";
    throw error;
  }

  const redeemProof = await waitForEvmAssetDelta({
    asset,
    owner: senderAddress,
    initialBalance: assetBalanceBefore,
    requiredDelta: minimumRedeemDelta(position.amount),
    readErc20BalanceImpl,
    readNativeBalanceImpl,
    timeoutMs: settlementTimeoutMs,
    pollIntervalMs,
    sleepImpl,
  });
  const shareBalanceAfter = await readEvmAssetBalance({
    asset: shareAsset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: redeemProof.status === "delivered" ? "position_closed" : "redeem_delta_timeout",
    position,
    signerResult,
    assetBalanceBefore,
    shareBalanceBefore,
    shareBalanceAfter,
    redeemProof,
    destinationProof: redeemProof.status === "delivered"
      ? {
          status: "delivered",
          proofSource: redeemProof.proofSource,
          observedDelta: redeemProof.observedDelta,
          requiredDelta: redeemProof.requiredDelta,
        }
      : null,
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
      const position = positions.find((item) => item.positionId === evaluation.positionId);
      const execution = await executeErc4626PortfolioExit({
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
