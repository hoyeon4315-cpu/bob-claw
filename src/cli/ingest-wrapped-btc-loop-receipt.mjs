#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { runLiveReadinessRefreshPlan } from "../session/live-readiness-refresh.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../strategy/wrapped-btc-lending-loop-slice.mjs";
import {
  buildWrappedBtcLoopObservedReceipt,
  summarizeWrappedBtcLendingLoopDryRunRuns,
} from "../strategy/wrapped-btc-lending-loop-dry-run.mjs";
import { buildWrappedBtcLoopOosEvidence } from "../strategy/wrapped-btc-loop-oos-evidence.mjs";

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
    scenario: options.scenario || "healthy_baseline",
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
    refreshLivePacket: !flags.has("--no-refresh-live-packet"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, runId, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scaffold =
    (await readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json"))) || buildWrappedBtcLendingLoopScaffold();
  const receipt = buildWrappedBtcLoopObservedReceipt({
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
  const store = new JsonlStore(config.dataDir);
  if (args.write) {
    await store.append("wrapped-btc-loop-dry-runs", receipt);
  }
  const allRecords = args.write ? await readJsonl(config.dataDir, "wrapped-btc-loop-dry-runs") : [receipt];
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strategyId: scaffold.strategy?.id || null,
    ...summarizeWrappedBtcLendingLoopDryRunRuns(allRecords),
  };
  const oosEvidence = buildWrappedBtcLoopOosEvidence({
    records: allRecords,
    now: new Date().toISOString(),
  });
  let livePacketRefresh = null;

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "wrapped-btc-lending-loop-dry-run-latest.json"), `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
    await writeTextIfChanged(join(config.dataDir, "wrapped-btc-loop-oos-evidence.json"), `${JSON.stringify(oosEvidence, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
    if (args.refreshLivePacket) {
      const results = runLiveReadinessRefreshPlan();
      livePacketRefresh = {
        refreshed: true,
        stepCount: results.length,
        firstStep: results[0]?.script || null,
        lastStep: results.at(-1)?.script || null,
      };
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ receipt, summary, oosEvidence, livePacketRefresh }, null, 2));
    return;
  }

  console.log(`scenario=${receipt.scenarioId}`);
  console.log(`executionMode=${receipt.executionMode}`);
  console.log(`result=${receipt.result}`);
  console.log(`signerBackedRunCount=${oosEvidence.summary.signerBackedRunCount}`);
  console.log(`oosStatus=${oosEvidence.summary.status}`);
  console.log(`livePacketRefresh=${livePacketRefresh?.refreshed ? `ran:${livePacketRefresh.stepCount}` : args.refreshLivePacket ? "skipped" : "disabled"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
