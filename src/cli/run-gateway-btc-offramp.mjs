#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { buildGatewayBtcOfframpPlan, executeGatewayBtcOfframpPlan } from "../executor/helpers/gateway-btc-offramp.mjs";

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
    srcToken: options["src-token"] || "wbtc.oft",
    amount: options.amount || "5000",
    sender: options.sender || null,
    recipient: options.recipient || null,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    awaitBitcoinSettlement: !flags.has("--no-await-bitcoin-settlement"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
    bitcoinSettlementTimeoutMs: options["bitcoin-timeout-ms"] ? Number(options["bitcoin-timeout-ms"]) : null,
    bitcoinPollIntervalMs: options["bitcoin-poll-interval-ms"] ? Number(options["bitcoin-poll-interval-ms"]) : 10_000,
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
  const sender = args.sender || health?.addresses?.base || null;
  const recipient = args.recipient || health?.addresses?.bitcoin || null;
  if (!sender) throw new Error("EVM sender is required; pass --sender or start the signer daemon with an EVM key configured");
  if (!recipient) throw new Error("Bitcoin recipient is required; pass --recipient or start the signer daemon with a BTC key configured");
  return { sender, recipient };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.srcChain) {
    throw new Error("--src-chain is required");
  }
  const { sender, recipient } = await resolveAddresses(args);
  const plan = await buildGatewayBtcOfframpPlan({
    srcChain: args.srcChain,
    srcToken: args.srcToken,
    amount: args.amount,
    senderAddress: sender,
    recipient,
  });
  const execution = args.execute
    ? await executeGatewayBtcOfframpPlan({
        plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        awaitBitcoinSettlement: args.awaitBitcoinSettlement,
        confirmations: args.confirmations,
        confirmationTimeoutMs: args.confirmationTimeoutMs,
        bitcoinSettlementTimeoutMs: args.bitcoinSettlementTimeoutMs || undefined,
        bitcoinPollIntervalMs: args.bitcoinPollIntervalMs,
      })
    : null;

  if (args.write || args.execute) {
    await writeTextIfChanged(join(config.dataDir, "gateway-btc-offramp-plan-latest.json"), `${JSON.stringify({
      plan,
      execution,
    }, null, 2)}\n`);
  }
  if (args.execute) {
    await new JsonlStore(config.dataDir).append("gateway-btc-offramp-executions", execution);
  }

  if (args.json) {
    console.log(JSON.stringify({ plan, execution }, null, 2));
    return;
  }

  console.log(`strategyId=${plan.strategyId}`);
  console.log(`srcChain=${plan.route.srcChain}`);
  console.log(`srcToken=${plan.srcAsset.ticker}`);
  console.log(`amount=${plan.amount}`);
  console.log(`amountUsd=${plan.amountUsd}`);
  console.log(`sender=${plan.senderAddress}`);
  console.log(`recipient=${plan.recipient}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  if (plan.gatewayError?.details?.body?.code) {
    console.log(`gatewayCode=${plan.gatewayError.details.body.code}`);
  }
  if (plan.gatewayError?.details?.body?.error) {
    console.log(`gatewayMessage=${plan.gatewayError.details.body.error}`);
  }
  if (plan.order?.orderId) {
    console.log(`orderId=${plan.order.orderId}`);
  }
  if (plan.gasPreflight) {
    console.log(`gasUnits=${plan.gasPreflight.gasUnits}`);
    console.log(`gasLimit=${plan.gasPreflight.gasLimit}`);
  }
  if (execution?.signerResult?.broadcast?.txHash) {
    console.log(`txHash=${execution.signerResult.broadcast.txHash}`);
  }
  if (execution?.settlementStatus) {
    console.log(`settlementStatus=${execution.settlementStatus}`);
  }
  if (execution?.destinationProof) {
    console.log(`bitcoinProofSource=${execution.destinationProof.proofSource}`);
    console.log(`bitcoinObservedDelta=${execution.destinationProof.observedDelta}`);
    console.log(`bitcoinRequiredDelta=${execution.destinationProof.requiredDelta}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
