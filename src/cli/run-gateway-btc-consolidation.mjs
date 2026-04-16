#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import {
  buildGatewayBtcConsolidationPlan,
  DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  executeGatewayBtcConsolidationPlan,
} from "../executor/helpers/gateway-btc-consolidation.mjs";

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
    dstChain: options["dst-chain"] || "base",
    token: options.token || "wbtc.oft",
    srcToken: options["src-token"] || null,
    dstToken: options["dst-token"] || null,
    amount: options.amount || "10000",
    sender: options.sender || null,
    recipient: options.recipient || null,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
    gasBufferBps: options["gas-buffer-bps"] ? Number(options["gas-buffer-bps"]) : DEFAULT_GATEWAY_GAS_BUFFER_BPS,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.srcChain) {
    throw new Error("--src-chain is required");
  }
  const { sender, recipient } = await resolveAddresses(args);
  const plan = await buildGatewayBtcConsolidationPlan({
    srcChain: args.srcChain,
    dstChain: args.dstChain,
    token: args.token,
    srcToken: args.srcToken || args.token,
    dstToken: args.dstToken || args.token,
    amount: args.amount,
    senderAddress: sender,
    recipient,
    gasBufferBps: args.gasBufferBps,
  });
  const execution = args.execute
    ? await executeGatewayBtcConsolidationPlan({
        plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        confirmations: args.confirmations,
        confirmationTimeoutMs: args.confirmationTimeoutMs,
      })
    : null;

  if (args.write || args.execute) {
    await writeTextIfChanged(
      join(config.dataDir, "gateway-btc-consolidation-plan-latest.json"),
      `${JSON.stringify({ plan, execution }, null, 2)}\n`,
    );
  }
  if (args.execute) {
    await new JsonlStore(config.dataDir).append("gateway-btc-consolidation-executions", execution);
  }

  if (args.json) {
    console.log(JSON.stringify({ plan, execution }, null, 2));
    return;
  }

  console.log(`strategyId=${plan.strategyId}`);
  console.log(`route=${plan.route.srcChain}->${plan.route.dstChain}`);
  console.log(`asset=${plan.srcAsset.ticker}->${plan.dstAsset.ticker}`);
  console.log(`amount=${plan.amount}`);
  console.log(`amountUsd=${plan.amountUsd}`);
  console.log(`sender=${plan.senderAddress}`);
  console.log(`recipient=${plan.recipient}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  if (plan.gasPreflight) {
    console.log(`gasUnits=${plan.gasPreflight.gasUnits}`);
    console.log(`gasLimit=${plan.gasPreflight.gasLimit}`);
  }
  if (plan.preflightError?.message) {
    console.log(`preflightError=${plan.preflightError.message}`);
  }
  if (execution?.signerResult?.broadcast?.txHash) {
    console.log(`txHash=${execution.signerResult.broadcast.txHash}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
