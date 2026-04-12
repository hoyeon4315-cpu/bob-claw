#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const report = context.dashboardStatus.prelive;

  if (args.write) {
    const outputPath = join(config.dataDir, "prelive-readiness.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`currentStage=${report.currentStage}`);
  console.log(`liveTradingPolicy=${report.liveTradingPolicy}`);
  console.log(`shadowReplay=${report.shadowReplay.status}`);
  console.log(`shadowReplayBlockers=${report.shadowReplay.blockers.join(",") || "none"}`);
  console.log(`mechanicalSimulation=${report.mechanicalSimulation.status}`);
  console.log(
    `simulationCounts success=${report.mechanicalSimulation.successCount}/${report.mechanicalSimulation.targetSuccessCount} failure=${report.mechanicalSimulation.failureCount}`,
  );
  console.log(`mechanicalBlockers=${report.mechanicalSimulation.blockers.join(",") || "none"}`);
  console.log(`forkExecution=${report.forkExecution.status}`);
  console.log(
    `forkCounts planned=${report.forkExecution.planCount} submitted=${report.forkExecution.submittedCount} confirmed=${report.forkExecution.confirmedCount}/${report.forkExecution.targetConfirmedCount} failed=${report.forkExecution.failedCount}`,
  );
  console.log(`forkBlockers=${report.forkExecution.blockers.join(",") || "none"}`);
  console.log(`executionAudit=${report.executionAudit.status}`);
  console.log(`executionAuditMissing=${report.executionAudit.missingRecordCount}`);
  console.log(`executionAuditBlockers=${report.executionAudit.blockers.join(",") || "none"}`);
  console.log(`tinyLiveCanary=${report.tinyLiveCanary.status}`);
  console.log(`tinyLiveBlockers=${report.tinyLiveCanary.blockers.join(",") || "none"}`);
  for (const action of report.nextActions || []) {
    console.log(
      [
        "nextAction",
        action.rank != null ? `rank=${action.rank}` : null,
        action.scope ? `scope=${action.scope}` : null,
        action.label ? `label=${action.label}` : null,
        action.reason ? `reason=${action.reason}` : null,
        action.command ? `command=${action.command}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
