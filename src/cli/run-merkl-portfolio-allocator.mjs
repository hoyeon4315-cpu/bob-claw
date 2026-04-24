#!/usr/bin/env node

import { resolve } from "node:path";
import { runMerklPortfolioAllocator } from "../executor/merkl-portfolio-allocator.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";

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
  const policy = {};
  if (entries["portfolio-max-usd"]) policy.maxActiveUsd = Number(entries["portfolio-max-usd"]);
  if (entries["per-opportunity-max-usd"]) policy.perOpportunityMaxUsd = Number(entries["per-opportunity-max-usd"]);
  if (entries["max-new-positions"]) policy.maxNewPositionsPerRun = Number(entries["max-new-positions"]);
  if (entries["max-open-positions"]) policy.maxOpenPositions = Number(entries["max-open-positions"]);
  if (entries["min-position-usd"]) policy.minPositionUsd = Number(entries["min-position-usd"]);
  if (entries["min-hold-minutes"]) policy.minHoldMinutes = Number(entries["min-hold-minutes"]);
  return {
    execute: flags.has("--execute"),
    json: flags.has("--json"),
    write: flags.has("--write"),
    refreshInventory: !flags.has("--no-refresh-inventory"),
    maxUsd: entries["max-usd"] ? Number(entries["max-usd"]) : null,
    policy,
    socketPath: resolve(entries["socket-path"] || signerSocketPath()),
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : signerClientTimeoutMs(),
  };
}

function compact(report = {}) {
  return {
    mode: report.mode || null,
    status: report.status || null,
    blockedReason: report.blockedReason || null,
    activePositionCount: report.plan?.summary?.activePositionCount ?? 0,
    activePositionUsd: report.plan?.summary?.activePositionUsd ?? 0,
    entryReadyCount: report.plan?.summary?.entryReadyCount ?? 0,
    topEntryOpportunityId: report.plan?.summary?.topEntryOpportunityId || null,
    topEntryScore: report.plan?.summary?.topEntryScore ?? null,
    openedCount: (report.executions || []).filter((item) => item.status === "position_opened").length,
    opened: (report.executions || []).map((item) => ({
      opportunityId: item.opportunityId,
      status: item.status,
      txHashes: item.txHashes,
      positionId: item.positionRecord?.positionId || null,
      amountUsd: item.positionRecord?.amountUsd ?? null,
    })),
  };
}

function printSummary(report) {
  const summary = compact(report);
  console.log(`mode=${summary.mode}`);
  console.log(`status=${summary.status}`);
  console.log(`blockedReason=${summary.blockedReason || "none"}`);
  console.log(`activePositionCount=${summary.activePositionCount} activePositionUsd=${summary.activePositionUsd}`);
  console.log(`entryReadyCount=${summary.entryReadyCount}`);
  console.log(`topEntry=${summary.topEntryOpportunityId || "none"} score=${summary.topEntryScore ?? "n/a"}`);
  console.log(`openedCount=${summary.openedCount}`);
  for (const item of summary.opened) {
    console.log(`${item.opportunityId} ${item.status} amountUsd=${item.amountUsd ?? "n/a"} position=${item.positionId || "n/a"} tx=${item.txHashes.join(",")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runMerklPortfolioAllocator({
    execute: args.execute,
    write: args.write,
    maxUsd: args.maxUsd,
    policy: args.policy,
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
    refreshInventory: args.refreshInventory,
  });
  if (args.json) console.log(safeJsonStringify(report, 2));
  else printSummary(report);
  if (report.status === "blocked") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
