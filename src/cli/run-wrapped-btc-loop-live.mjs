#!/usr/bin/env node

import process from "node:process";
import {
  executorStrategyBindingsPath,
  runWrappedBtcLoopLiveScenario,
} from "../executor/strategies/wrapped-btc-loop-live.mjs";
import { signerSocketPath } from "../executor/signer/client.mjs";

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
    scenario: options.scenario || "healthy_baseline",
    perTradeCapUsd: options["per-trade-cap-usd"] ? Number(options["per-trade-cap-usd"]) : null,
    marketMinIncrementUsd: options["market-min-increment-usd"] ? Number(options["market-min-increment-usd"]) : null,
    maxLoopIterations: options["max-loop-iterations"] ? Number(options["max-loop-iterations"]) : null,
    maxIntentsPerRun: options["max-intents"] ? Number(options["max-intents"]) : null,
    useCurrentPosition: flags.has("--use-current-position"),
    unwindOnly: flags.has("--unwind-only"),
    bindingsPath: options["bindings-path"] || executorStrategyBindingsPath(),
    socketPath: options["socket-path"] || signerSocketPath(),
    command: options.command || "sign_and_broadcast",
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : 30_000,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runWrappedBtcLoopLiveScenario({
    bindingsPath: args.bindingsPath,
    scenarioId: args.scenario,
    perTradeCapUsdOverride: args.perTradeCapUsd,
    marketAssumptionsOverride: Number.isFinite(args.marketMinIncrementUsd)
      ? { minIncrementUsd: args.marketMinIncrementUsd }
      : null,
    maxLoopIterationsOverride: args.maxLoopIterations,
    useCurrentPosition: args.useCurrentPosition,
    unwindOnly: args.unwindOnly,
    socketPath: args.socketPath,
    command: args.command,
    awaitConfirmation: args.awaitConfirmation,
    confirmations: args.confirmations,
    confirmationTimeoutMs: args.confirmationTimeoutMs,
    timeoutMs: args.timeoutMs,
    maxIntentsPerRun: args.maxIntentsPerRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`ok=${result.ok}`);
  console.log(`status=${result.status || (result.ok ? "ok" : "error")}`);
  if (result.blockedReason) console.log(`blockedReason=${result.blockedReason}`);
  console.log(`scenario=${result.scenarioId}`);
  console.log(`useCurrentPosition=${result.useCurrentPosition ? "true" : "false"}`);
  console.log(`unwindOnly=${result.unwindOnly ? "true" : "false"}`);
  if (result.maxLoopIterationsOverride) console.log(`maxLoopIterations=${result.maxLoopIterationsOverride}`);
  if (result.runBudget) {
    console.log(`plannedIntents=${result.runBudget.plannedIntentCount}`);
    console.log(`maxIntents=${result.runBudget.maxIntentsPerRun || "none"}`);
  }
  console.log(`entryCount=${result.entryResults.length}`);
  console.log(`unwindCount=${result.unwindResults.length}`);
  console.log(`receiptAutoIngest=${result.receiptAutoIngest.ran ? "ran" : result.receiptAutoIngest.reason || "skipped"}`);
  const entryTxHashes = result.entryResults.map((item) => item.broadcast?.txHash).filter(Boolean);
  const unwindTxHashes = result.unwindResults.map((item) => item.broadcast?.txHash).filter(Boolean);
  if (entryTxHashes.length > 0) console.log(`entryTxHashes=${entryTxHashes.join(",")}`);
  if (unwindTxHashes.length > 0) console.log(`unwindTxHashes=${unwindTxHashes.join(",")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
