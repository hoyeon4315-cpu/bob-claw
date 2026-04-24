#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildStrategyCatalog } from "../strategy/strategy-catalog.mjs";
import { buildLiveDeploymentPriorities } from "../strategy/live-deployment-priorities.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function latestJsonlObject(text) {
  const lines = String(text || "").trim().split("\n").filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
}

async function readLatestJsonlIfExists(path) {
  try {
    return latestJsonlObject(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function printReport(report) {
  console.log("Live Deployment Priorities");
  console.log(`observedAt=${report.observedAt}`);
  console.log(`activeUsd=${report.summary.activeUsd.toFixed(6)}`);
  console.log(`estimatedWalletBtc=${report.summary.estimatedWalletBtc.toFixed(8)}`);
  console.log(`estimatedWalletUsd=${report.summary.estimatedWalletUsd.toFixed(2)}`);
  console.log(`entryReady=${report.summary.entryReadyCount}`);
  console.log(`autoQueuedRefills=${report.summary.autoQueuedRefillCount}`);
  console.log("\nChains");
  for (const chain of report.chainPriorities) {
    console.log(
      `- ${chain.chain}: ${chain.decision} activeUsd=${chain.activeUsd.toFixed(6)} queue=${chain.queueCount} blockers=${chain.topBlockers.map((item) => item.blocker).join(",") || "none"}`,
    );
  }
  console.log("\nStrategy Families");
  for (const item of report.strategyDecisions) {
    console.log(`- ${item.label}: ${item.decision} (${item.status})`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts, artifacts } = await buildCurrentDashboardContext();
  const strategyCatalog = buildStrategyCatalog({
    dashboardStatus,
    state,
    triangleArtifacts,
    laneReclassification: artifacts?.laneReclassification || null,
  });
  const [merklAllocationPlan, refillJobs, inventory] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "merkl-portfolio-allocator-latest.json")),
    readLatestJsonlIfExists(join(config.dataDir, "treasury-refill-jobs.jsonl")),
    readLatestJsonlIfExists(join(config.dataDir, "treasury-inventory.jsonl")),
  ]);
  const report = buildLiveDeploymentPriorities({
    strategyCatalog,
    merklAllocationPlan: merklAllocationPlan || {},
    refillJobs: refillJobs || {},
    inventory: inventory || {},
  });
  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "live-deployment-priorities.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReport(report);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
