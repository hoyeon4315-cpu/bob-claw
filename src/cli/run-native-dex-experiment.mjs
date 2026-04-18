#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildExecutionFundingOutcomeEvent, buildExecutionFundingSnapshotEvent } from "../execution/journal.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { buildNativeDexExperimentPlan, executeNativeDexExperimentPlan } from "../executor/helpers/native-dex-experiment.mjs";

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
    chain: options.chain || null,
    amount: options.amount || null,
    outputToken: options["output-token"] || null,
    sender: options.sender || null,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    awaitDestinationSettlement: !flags.has("--no-await-destination-settlement"),
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
  if (!args.chain) throw new Error("--chain is required");
  if (!args.amount) throw new Error("--amount is required");
  const sender = await resolveSender(args);
  if (!sender) {
    throw new Error("EVM sender is required; pass --sender or start the signer daemon with an EVM key configured");
  }
  const plan = await buildNativeDexExperimentPlan({
    chain: args.chain,
    amount: args.amount,
    senderAddress: sender,
    outputToken: args.outputToken,
  });
  const fundingSnapshotEvent = buildExecutionFundingSnapshotEvent({
    plan,
    actor: args.execute ? "native_dex_experiment_execute" : "native_dex_experiment_preview",
  });
  let execution = null;
  let executionError = null;
  if (args.execute) {
    try {
      execution = await executeNativeDexExperimentPlan({
        plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        awaitDestinationSettlement: args.awaitDestinationSettlement,
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
  const fundingOutcomeEvent = execution
    ? buildExecutionFundingOutcomeEvent({
        plan,
        execution,
        actor: "native_dex_experiment_execute",
      })
    : null;

  const store = new JsonlStore(config.dataDir);
  if (args.write || args.execute) {
    await writeTextIfChanged(join(config.dataDir, "native-dex-experiment-plan-latest.json"), `${safeJsonStringify({
      plan,
      execution,
      error: executionError,
    }, 2)}\n`);
    await store.append("execution-journal", fundingSnapshotEvent);
  }
  if (args.execute && execution) {
    await store.append("native-dex-experiment-executions", execution);
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
  console.log(`chain=${plan.chain}`);
  console.log(`sender=${plan.senderAddress}`);
  console.log(`outputToken=${plan.outputAsset.ticker}`);
  console.log(`amount=${plan.amount}`);
  console.log(`amountUsd=${plan.amountUsd ?? "n/a"}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  console.log(`steps=${plan.steps?.map((step) => step.id).join(",") || "none"}`);
  if (execution?.stepResults?.length) {
    console.log(`executedSteps=${execution.stepResults.map((step) => step.id).join(",")}`);
    console.log(`lastTxHash=${execution.stepResults.at(-1)?.signerResult?.broadcast?.txHash || "n/a"}`);
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
