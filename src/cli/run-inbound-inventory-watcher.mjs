#!/usr/bin/env node

import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  appendInventoryWatcherReport,
  buildInventoryWatcherReport,
} from "../treasury/inventory-watcher.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(2, index), item.slice(index + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    loop: flags.has("--loop"),
    emitInitial: flags.has("--emit-initial"),
    intervalMs: entries["interval-ms"] ? Number(entries["interval-ms"]) : 60_000,
    minDeltaUsd: entries["min-delta-usd"] ? Number(entries["min-delta-usd"]) : 0,
  };
}

async function runOnce(args) {
  const inventoryRecords = await readJsonl(config.dataDir, "treasury-inventory");
  const currentSnapshot = inventoryRecords.at(-1) || null;
  const previousSnapshot = inventoryRecords.at(-2) || null;
  if (!currentSnapshot) {
    throw new Error("No treasury-inventory snapshots found. Run inventory scan first.");
  }
  const report = buildInventoryWatcherReport({
    previousSnapshot,
    currentSnapshot,
    emitInitial: args.emitInitial,
    minDeltaUsd: args.minDeltaUsd,
  });
  let appended = null;
  if (args.write) {
    appended = await appendInventoryWatcherReport(report, { dataDir: config.dataDir });
    await writeTextIfChanged(
      `${config.dataDir}/treasury/inbound-watcher-latest.json`,
      `${JSON.stringify({ ...report, appended }, null, 2)}\n`,
    );
  }
  return { ...report, appended };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  do {
    const report = await runOnce(args);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`inboundEventCount=${report.summary.inboundEventCount}`);
      console.log(`routeReadyCount=${report.summary.routeReadyCount}`);
      console.log(`manualReviewCount=${report.summary.manualReviewCount}`);
      console.log(`candidateQueueCount=${report.summary.candidateQueueCount}`);
      if (report.appended) {
        console.log(`appendedEvents=${report.appended.events}`);
        console.log(`appendedJobs=${report.appended.jobs}`);
        console.log(`appendedPendingWhitelist=${report.appended.pendingWhitelist}`);
      }
    }
    if (!args.loop) break;
    await sleep(args.intervalMs);
  } while (true);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
