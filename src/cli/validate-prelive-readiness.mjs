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

function preliveValidationOutputPaths(dataDir) {
  return [
    join(dataDir, "prelive-validation-latest.json"),
    join(dataDir, "prelive-validation.json"),
  ];
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const report = context.preliveValidation;

  if (args.write) {
    for (const outputPath of preliveValidationOutputPaths(config.dataDir)) {
      await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
        normalize: (contents) => {
          if (!contents) return contents;
          return JSON.stringify(stripVolatile(JSON.parse(contents)));
        },
      });
    }
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`validationStatus=${report?.validationStatus || "n/a"}`);
  console.log(`currentStage=${report?.currentStageId || "n/a"}`);
  console.log(`readinessPct=${report?.readinessPct ?? 0}`);
  console.log(`activeBudgetUsd=${money(report?.budgets?.activeBudgetUsd)}`);
  console.log(`planningBudgetUsd=${money(report?.budgets?.planningBudgetUsd)}`);
  console.log(`topImplementedStrategy=${report?.topStrategy?.implementedStrategyId || "n/a"}`);
  console.log(`topPivot=${report?.topStrategy?.pivotId || "n/a"}`);
  console.log(`nextStage=${report?.summary?.nextStageId || "n/a"}`);
  console.log(`nextAction=${report?.summary?.nextActionCode || "n/a"} command=${report?.summary?.nextActionCommand || "n/a"}`);
  if (report?.summary?.connectedRefreshStatus || Number.isFinite(report?.summary?.connectedRefreshRequiredCount)) {
    console.log(
      `connectedRefresh=${report?.summary?.connectedRefreshStatus || "n/a"} required=${report?.summary?.connectedRefreshRequiredCount ?? 0}`,
    );
  }
  if (report?.summary?.exactRouteForkPlanStatus || report?.summary?.exactRouteForkPlanId) {
    console.log(
      `exactRouteForkPlan=${report?.summary?.exactRouteForkPlanStatus || "n/a"} planId=${report?.summary?.exactRouteForkPlanId || "n/a"} submit=${report?.summary?.exactRouteForkSubmitCommand || "n/a"}`,
    );
  }
  if (report?.summary?.exactRouteForkTechnicalStatus || report?.summary?.exactRouteForkEconomicStatus) {
    console.log(
      `exactRouteForkReadiness=technical:${report?.summary?.exactRouteForkTechnicalStatus || "n/a"} economic:${report?.summary?.exactRouteForkEconomicStatus || "n/a"}`,
    );
  }
  console.log(`blockers=${report?.blockers?.join(",") || "none"}`);
  console.log(`warnings=${report?.warnings?.join(",") || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
