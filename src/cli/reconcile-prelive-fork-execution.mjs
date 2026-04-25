#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readTransactionByHash, readTransactionReceipt } from "../evm/transaction-read.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { buildExecutionReconciliationEvent, buildExecutionSubmissionEvent, latestExecutionEvent } from "../execution/journal.mjs";
import { buildReceiptReconciliation } from "../ledger/receipt-reconciliation.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { formatPreliveForkExecutionAlert, sendTelegramMessage } from "../notify/telegram.mjs";
import { buildPreliveExecutionAudit } from "../prelive/execution-audit.mjs";
import { buildForkExecutionJob, buildForkOutputResolutionCommand, buildForkOutputRequirements } from "../prelive/fork-execution.mjs";

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
  return {
    json: flags.has("--json"),
    planId: options["plan-id"] || null,
    txHash: options["tx-hash"] || null,
    rpcUrl: options["rpc-url"] || null,
    rpcUrls: options["rpc-urls"] ? options["rpc-urls"].split(",").map((item) => item.trim()).filter(Boolean) : [],
    actualOutputUnits: options["actual-output-units"] || null,
    actualOutputUsd: options["actual-output-usd"] ? Number(options["actual-output-usd"]) : null,
    outputChain: options["output-chain"] || null,
    outputToken: options["output-token"] || null,
    outputPriceUsd: options["output-price-usd"] ? Number(options["output-price-usd"]) : null,
  };
}

function latestSubmittedTxHash(submissions = [], planId) {
  return [...submissions]
    .filter((item) => item.planId === planId && item.submissionStatus === "submitted" && item.txHash)
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0]?.txHash || null;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.planId) throw new Error("--plan-id is required");
  const forkPlan = await readJsonIfExists(join(config.dataDir, "prelive-fork-plan.json"));
  const plan = (forkPlan?.plans || []).find((item) => item.planId === args.planId);
  if (!plan) throw new Error(`Plan not found: ${args.planId}`);

  const [submissions, events, prices] = await Promise.all([
    readJsonl(config.dataDir, "prelive-fork-submissions"),
    readJsonl(config.dataDir, "execution-journal"),
    getCoinGeckoPricesUsd().catch(() => emptyPricesUsd()),
  ]);
  const txHash = args.txHash || latestSubmittedTxHash(submissions, plan.planId);
  if (!txHash) throw new Error(`No submitted tx hash found for plan: ${plan.planId}`);
  const parsedRoute = parseRouteKey(plan.routeKey);
  const rpcOptions = {
    ...(args.rpcUrl ? { rpcUrl: args.rpcUrl } : {}),
    ...(args.rpcUrls.length ? { rpcUrls: args.rpcUrls } : {}),
  };
  const [receipt, transaction] = await Promise.all([
    readTransactionReceipt(plan.srcChain, txHash, rpcOptions),
    readTransactionByHash(plan.srcChain, txHash, rpcOptions),
  ]);

  const store = new JsonlStore(config.dataDir);
  const latest = latestExecutionEvent(events, plan.planId);
  const appended = [];
  if (!latest || latest.status !== "submitted" || latest.txHash !== txHash) {
    const submitted = buildExecutionSubmissionEvent({
      job: buildForkExecutionJob(plan),
      txHash,
      actor: "prelive_fork_reconciler",
    });
    await store.append("execution-journal", submitted);
    appended.push(submitted);
  }

  const receiptRecord = {
    ...buildReceiptReconciliation({
      kind: "prelive_fork_execution",
      chain: plan.srcChain,
      txHash,
      routeContext: plan.routeContext || null,
      receipt,
      transaction,
      prices,
      output: {
        actualOutputUnits: args.actualOutputUnits,
        actualOutputUsd: args.actualOutputUsd,
        chain: args.outputChain || plan.routeContext?.dstAsset?.chain || parsedRoute?.dstChain || plan.dstChain || null,
        token: args.outputToken || plan.routeContext?.dstAsset?.token || parsedRoute?.dstToken || null,
        priceUsd: args.outputPriceUsd,
      },
    }),
    planId: plan.planId,
    routeLabel: plan.routeLabel,
    amount: plan.amount,
    targetEnvironment: plan.targetEnvironment,
  };
  await store.append("prelive-fork-receipts", receiptRecord);
  const outputResolution = receiptRecord.reconciliationStatus === "pending_output"
    ? {
        required: true,
        requirements: buildForkOutputRequirements(plan),
        command: buildForkOutputResolutionCommand(plan, txHash),
      }
    : {
        required: false,
        requirements: null,
        command: null,
      };

  const reconciled = buildExecutionReconciliationEvent({
    job: buildForkExecutionJob(plan),
    txHash,
    receiptRecord,
    actor: "prelive_fork_reconciler",
  });
  await store.append("execution-journal", reconciled);
  appended.push(reconciled);
  const audit = buildPreliveExecutionAudit({
    forkExecutionPlans: forkPlan?.plans || [],
    forkExecutionSubmissions: submissions,
    forkExecutionReceipts: await readJsonl(config.dataDir, "prelive-fork-receipts"),
    executionEvents: [...events, ...appended],
  });
  const phase =
    receiptRecord.reconciliationStatus === "reconciled"
      ? "fork_confirmed"
      : receiptRecord.reconciliationStatus === "failed"
        ? "fork_failed"
        : "fork_pending_output";
  const telegramResult = await notifyPreliveForkTransition({
    phase,
    plan,
    receipt: receiptRecord,
    audit,
  });

  if (args.json) {
    console.log(JSON.stringify({ receiptRecord, outputResolution, executionEvents: appended, audit, telegram: telegramResult }, null, 2));
    return;
  }

  console.log(`planId=${plan.planId}`);
  console.log(`txHash=${txHash}`);
  console.log(`reconciliationStatus=${receiptRecord.reconciliationStatus}`);
  console.log(`executionStatus=${reconciled.status}`);
  console.log(`actualKnownCostUsd=${Number.isFinite(receiptRecord.realized.actualKnownCostUsd) ? receiptRecord.realized.actualKnownCostUsd.toFixed(6) : "n/a"}`);
  console.log(`realizedNetPnlUsd=${Number.isFinite(receiptRecord.realized.realizedNetPnlUsd) ? receiptRecord.realized.realizedNetPnlUsd.toFixed(6) : "n/a"}`);
  if (outputResolution.required) {
    console.log(`outputResolution=required`);
    console.log(`outputResolutionCommand=${outputResolution.command}`);
  }
  console.log(`telegram=${telegramResult.sent ? "sent" : `skipped:${telegramResult.reason}`}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
