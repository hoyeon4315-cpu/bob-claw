#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildLaneReclassificationArtifact } from "../strategy/phase1-revalidation.mjs";

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

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(4)}` : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [context, overfitAuditArtifact, varianceArtifact] = await Promise.all([
    buildCurrentDashboardContext({ dataDir: config.dataDir }),
    readJsonIfExists(join(config.dataDir, "overfit-audit-latest.json")),
    readJsonIfExists(join(config.dataDir, "gas-slippage-variance-latest.json")),
  ]);

  const artifact = buildLaneReclassificationArtifact({
    strategySnapshot: context.strategySnapshot,
    dashboardStatus: context.dashboardStatus,
    varianceArtifact,
    overfitAuditArtifact,
    now: context.dashboardStatus?.generatedAt || new Date().toISOString(),
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "lane-reclassification.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  console.log(`lanes=${artifact.summary.laneCount}`);
  console.log(`clearsNewFloor=${artifact.summary.clearsNewFloorCount}`);
  console.log(`needsVarianceMeasurement=${artifact.summary.needsVarianceMeasurementCount}`);
  console.log(`blockedByContractFloor=${artifact.summary.blockedByContractFloorCount}`);
  for (const lane of artifact.lanes) {
    console.log(
      `${lane.id} old=${lane.statusOld || "n/a"} new=${lane.statusNew || "n/a"} net=${money(lane.netPnlMeasuredUsd)} variance=${money(lane.gasSlippageVarianceUsd)} clears=${lane.clearsNewFloor == null ? "n/a" : lane.clearsNewFloor} reason=${lane.statusReasonCode || "n/a"}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
