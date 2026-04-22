#!/usr/bin/env node

import { buildTinyLiveCanaryIntent } from "../executor/policy/tiny-live-canary-intent.mjs";

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    strategyId: options["strategy-id"] || "wrapped-btc-loop-base-moonwell",
    chain: options.chain || "base",
    amountUsd: Number(options["amount-usd"] || 25),
    microCanaryStatus: options["micro-canary-status"] || "minimal_live_proof_exists",
    command: options.command || "sign_and_broadcast",
    confirmations: Number(options.confirmations || 1),
    timeoutMs: Number(options["timeout-ms"] || 120_000),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const intent = buildTinyLiveCanaryIntent({
    strategyId: args.strategyId,
    chain: args.chain,
    amountUsd: args.amountUsd,
    microCanaryStatus: args.microCanaryStatus,
    now: new Date().toISOString(),
  });

  const message = {
    command: args.command,
    intent,
    awaitConfirmation: true,
    confirmations: args.confirmations,
    timeoutMs: args.timeoutMs,
  };

  console.log(JSON.stringify(message, null, 2));
}

main();
