#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { buildExecutionFundingOutcomeEvent, buildExecutionFundingSnapshotEvent } from "../execution/journal.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildAcrossBridgePlan, executeAcrossBridgePlan } from "../executor/helpers/across-bridge.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";

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
    write: flags.has("--write"),
    execute: flags.has("--execute"),
    srcChain: options["src-chain"] || null,
    dstChain: options["dst-chain"] || null,
    ticker: options.ticker || "usdc",
    amount: options.amount || null,
    sender: options.sender || null,
    recipient: options.recipient || null,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    awaitDestinationSettlement: !flags.has("--no-await-destination-settlement"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
    destinationSettlementTimeoutMs: options["destination-timeout-ms"] ? Number(options["destination-timeout-ms"]) : null,
    destinationPollIntervalMs: options["destination-poll-interval-ms"] ? Number(options["destination-poll-interval-ms"]) : 10_000,
  };
}

async function resolveAddresses(args) {
  if (args.sender && args.recipient) {
    return {
      sender: args.sender,
      recipient: args.recipient,
    };
  }
  const health = await readSignerHealth({
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  });
  const evmAddress = args.sender || args.recipient || health?.addresses?.base || null;
  if (!evmAddress) {
    throw new Error("EVM sender/recipient is required; pass --sender/--recipient or start the signer daemon with an EVM key configured");
  }
  return {
    sender: args.sender || evmAddress,
    recipient: args.recipient || evmAddress,
  };
}

function buildJournalJob(plan) {
  const ticker = plan.request?.ticker || plan.dstAsset?.ticker || "asset";
  const amount = plan.request?.amount || plan.amount || "0";
  return {
    jobId: `funding:across:${plan.srcChain}:${plan.dstChain}:${ticker}:${amount}:${plan.recipient}`,
    chain: plan.srcChain,
    type: "bridge_funding",
    asset: plan.dstAsset?.ticker || ticker,
    token: plan.dstToken,
    executionMethod: "across_bridge",
    resourceKey: `${plan.srcChain}:${plan.dstChain}:${ticker}`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.srcChain) throw new Error("--src-chain is required");
  if (!args.dstChain) throw new Error("--dst-chain is required");
  if (!args.amount) throw new Error("--amount is required");

  const { sender, recipient } = await resolveAddresses(args);
  const plan = await buildAcrossBridgePlan({
    srcChain: args.srcChain,
    dstChain: args.dstChain,
    ticker: args.ticker,
    amount: args.amount,
    senderAddress: sender,
    recipient,
  });
  const job = buildJournalJob(plan);
  const fundingSnapshotEvent = buildExecutionFundingSnapshotEvent({
    plan,
    job,
    actor: args.execute ? "across_bridge_execute" : "across_bridge_preview",
    routeKey: `${args.srcChain}->${args.dstChain}:${args.ticker}`,
  });

  let execution = null;
  let executionError = null;
  if (args.execute) {
    try {
      execution = await executeAcrossBridgePlan({
        plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        confirmations: args.confirmations,
        confirmationTimeoutMs: args.confirmationTimeoutMs,
        awaitDestinationSettlement: args.awaitDestinationSettlement,
        destinationSettlementTimeoutMs: args.destinationSettlementTimeoutMs || undefined,
        destinationPollIntervalMs: args.destinationPollIntervalMs,
      });
    } catch (error) {
      execution = error.partialExecution || null;
      executionError = {
        name: error.name || "ExecutionFailed",
        message: error.message,
      };
      if (execution && !execution.error) {
        execution.error = executionError;
      }
    }
  }
  const fundingOutcomeEvent = execution
    ? buildExecutionFundingOutcomeEvent({
        plan,
        execution,
        job,
        actor: "across_bridge_execute",
        routeKey: `${args.srcChain}->${args.dstChain}:${args.ticker}`,
      })
    : null;

  const store = new JsonlStore(config.dataDir);
  if (args.write || args.execute) {
    await writeTextIfChanged(
      join(config.dataDir, "across-bridge-plan-latest.json"),
      `${safeJsonStringify({ plan, execution, error: executionError }, 2)}\n`,
    );
    await store.append("execution-journal", fundingSnapshotEvent);
  }
  if (args.execute && execution) {
    await store.append("across-bridge-executions", execution);
  }
  if (args.execute && fundingOutcomeEvent) {
    await store.append("execution-journal", fundingOutcomeEvent);
  }

  if (args.json) {
    console.log(safeJsonStringify({ plan, execution, error: executionError }, 2));
    if (executionError) process.exitCode = 1;
    return;
  }

  console.log(`strategyId=${plan.strategyId}`);
  console.log(`route=${plan.srcChain}->${plan.dstChain}`);
  console.log(`asset=${plan.srcAsset.ticker}->${plan.dstAsset.ticker}`);
  console.log(`amount=${plan.request?.amount || args.amount}`);
  console.log(`amountUsd=${plan.amountUsd ?? "n/a"}`);
  console.log(`sender=${plan.senderAddress}`);
  console.log(`recipient=${plan.recipient}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  console.log(`allowUnmatchedDecimals=${plan.request?.allowUnmatchedDecimals === true}`);
  console.log(`steps=${plan.steps?.map((step) => step.id).join(",") || "none"}`);
  if (plan.approvalGasPreflight) {
    console.log(`approvalGasLimit=${plan.approvalGasPreflight.gasLimit}`);
  }
  if (plan.gasPreflight) {
    console.log(`depositGasLimit=${plan.gasPreflight.gasLimit}`);
    console.log(`depositGasFallbackReason=${plan.gasPreflight.fallbackReason || "none"}`);
  }
  if (plan.preflightError?.message) {
    console.log(`preflightError=${plan.preflightError.message}`);
  }
  if (plan.acrossError?.message) {
    console.log(`acrossError=${plan.acrossError.message}`);
  }
  if (execution?.stepResults?.length) {
    console.log(`executedSteps=${execution.stepResults.map((step) => step.id).join(",")}`);
    console.log(`txHashes=${execution.stepResults.map((step) => step.signerResult?.broadcast?.txHash).filter(Boolean).join(",") || "n/a"}`);
  }
  if (execution?.settlementStatus) {
    console.log(`settlementStatus=${execution.settlementStatus}`);
  }
  if (execution?.destinationProof) {
    console.log(`destinationProofSource=${execution.destinationProof.proofSource}`);
    console.log(`destinationObservedDelta=${execution.destinationProof.observedDelta}`);
    console.log(`destinationRequiredDelta=${execution.destinationProof.requiredDelta}`);
  }
  if (executionError) {
    console.log(`executionError=${executionError.name}:${executionError.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
