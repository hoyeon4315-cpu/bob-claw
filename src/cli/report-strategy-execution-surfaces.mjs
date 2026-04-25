#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildStrategyExecutionSurfaces } from "../strategy/strategy-execution-surfaces.mjs";

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    write: argv.includes("--write"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts, artifacts } = await buildCurrentDashboardContext();
  const report = buildStrategyExecutionSurfaces({ dashboardStatus, state, triangleArtifacts, artifacts });

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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
