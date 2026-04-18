#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import {
  buildProxySpreadExperimentPlan,
  executeProxySpreadExperimentPlan,
} from "../executor/helpers/proxy-spread-experiment.mjs";

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
    buyChain: options["buy-chain"] || null,
    sellChain: options["sell-chain"] || null,
    amount: options.amount || null,
    buyInputToken: options["buy-input-token"] || "usdc",
    buyToken: options["buy-token"] || null,
    sellToken: options["sell-token"] || null,
    sellOutputToken: options["sell-output-token"] || "usdc",
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

function txHashFor(stage) {
  if (!stage) return null;
  if (Array.isArray(stage?.stepResults)) return stage.stepResults.at(-1)?.signerResult?.broadcast?.txHash || null;
  return stage?.signerResult?.broadcast?.txHash || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.buyChain) throw new Error("--buy-chain is required");
  if (!args.sellChain) throw new Error("--sell-chain is required");
  if (!args.amount) throw new Error("--amount is required");
  if (!args.buyToken) throw new Error("--buy-token is required");

  const { sender, recipient } = await resolveAddresses(args);
  const plan = await buildProxySpreadExperimentPlan({
    buyChain: args.buyChain,
    sellChain: args.sellChain,
    amount: args.amount,
    senderAddress: sender,
    recipient,
    buyInputToken: args.buyInputToken,
    buyToken: args.buyToken,
    sellToken: args.sellToken || args.buyToken,
    sellOutputToken: args.sellOutputToken,
  });

  const execution = args.execute
    ? await executeProxySpreadExperimentPlan({
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
    await writeTextIfChanged(join(config.dataDir, "proxy-spread-experiment-plan-latest.json"), `${JSON.stringify({
      plan,
      execution,
    }, null, 2)}\n`);
  }
  if (args.execute) {
    await new JsonlStore(config.dataDir).append("proxy-spread-experiment-executions", execution);
  }

  if (args.json) {
    console.log(JSON.stringify({ plan, execution }, null, 2));
    return;
  }

  console.log(`strategyId=${plan.strategyId || "proxy-spread-experiment"}`);
  console.log(`route=${args.buyChain}->${args.sellChain}`);
  console.log(`amount=${args.amount}`);
  console.log(`buyInputToken=${plan.buyInputToken || args.buyInputToken}`);
  console.log(`buyToken=${plan.buyToken || args.buyToken}`);
  console.log(`sellToken=${plan.sellToken || args.sellToken || args.buyToken}`);
  console.log(`sellOutputToken=${plan.sellOutputToken || args.sellOutputToken}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedStage=${plan.blockedStage || "none"}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  if (plan.estimatedBridgeAmount) console.log(`estimatedBridgeAmount=${plan.estimatedBridgeAmount}`);
  if (plan.estimatedSellAmount) console.log(`estimatedSellAmount=${plan.estimatedSellAmount}`);
  if (execution) {
    console.log(`settlementStatus=${execution.settlementStatus}`);
    if (execution.buyExecution?.destinationProof?.observedDelta) {
      console.log(`buyObservedDelta=${execution.buyExecution.destinationProof.observedDelta}`);
    }
    if (execution.bridgeExecution?.destinationProof?.observedDelta) {
      console.log(`bridgeObservedDelta=${execution.bridgeExecution.destinationProof.observedDelta}`);
    }
    if (execution.sellExecution?.destinationProof?.observedDelta) {
      console.log(`sellObservedDelta=${execution.sellExecution.destinationProof.observedDelta}`);
    }
    if (txHashFor(execution.buyExecution)) console.log(`buyTxHash=${txHashFor(execution.buyExecution)}`);
    if (txHashFor(execution.bridgeExecution)) console.log(`bridgeTxHash=${txHashFor(execution.bridgeExecution)}`);
    if (txHashFor(execution.sellExecution)) console.log(`sellTxHash=${txHashFor(execution.sellExecution)}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
