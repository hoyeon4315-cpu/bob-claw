#!/usr/bin/env node

import { join } from "node:path";
import process from "node:process";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import {
  buildWrappedBtcLoopDepositHandoffPlan,
  executeWrappedBtcLoopDepositHandoffPlan,
} from "../executor/helpers/wrapped-btc-loop-handoff.mjs";

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
    amountSats: options["amount-sats"] ? Number(options["amount-sats"]) : null,
    sender: options.sender || null,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
    destinationSettlementTimeoutMs: options["destination-timeout-ms"] ? Number(options["destination-timeout-ms"]) : null,
    destinationPollIntervalMs: options["destination-poll-interval-ms"] ? Number(options["destination-poll-interval-ms"]) : 5_000,
  };
}

async function resolveSender(args) {
  if (args.sender) return args.sender;
  const health = await readSignerHealth({
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  });
  return health?.addresses?.base || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(args.amountSats) || args.amountSats <= 0) {
    throw new Error("--amount-sats is required and must be a positive integer");
  }
  const senderAddress = await resolveSender(args);
  if (!senderAddress) {
    throw new Error("EVM sender is required; pass --sender or start the signer daemon with an EVM key configured");
  }

  const plan = await buildWrappedBtcLoopDepositHandoffPlan({
    amountSats: args.amountSats,
    senderAddress,
  });

  let execution = null;
  let executionError = null;
  if (args.execute) {
    if (plan.handoffStatus !== "conversion_ready") {
      throw new Error(`Wrapped BTC loop handoff is not ready: ${plan.blockedReason || plan.handoffStatus}`);
    }
    try {
      execution = await executeWrappedBtcLoopDepositHandoffPlan({
        handoffPlan: plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        confirmations: args.confirmations,
        confirmationTimeoutMs: args.confirmationTimeoutMs,
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

  const result = {
    plan,
    execution,
    error: executionError,
  };

  if (args.write || args.execute) {
    const outputPath = join(config.dataDir, "wrapped-btc-loop-handoff-latest.json");
    await writeTextIfChanged(outputPath, `${safeJsonStringify(result, 2)}\n`);
  }

  if (args.json) {
    console.log(safeJsonStringify(result, 2));
    if (executionError) process.exitCode = 1;
    return;
  }

  console.log(`handoffStatus=${plan.handoffStatus}`);
  console.log(`amountSats=${plan.amountSats}`);
  console.log(`sender=${senderAddress}`);
  console.log(`sourceAsset=${plan.sourceAsset}`);
  console.log(`targetAsset=${plan.targetAsset}`);
  console.log(`conversionPlanStatus=${plan.conversionPlan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  console.log(`previewCommand=${plan.commands.previewHandoff}`);
  console.log(`executeCommand=${plan.commands.executeHandoff}`);
  if (execution?.conversionExecution) {
    console.log(`executionStatus=${execution.handoffStatus}`);
    console.log(`settlementStatus=${execution.conversionExecution.settlementStatus}`);
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
