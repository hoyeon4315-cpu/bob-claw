#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { buildTokenDexExperimentPlan, executeTokenDexExperimentPlan } from "../executor/helpers/token-dex-experiment.mjs";

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
    inputToken: options["input-token"] || null,
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
  if (!args.inputToken) throw new Error("--input-token is required");
  if (!args.outputToken) throw new Error("--output-token is required");
  const sender = await resolveSender(args);
  if (!sender) {
    throw new Error("EVM sender is required; pass --sender or start the signer daemon with an EVM key configured");
  }
  const plan = await buildTokenDexExperimentPlan({
    chain: args.chain,
    amount: args.amount,
    senderAddress: sender,
    inputToken: args.inputToken,
    outputToken: args.outputToken,
  });
  const execution = args.execute
    ? await executeTokenDexExperimentPlan({
        plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        awaitDestinationSettlement: args.awaitDestinationSettlement,
        confirmations: args.confirmations,
        confirmationTimeoutMs: args.confirmationTimeoutMs,
        destinationSettlementTimeoutMs: args.destinationSettlementTimeoutMs || undefined,
        destinationPollIntervalMs: args.destinationPollIntervalMs,
      })
    : null;

  if (args.write || args.execute) {
    await writeTextIfChanged(join(config.dataDir, "token-dex-experiment-plan-latest.json"), `${JSON.stringify({
      plan,
      execution,
    }, null, 2)}\n`);
  }
  if (args.execute) {
    await new JsonlStore(config.dataDir).append("token-dex-experiment-executions", execution);
  }

  if (args.json) {
    console.log(JSON.stringify({ plan, execution }, null, 2));
    return;
  }

  console.log(`strategyId=${plan.strategyId}`);
  console.log(`chain=${plan.chain}`);
  console.log(`sender=${plan.senderAddress}`);
  console.log(`inputToken=${plan.inputAsset.ticker}`);
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
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
