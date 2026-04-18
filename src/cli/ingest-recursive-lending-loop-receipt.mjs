#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  buildRecursiveLendingLoopObservedReceipt,
  filterRecursiveLendingLoopDryRunRecords,
  recursiveLendingLoopDryRunSessionName,
  summarizeRecursiveLendingLoopDryRunRuns,
} from "../strategy/recursive-lending-loop-dry-run.mjs";
import {
  buildDefaultRecursiveLendingLoopConfig,
  buildRecursiveLendingLoopScaffold,
  listRecursiveLendingLoopStrategyIds,
} from "../strategy/recursive-lending-loop-slice.mjs";

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
    strategy: options.strategy || "recursive_wrapped_btc_lending_loop",
    scenario: options.scenario || "healthy_baseline",
    protocol: options.protocol || null,
    chain: options.chain || null,
    executionMode: options["execution-mode"] || "signer_backed_receipt",
    result: options.result || "passed",
    entryTxHashes: (options["entry-tx-hashes"] || "").split(",").map((item) => item.trim()).filter(Boolean),
    unwindTxHashes: (options["unwind-tx-hashes"] || "").split(",").map((item) => item.trim()).filter(Boolean),
    observedHealthFactorPath: (options["health-factor-path"] || "").split(",").map((item) => Number(item.trim())).filter(Number.isFinite),
    observedLiquidationBufferPath: (options["liquidation-buffer-path"] || "").split(",").map((item) => Number(item.trim())).filter(Number.isFinite),
    actualLoopFeesUsd: options["actual-loop-fees-usd"] ? Number(options["actual-loop-fees-usd"]) : null,
    actualUnwindCostUsd: options["actual-unwind-cost-usd"] ? Number(options["actual-unwind-cost-usd"]) : null,
    realizedNetCarryUsd: options["realized-net-carry-usd"] ? Number(options["realized-net-carry-usd"]) : null,
    notes: (options.notes || "").split("|").map((item) => item.trim()).filter(Boolean),
    observedAt: options["observed-at"] || null,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, runId, ...stable } = value;
  return stable;
}

async function buildScaffold(args) {
  const strategyConfig = buildDefaultRecursiveLendingLoopConfig(args.strategy);
  if (args.protocol) strategyConfig.protocol = args.protocol;
  if (args.chain) strategyConfig.chain = args.chain;
  return (
    (await readJsonIfExists(join(config.dataDir, `${strategyConfig.id}-scaffold.json`))) ||
    buildRecursiveLendingLoopScaffold({
      strategyId: strategyConfig.id,
      strategyConfig,
    })
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!listRecursiveLendingLoopStrategyIds().includes(args.strategy)) {
    throw new Error(`Unsupported strategy: ${args.strategy}`);
  }
  const scaffold = await buildScaffold(args);
  const receipt = buildRecursiveLendingLoopObservedReceipt({
    scaffold,
    scenarioId: args.scenario,
    executionMode: args.executionMode,
    result: args.result,
    entryTxHashes: args.entryTxHashes,
    unwindTxHashes: args.unwindTxHashes,
    observedHealthFactorPath: args.observedHealthFactorPath,
    observedLiquidationBufferPath: args.observedLiquidationBufferPath,
    actualLoopFeesUsd: args.actualLoopFeesUsd,
    actualUnwindCostUsd: args.actualUnwindCostUsd,
    realizedNetCarryUsd: args.realizedNetCarryUsd,
    notes: args.notes,
    now: args.observedAt || undefined,
  });
  const sessionName = recursiveLendingLoopDryRunSessionName(scaffold.strategy?.id || args.strategy);
  const store = new JsonlStore(config.dataDir);
  if (args.write) {
    await store.append(sessionName, receipt);
  }
  const allRecords = filterRecursiveLendingLoopDryRunRecords(
    args.write ? await readJsonl(config.dataDir, sessionName) : [receipt],
    scaffold.strategy?.id || args.strategy,
  );
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strategyId: scaffold.strategy?.id || null,
    ...summarizeRecursiveLendingLoopDryRunRuns(allRecords),
  };

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, `${scaffold.strategy?.id || args.strategy}-dry-run-latest.json`), `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  if (args.json) {
    console.log(JSON.stringify({ receipt, summary }, null, 2));
    return;
  }

  console.log(`strategy=${receipt.strategyId}`);
  console.log(`scenario=${receipt.scenarioId}`);
  console.log(`executionMode=${receipt.executionMode}`);
  console.log(`result=${receipt.result}`);
  console.log(`signerBackedRunCount=${summary.signerBackedRunCount}`);
  console.log(`dryRunReceiptRecorded=${summary.dryRunReceiptRecorded}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
