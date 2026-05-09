#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { readLatestJsonlRecord } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readTriangleArtifacts } from "../flash/triangle-artifacts.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { buildStrategyExecutionSurfaces } from "../strategy/strategy-execution-surfaces.mjs";
import { buildSliceDryRunSummary } from "../strategy/slice-dryrun-summary-builder.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

export function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    write: argv.includes("--write"),
  };
}

export async function loadStrategyExecutionSurfaceInputs({
  dataDir = config.dataDir,
  readSignerAuditLogImpl = readSignerAuditLog,
  readTriangleArtifactsImpl = readTriangleArtifacts,
} = {}) {
  const [
    dashboardStatus,
    scoreSnapshot,
    triangleArtifacts,
    phase3StrategyValidation,
    wrappedBtcLendingLoopSlice,
    latestTreasuryInventory,
    wrappedBtcLoopLiveProof,
    signerAuditRecords,
    merklCanaryQueue,
    merklCanaryAutopilotLatest,
    autonomousDiscoveryBoard,
  ] = await Promise.all([
    readJsonIfExists(join(dataDir, "dashboard-status.json")),
    readJsonIfExists(join(dataDir, "gateway-scores.json")),
    readTriangleArtifactsImpl(dataDir),
    readJsonIfExists(join(dataDir, "phase3-strategy-validation.json")),
    readJsonIfExists(join(dataDir, "wrapped-btc-lending-loop-slice.json")),
    readLatestJsonlRecord(dataDir, "treasury-inventory"),
    readJsonIfExists(join(dataDir, "wrapped-btc-loop-live-success-latest.json")),
    readSignerAuditLogImpl(),
    readJsonIfExists(join(dataDir, "merkl-canary-queue.json")),
    readJsonIfExists(join(dataDir, "merkl-canary-autopilot-latest.json")),
    readJsonIfExists(join(dataDir, "autonomous-discovery-board.json")),
  ]);

  const hydratedWrappedBtcLendingLoopSlice = wrappedBtcLendingLoopSlice?.strategy?.id
    ? {
        ...wrappedBtcLendingLoopSlice,
        dryRunSummary: buildSliceDryRunSummary({
          strategyId: wrappedBtcLendingLoopSlice.strategy.id,
          signerAuditRecords,
          existingSummary: wrappedBtcLendingLoopSlice.dryRunSummary || {},
        }),
      }
    : wrappedBtcLendingLoopSlice;

  return {
    dashboardStatus,
    state: {
      scoreSnapshot,
    },
    triangleArtifacts,
    artifacts: {
      phase3StrategyValidation,
      wrappedBtcLendingLoopSlice: hydratedWrappedBtcLendingLoopSlice,
      treasuryInventoryRecords: latestTreasuryInventory ? [latestTreasuryInventory] : [],
      wrappedBtcLoopLiveProof,
      signerAuditRecords,
      merklCanaryQueue,
      merklCanaryAutopilotLatest,
      autonomousDiscoveryBoard,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts, artifacts } = await loadStrategyExecutionSurfaceInputs();
  const report = buildStrategyExecutionSurfaces({
    dashboardStatus,
    state,
    triangleArtifacts,
    artifacts,
    now: new Date().toISOString(),
  });

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "strategy-execution-surfaces.json"), `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("BOB Claw Strategy Execution Surfaces");
  console.log(`generated: ${report.generatedAt}`);
  console.log(`liveTrading: ${report.policy.liveTrading}`);
  console.log(`runnable: ${report.summary.runnableCount}/${report.summary.strategyCount}`);
  console.log(`liveEligible: ${report.summary.liveEligibleCount}`);
  for (const strategy of report.strategies) {
    const scripts = strategy.selectedCommands.map((command) => command.script).filter(Boolean).join(",");
    console.log(
      [
        `- ${strategy.label}`,
        `bucket=${strategy.capabilityBucket}`,
        `mode=${strategy.selectedMode}`,
        `status=${strategy.status}`,
        scripts ? `scripts=${scripts}` : null,
        strategy.fallbackReason ? `reason=${strategy.fallbackReason}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
