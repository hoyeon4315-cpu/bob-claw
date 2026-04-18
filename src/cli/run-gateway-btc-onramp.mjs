#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { buildGatewayBtcOnrampPlan, executeGatewayBtcOnrampPlan } from "../executor/helpers/gateway-btc-onramp.mjs";

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
    amountSats: options["amount-sats"] ? Number(options["amount-sats"]) : 100_000,
    dstChain: options["dst-chain"] || "base",
    dstToken: options["dst-token"] || "USDC",
    recipient: options.recipient || null,
    sender: options.sender || null,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
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
  const sender = args.sender || health?.addresses?.bitcoin || null;
  const recipient = args.recipient || health?.addresses?.base || null;
  if (!sender) throw new Error("BTC sender address is required; pass --sender or start the signer daemon with BTC key configured");
  if (!recipient) throw new Error("Destination recipient is required; pass --recipient or start the signer daemon with Base key configured");
  return { sender, recipient };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { sender, recipient } = await resolveAddresses(args);
  const plan = await buildGatewayBtcOnrampPlan({
    senderAddress: sender,
    recipient,
    amountSats: args.amountSats,
    dstChain: args.dstChain,
    dstToken: args.dstToken,
    allowUnfundedPreview: !args.execute,
  });
  const execution = args.execute
    ? await executeGatewayBtcOnrampPlan({
        plan,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
      })
    : null;

  if (args.write || args.execute) {
    await writeTextIfChanged(join(config.dataDir, "gateway-btc-onramp-plan-latest.json"), `${JSON.stringify({
      plan,
      execution,
    }, null, 2)}\n`);
  }
  if (args.execute) {
    await new JsonlStore(config.dataDir).append("gateway-btc-onramp-executions", execution);
  }

  if (args.json) {
    console.log(JSON.stringify({ plan, execution }, null, 2));
    return;
  }

  console.log(`strategyId=${plan.strategyId}`);
  console.log(`sender=${plan.senderAddress}`);
  console.log(`recipient=${plan.recipient}`);
  console.log(`dstChain=${plan.dstChain}`);
  console.log(`dstToken=${plan.dstAsset.ticker}`);
  console.log(`amountSats=${plan.amountSats}`);
  console.log(`amountUsd=${plan.amountUsd}`);
  console.log(`planStatus=${plan.planStatus}`);
  console.log(`blockedReason=${plan.blockedReason || "none"}`);
  if (plan.order) {
    console.log(`orderId=${plan.order.orderId}`);
    console.log(`depositAddress=${plan.order.address}`);
    console.log(`psbtProvided=${plan.order.psbtHex ? "yes" : "no"}`);
  }
  if (execution?.signerResult?.broadcast?.txHash) {
    console.log(`txHash=${execution.signerResult.broadcast.txHash}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
