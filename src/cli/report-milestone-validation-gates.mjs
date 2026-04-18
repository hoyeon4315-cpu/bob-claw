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
  const report = context.artifacts?.milestoneValidationGates;

  if (args.write) {
    const outputPath = join(config.dataDir, "milestone-validation-gates.json");
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

  console.log(`overallStatus=${report.summary?.overallStatus || "n/a"}`);
  console.log(`passed=${report.summary?.passedCount ?? 0}/${report.summary?.gateCount ?? 0}`);
  console.log(`blocked=${report.summary?.blockedCount ?? 0} inProgress=${report.summary?.inProgressCount ?? 0}`);
  console.log(`nextGate=${report.summary?.nextGateId || "n/a"}`);
  console.log(`nextAction=${report.summary?.nextAction?.code || "n/a"} command=${report.summary?.nextAction?.command || "n/a"}`);
  for (const gate of report.gates) {
    console.log(`${gate.id} status=${gate.status} blockers=${gate.blockers.length} warnings=${gate.warnings.length}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
