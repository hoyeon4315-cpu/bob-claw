#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Transaction } from "ethers";
import { config } from "../config/env.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { rpc } from "../evm/json-rpc.mjs";
import { readErc20Balance, readNativeBalance, summarizeRequirement } from "../evm/account-state.mjs";
import { sendRawTransaction, classifySendTransactionError } from "../evm/transaction-submit.mjs";
import { sendSignerCommand, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { sendTelegramMessage, formatPreliveForkExecutionAlert } from "../notify/telegram.mjs";
import { buildExecutionSubmissionEvent, canStartExecution } from "../execution/journal.mjs";
import { readExecutionGuards } from "../execution/guards.mjs";
import { buildForkExecutionJob } from "../prelive/fork-execution.mjs";

const MAX_FORK_BLOCK_LAG = 120;
const MAX_FORK_TIME_LAG_SECONDS = 900;

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  const nonceRaw = options.nonce || null;
  return {
    json: flags.has("--json"),
    planId: options["plan-id"] || null,
    signedTx: options["signed-tx"] || null,
    signedTxFile: options["signed-tx-file"] || null,
    useSignerDaemon: flags.has("--use-signer-daemon"),
    socketPath: options["socket-path"] || signerSocketPath(),
    signerTimeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    rpcUrl: options["rpc-url"] || null,
    rpcUrls: options["rpc-urls"] ? options["rpc-urls"].split(",").map((item) => item.trim()).filter(Boolean) : [],
    gasLimit: options["gas-limit"] || null,
    nonce: nonceRaw ? Number(BigInt(nonceRaw)) : null,
  };
}

function uniqueExplicitRpcUrls(args) {
  return [...new Set([...(args?.rpcUrls || []), args?.rpcUrl].filter(Boolean))];
}

function rpcOptionsFromArgs(args) {
  return {
    ...(args?.rpcUrl ? { rpcUrl: args.rpcUrl } : {}),
    ...(args?.rpcUrls?.length ? { rpcUrls: args.rpcUrls } : {}),
  };
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

function toBigIntOrZero(value) {
  if (value === null || value === undefined || value === "") return 0n;
  return BigInt(value);
}

async function readForkPendingNonce(plan, args) {
  const fromAddress = plan?.address || plan?.transaction?.from || null;
  if (!fromAddress) return null;
  const rpcUrls = uniqueExplicitRpcUrls(args);
  if (rpcUrls.length === 0) return null;
  const attempts = [];
  for (const rpcUrl of rpcUrls) {
    try {
      const result = await rpc(rpcUrl, "eth_getTransactionCount", [fromAddress, "pending"]);
      return Number(BigInt(result));
    } catch (error) {
      attempts.push({ rpcUrl, message: error.message, code: error.rpcError?.code ?? null });
    }
  }
  const error = new Error(`Failed to read pending nonce for fork signer intent: ${plan?.planId || "unknown_plan"}`);
  error.name = "ForkPendingNonceRpcError";
  error.attempts = attempts;
  throw error;
}

async function readForkLatestBlock(args) {
  const rpcUrls = uniqueExplicitRpcUrls(args);
  if (rpcUrls.length === 0) return null;
  const attempts = [];
  for (const rpcUrl of rpcUrls) {
    try {
      const block = await rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]);
      if (!block) continue;
      return {
        rpcUrl,
        blockNumber: Number(BigInt(block.number || "0x0")),
        blockTimestamp: Number(BigInt(block.timestamp || "0x0")),
      };
    } catch (error) {
      attempts.push({ rpcUrl, message: error.message, code: error.rpcError?.code ?? null });
    }
  }
  const error = new Error("Failed to read latest fork block");
  error.name = "ForkLatestBlockRpcError";
  error.attempts = attempts;
  throw error;
}

async function readLiveLatestBlock(chain) {
  const chainConfig = getEvmChainConfig(chain);
  const rpcUrls = [...new Set([...(chainConfig?.rpcUrls || []), chainConfig?.rpcUrl].filter(Boolean))];
  if (rpcUrls.length === 0) return null;
  const attempts = [];
  for (const rpcUrl of rpcUrls) {
    try {
      const block = await rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]);
      if (!block) continue;
      return {
        rpcUrl,
        blockNumber: Number(BigInt(block.number || "0x0")),
        blockTimestamp: Number(BigInt(block.timestamp || "0x0")),
      };
    } catch (error) {
      attempts.push({ rpcUrl, message: error.message, code: error.rpcError?.code ?? null });
    }
  }
  const error = new Error(`Failed to read live latest block for chain: ${chain}`);
  error.name = "LiveLatestBlockRpcError";
  error.attempts = attempts;
  throw error;
}

function buildForkFreshness(latestBlock, liveLatestBlock) {
  if (!latestBlock || !liveLatestBlock) return null;
  const blockLag = Math.max(0, (liveLatestBlock.blockNumber || 0) - (latestBlock.blockNumber || 0));
  const timeLagSeconds = Math.max(0, (liveLatestBlock.blockTimestamp || 0) - (latestBlock.blockTimestamp || 0));
  const stale = blockLag > MAX_FORK_BLOCK_LAG || timeLagSeconds > MAX_FORK_TIME_LAG_SECONDS;
  return {
    stale,
    blockLag,
    timeLagSeconds,
    maxBlockLag: MAX_FORK_BLOCK_LAG,
    maxTimeLagSeconds: MAX_FORK_TIME_LAG_SECONDS,
    liveLatestBlock,
  };
}

export async function buildForkSubmissionPreflight(
  plan,
  args,
  {
    readPendingNonceImpl = readForkPendingNonce,
    readLatestBlockImpl = readForkLatestBlock,
    readLiveLatestBlockImpl = readLiveLatestBlock,
    readErc20BalanceImpl = readErc20Balance,
    readNativeBalanceImpl = readNativeBalance,
    decodeSignedTxImpl = (signedTx) => Transaction.from(signedTx),
  } = {},
) {
  const parsedRoute = parseRouteKey(plan?.routeKey);
  const fromAddress = plan?.address || plan?.transaction?.from || null;
  const sourceChain = plan?.srcChain || parsedRoute?.srcChain || null;
  const sourceToken = plan?.routeContext?.srcAsset?.token || parsedRoute?.srcToken || null;
  const sourceAmountUnits = plan?.amount ? BigInt(plan.amount) : null;
  const latestBlock = await readLatestBlockImpl(args);
  const liveLatestBlock = sourceChain ? await readLiveLatestBlockImpl(sourceChain).catch(() => null) : null;
  const freshness = buildForkFreshness(latestBlock, liveLatestBlock);
  if (freshness?.stale) {
    const error = new Error(
      `Fork snapshot is stale: blockLag=${freshness.blockLag} timeLagSeconds=${freshness.timeLagSeconds}`,
    );
    error.name = "StaleForkSnapshotError";
    error.details = freshness;
    throw error;
  }
  const pendingNonce = Number.isInteger(args?.nonce) ? args.nonce : await readPendingNonceImpl(plan, args);
  const rpcOptions = rpcOptionsFromArgs(args);

  const sourceBalance = sourceChain && sourceToken && fromAddress
    ? await readErc20BalanceImpl(sourceChain, sourceToken, fromAddress, rpcOptions)
    : null;
  if (sourceBalance && sourceAmountUnits !== null && sourceBalance.balance < sourceAmountUnits) {
    const shortfall = summarizeRequirement(sourceBalance.balance, sourceAmountUnits);
    const error = new Error(
      `Fork source token balance is insufficient: actual=${shortfall.actual} required=${shortfall.required}`,
    );
    error.name = "ForkSourceBalanceError";
    error.details = {
      chain: sourceChain,
      token: sourceToken,
      address: fromAddress,
      ...shortfall,
    };
    throw error;
  }

  const nativeBalance = sourceChain && fromAddress
    ? await readNativeBalanceImpl(sourceChain, fromAddress, rpcOptions)
    : null;

  const preflight = {
    observedAt: new Date().toISOString(),
    chain: sourceChain,
    address: fromAddress,
    pendingNonce,
    latestBlock,
    freshness,
    sourceBalance: sourceBalance
      ? {
          rpcUrl: sourceBalance.rpcUrl,
          token: sourceToken,
          actual: sourceBalance.balance.toString(),
          required: sourceAmountUnits?.toString() || null,
          ok: sourceAmountUnits === null ? true : sourceBalance.balance >= sourceAmountUnits,
        }
      : null,
    nativeBalance: nativeBalance
      ? {
          rpcUrl: nativeBalance.rpcUrl,
          balanceWei: nativeBalance.balanceWei.toString(),
        }
      : null,
    funding: null,
  };

  if (!nativeBalance || !args?.signedTx) return preflight;

  const signedTransaction = decodeSignedTxImpl(args.signedTx);
  const valueWei = toBigIntOrZero(signedTransaction?.value);
  const gasLimit = toBigIntOrZero(signedTransaction?.gasLimit);
  const gasPriceCapWei = toBigIntOrZero(signedTransaction?.maxFeePerGas ?? signedTransaction?.gasPrice);
  const requiredWei = valueWei + (gasLimit * gasPriceCapWei);
  const fundingSummary = summarizeRequirement(nativeBalance.balanceWei, requiredWei);
  preflight.funding = {
    requiredWei: fundingSummary.required,
    actualWei: fundingSummary.actual,
    ok: fundingSummary.ok,
    shortfallWei: fundingSummary.shortfall,
    valueWei: valueWei.toString(),
    gasLimit: gasLimit.toString(),
    gasPriceCapWei: gasPriceCapWei.toString(),
  };
  if (!fundingSummary.ok) {
    const error = new Error(
      `Fork native balance is insufficient for signed transaction: actual=${fundingSummary.actual} required=${fundingSummary.required}`,
    );
    error.name = "ForkNativeBalanceError";
    error.details = {
      chain: sourceChain,
      address: fromAddress,
      ...preflight.funding,
    };
    throw error;
  }

  return preflight;
}

export function buildForkSignerIntent(plan, { observedAt = new Date().toISOString(), gasLimit = null, nonce = null } = {}) {
  return {
    strategyId: "prelive_fork_execution",
    chain: plan.srcChain,
    family: "evm",
    mode: "fork",
    intentType: "prelive_fork_execution",
    amountUsd: Number(plan?.routeContext?.inputUsd ?? 0),
    observedAt,
    executionReason: "prelive_fork_submission",
    tx: {
      to: plan?.transaction?.to || null,
      data: plan?.transaction?.data || "0x",
      value: String(plan?.transaction?.valueWei || "0"),
      ...(gasLimit ? { gasLimit: String(gasLimit) } : {}),
      ...(Number.isInteger(nonce) ? { nonce } : {}),
    },
    metadata: {
      skipAutoIngest: true,
      preliveForkPlanId: plan?.planId || null,
      preliveForkRouteKey: plan?.routeKey || null,
      preliveForkAmount: plan?.amount || null,
      targetEnvironment: plan?.targetEnvironment || null,
    },
  };
}

async function loadSignedTx(args, plan, { readSignedTxFile = readFile, sendCommand = sendSignerCommand } = {}) {
  if (args.signedTx) {
    return {
      signedTx: args.signedTx,
      signerMode: plan?.signer?.mode || "external_signed_raw_tx",
    };
  }
  if (args.signedTxFile) {
    return {
      signedTx: (await readSignedTxFile(args.signedTxFile, "utf8")).trim(),
      signerMode: plan?.signer?.mode || "external_signed_raw_tx",
    };
  }
  if (args.useSignerDaemon) {
    const nonce = Number.isInteger(args.nonce) ? args.nonce : await readForkPendingNonce(plan, args);
    const signerResult = await sendCommand({
      socketPath: args.socketPath,
      timeoutMs: args.signerTimeoutMs,
      message: {
        command: "sign_only",
        intent: buildForkSignerIntent(plan, { gasLimit: args.gasLimit, nonce }),
      },
    });
    if (signerResult?.status !== "ok" || !signerResult?.signed?.signedTx) {
      throw new Error(signerResult?.error?.message || "Signer daemon did not return a signed transaction");
    }
    return {
      signedTx: signerResult.signed.signedTx,
      signerMode: "signer_daemon_sign_only",
    };
  }
  throw new Error("Either --signed-tx, --signed-tx-file, or --use-signer-daemon is required");
}

async function notifyPreliveForkTransition(payload) {
  try {
    return await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId,
      text: formatPreliveForkExecutionAlert(payload),
    });
  } catch (error) {
    console.error(`telegram notify failed: ${error.message}`);
    return { sent: false, skipped: false, reason: "telegram_send_failed" };
  }
}

function classifyForkSubmissionFailure(error) {
  if (error?.name === "StaleForkSnapshotError") return "stale_fork_snapshot";
  if (error?.name === "ForkSourceBalanceError") return "insufficient_source_balance";
  if (error?.name === "ForkNativeBalanceError") return "insufficient_native_balance";
  if (error?.name === "ForkPendingNonceRpcError" || error?.name === "ForkLatestBlockRpcError") return "fork_state_unavailable";
  return classifySendTransactionError(error);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.planId) throw new Error("--plan-id is required");
  const forkPlan = await readJsonIfExists(join(config.dataDir, "prelive-fork-plan.json"));
  const plan = (forkPlan?.plans || []).find((item) => item.planId === args.planId);
  if (!plan) throw new Error(`Plan not found: ${args.planId}`);
  if (plan.status !== "planned") throw new Error(`Plan is not submit-ready: ${plan.status}`);

  const [events] = await Promise.all([
    readJsonl(config.dataDir, "execution-journal"),
  ]);
  const gate = canStartExecution(events, plan.planId);
  if (!gate.ok) {
    throw new Error(`Execution blocked: ${gate.reason}`);
  }

  const guards = await readExecutionGuards({
    emergencyStopPath: config.emergencyStopFlagPath,
    liveModePath: config.liveModeFlagPath,
    mode: "fork",
  });
  if (guards.blocked) {
    throw new Error(`Execution guard blocked: ${guards.reasons.join(",")}`);
  }

  const store = new JsonlStore(config.dataDir);
  try {
    const preflightBeforeSign = await buildForkSubmissionPreflight(plan, args);
    const signerArgs = Number.isInteger(args.nonce) || !Number.isInteger(preflightBeforeSign.pendingNonce)
      ? args
      : { ...args, nonce: preflightBeforeSign.pendingNonce };
    const { signedTx, signerMode } = await loadSignedTx(signerArgs, plan);
    const preflight = await buildForkSubmissionPreflight(plan, { ...args, signedTx });
    const submitted = await sendRawTransaction(plan.srcChain, signedTx, {
      ...(args.rpcUrl ? { rpcUrl: args.rpcUrl } : {}),
      ...(args.rpcUrls.length ? { rpcUrls: args.rpcUrls } : {}),
    });
    const submissionRecord = {
      schemaVersion: 1,
      observedAt: submitted.observedAt,
      planId: plan.planId,
      routeKey: plan.routeKey,
      routeLabel: plan.routeLabel,
      amount: plan.amount,
      chain: plan.srcChain,
      targetEnvironment: plan.targetEnvironment,
      submissionStatus: "submitted",
      txHash: submitted.txHash,
      rpcUrl: submitted.rpcUrl,
      signedTxBytes: submitted.signedTxBytes,
      signerMode,
      forkPreflight: preflight,
    };
    await store.append("prelive-fork-submissions", submissionRecord);
    const journalEvent = buildExecutionSubmissionEvent({
      job: buildForkExecutionJob(plan),
      txHash: submitted.txHash,
      actor: "prelive_fork_submitter",
    });
    await store.append("execution-journal", journalEvent);
    const telegramResult = await notifyPreliveForkTransition({
      phase: "fork_submitted",
      plan,
      submission: submissionRecord,
    });

    if (args.json) {
      console.log(JSON.stringify({ submission: submissionRecord, executionEvent: journalEvent, telegram: telegramResult }, null, 2));
      return;
    }

    console.log(`planId=${plan.planId}`);
    console.log(`txHash=${submitted.txHash}`);
    console.log(`submissionStatus=submitted`);
    console.log(`chain=${plan.srcChain}`);
    console.log(`telegram=${telegramResult.sent ? "sent" : `skipped:${telegramResult.reason}`}`);
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      planId: plan.planId,
      routeKey: plan.routeKey,
      routeLabel: plan.routeLabel,
      amount: plan.amount,
      chain: plan.srcChain,
      targetEnvironment: plan.targetEnvironment,
      submissionStatus: "failed",
      reason: classifyForkSubmissionFailure(error),
      error: {
        name: error.name,
        message: error.message,
        attempts: error.attempts || null,
        details: error.details || null,
      },
      signerMode: error.signerMode || null,
    };
    await store.append("prelive-fork-submissions", failure);
    await notifyPreliveForkTransition({
      phase: "fork_submission_failed",
      plan,
      submission: failure,
    });
    throw error;
  }
}

const isDirectRun = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
