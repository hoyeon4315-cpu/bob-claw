#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { sendRawTransaction, classifySendTransactionError } from "../evm/transaction-submit.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { sendTelegramMessage, formatPreliveForkExecutionAlert } from "../notify/telegram.mjs";
import { buildExecutionSubmissionEvent, canStartExecution } from "../execution/journal.mjs";
import { readExecutionGuards } from "../execution/guards.mjs";
import { buildForkExecutionJob } from "../prelive/fork-execution.mjs";

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
    signedTx: options["signed-tx"] || null,
    signedTxFile: options["signed-tx-file"] || null,
    rpcUrl: options["rpc-url"] || null,
    rpcUrls: options["rpc-urls"] ? options["rpc-urls"].split(",").map((item) => item.trim()).filter(Boolean) : [],
  };
}

async function loadSignedTx(args) {
  if (args.signedTx) return args.signedTx;
  if (args.signedTxFile) {
    return (await readFile(args.signedTxFile, "utf8")).trim();
  }
  throw new Error("Either --signed-tx or --signed-tx-file is required");
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
  const signedTx = await loadSignedTx(args);
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
      signerMode: plan.signer?.mode || "external_signed_raw_tx",
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
      reason: classifySendTransactionError(error),
      error: {
        name: error.name,
        message: error.message,
        attempts: error.attempts || null,
      },
      signerMode: plan.signer?.mode || "external_signed_raw_tx",
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
