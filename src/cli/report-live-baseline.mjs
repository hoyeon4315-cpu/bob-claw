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
  const report = context.dashboardStatus.liveBaseline;

  if (args.write) {
    const outputPath = join(config.dataDir, "live-baseline.json");
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

  console.log(`status=${report.status}`);
  console.log(`currentStage=${report.currentStageId || "none"}`);
  console.log(`route=${report.route?.routeLabel || "none"}`);
  console.log(`amount=${report.route?.amount || "n/a"}`);
  console.log(`refreshInputsRequired=${report.counts.requiredRefreshCount ?? 0}`);
  console.log(
    `blockerCounts refresh=${report.counts.refresh} operator=${report.counts.operator} technical=${report.counts.technical} objective=${report.counts.objective} total=${report.counts.total}`,
  );
  if (report.nextAction) {
    console.log(`nextAction=${report.nextAction.code}`);
    if (report.nextAction.command) {
      console.log(`nextActionCommand=${report.nextAction.command}`);
    }
  }
  console.log(`refreshBlockers=${report.blockers.refresh.map((item) => item.code).join(",") || "none"}`);
  console.log(`operatorBlockers=${report.blockers.operator.map((item) => item.code).join(",") || "none"}`);
  console.log(`technicalBlockers=${report.blockers.technical.map((item) => item.code).join(",") || "none"}`);
  console.log(`objectiveBlockers=${report.blockers.objective.map((item) => item.code).join(",") || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
