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

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const report = context.strategySnapshot;

  if (args.write) {
    const outputPath = join(config.dataDir, "strategy-snapshot.json");
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

  const summary = report?.summary || {};
  const topStrategy = context.dashboardStatus?.strategy?.strategySnapshot?.topImplementedStrategy || null;
  const topPivot = context.dashboardStatus?.strategy?.strategySnapshot?.topPivot || null;
  const topAction = context.dashboardStatus?.strategy?.strategySnapshot?.topAction || null;
  const capitalExpansion = context.dashboardStatus?.strategy?.strategySnapshot?.capitalExpansionReview || null;

  console.log(`implementedStrategies=${summary.implementedStrategyCount ?? 0}`);
  console.log(`candidateForValidation=${summary.candidateForValidationCount ?? 0}`);
  console.log(`measuredBelowPolicy=${summary.measuredBelowPolicyCount ?? 0}`);
  console.log(`activeBudgetUsd=${money(report?.currentSystem?.activeBudgetUsd)}`);
  console.log(`planningBudgetUsd=${money(summary.planningBudgetUsd)}`);
  if (capitalExpansion) {
    console.log(
      `capitalLanes=active:${money(capitalExpansion.activeLaneBudgetUsd)} planning:${money(capitalExpansion.planningLaneBudgetUsd)} approvalRequired=${capitalExpansion.approvalRequiredForPlanningLane}`,
    );
    console.log(
      `capitalPlanningTop=implemented:${capitalExpansion.planningTopImplementedId || "n/a"} pivot:${capitalExpansion.planningTopPivotId || "n/a"} yield:${capitalExpansion.planningYieldProfileId || "n/a"}`,
    );
  }
  console.log(`topImplemented=${topStrategy?.id || "n/a"} status=${topStrategy?.status || "n/a"}`);
  console.log(`topPivot=${topPivot?.id || "n/a"} status=${topPivot?.status || "n/a"}`);
  console.log(`yieldTopProfile=${summary.yieldTopProfileId || "n/a"}`);
  console.log(`proxyCoverageNext=${summary.proxyCoverageNextAction || "n/a"}`);
  console.log(`nextAction=${topAction?.code || "n/a"} command=${topAction?.command || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
