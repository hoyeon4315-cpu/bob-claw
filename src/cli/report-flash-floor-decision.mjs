#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildFlashFloorDecision } from "../strategy/flash-floor-decision.mjs";

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
  const [contractSource, deployScript, deployCheckKey] = await Promise.all([
    readFile(join(process.cwd(), "src/contracts/BalancerFlashArb.sol"), "utf8"),
    readFile(join(process.cwd(), "src/cli/deploy-and-configure.mjs"), "utf8"),
    readFile(join(process.cwd(), "src/cli/deploy-check-key.mjs"), "utf8"),
  ]);
  const report = buildFlashFloorDecision({
    contractSource,
    deploymentCommands: [deployScript, deployCheckKey],
    laneReclassification: context.artifacts?.laneReclassification || null,
    strategySnapshot: context.strategySnapshot || null,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "flash-floor-decision.json");
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

  console.log(`decision=${report.summary?.currentDecision || "n/a"}`);
  console.log(`recommendation=${report.summary?.recommendation || "n/a"}`);
  console.log(`ownerSetterAvailable=${report.contract?.ownerSetterAvailable === true ? "yes" : "no"}`);
  console.log(`sourceMinProfitUsd=${report.contract?.sourceMinProfitUsd ?? "n/a"}`);
  console.log(`laneStatus=${report.lane?.laneStatusNew || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
