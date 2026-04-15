#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildStrategyPivotPlan } from "../strategy/pivot-plan.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

function pct(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function printPivot(pivot) {
  console.log(`- ${pivot.label}: ${pivot.status}`);
  console.log(`  reason: ${pivot.reason}`);
  if (Number.isFinite(pivot.capitalGuidance?.minimumCapitalUsd)) {
    console.log(`  observed capital floor: ${money(pivot.capitalGuidance.minimumCapitalUsd)}`);
  }
  if (Number.isFinite(pivot.capitalGuidance?.observedNetUsd)) {
    console.log(`  observed net: ${money(pivot.capitalGuidance.observedNetUsd)} (${pct(pivot.capitalGuidance.observedNetPct)})`);
  }
  if (Number.isFinite(pivot.capitalGuidance?.researchPilotMinimumUsd)) {
    console.log(
      `  yield floors: pilot ${money(pivot.capitalGuidance.researchPilotMinimumUsd)} | diversified ${money(pivot.capitalGuidance.diversifiedSingleSleeveMinimumUsd)} | default split ${money(pivot.capitalGuidance.defaultDualSleeveMinimumUsd)}`,
    );
  }
  if (pivot.blockers?.length) {
    console.log(`  blockers: ${pivot.blockers.slice(0, 5).join(", ")}`);
  }
  if (pivot.nextStep?.label || pivot.nextStep?.code) {
    console.log(`  next: ${pivot.nextStep.label || pivot.nextStep.code}`);
  }
  if (pivot.budgetScenarios?.length) {
    console.log(
      `  budget scenarios: ${pivot.budgetScenarios
        .map((scenario) => {
          const fit = scenario.defaultDualSleeve || scenario.researchPilot || scenario.observedTradeFloor || null;
          return `${money(scenario.budgetUsd)}=${fit?.fitsBudget === true ? "fit" : fit?.fitsBudget === false ? "gap" : "n/a"}${
            scenario.planningOnly ? "(planning)" : "(active)"
          }`;
        })
        .join(" | ")}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts } = await buildCurrentDashboardContext();
  const plan = buildStrategyPivotPlan({ dashboardStatus, state, triangleArtifacts });

  if (args.write) {
    const outputPath = join(config.dataDir, "strategy-pivot-plan.json");
    const writeResult = await writeTextIfChanged(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      normalize(contents) {
        return JSON.stringify(JSON.parse(contents));
      },
    });
    console.log(`${writeResult.changed ? "wrote" : "unchanged"}=${writeResult.path}`);
    if (!args.json) console.log("");
  }

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log("BOB Claw Pivot Plan");
  console.log(`generated: ${plan.generatedAt}`);
  console.log(`liveTrading: ${plan.currentSystem.liveTrading}`);
  console.log(`preliveStage: ${plan.currentSystem.preliveStage || "n/a"}`);
  console.log(`riskBudget: ${money(plan.currentSystem.riskBudgetUsd)} | lossCap: ${money(plan.currentSystem.projectLossCapUsd)}`);
  console.log(`budget note: ${plan.budgetAssessment.explanation[0]}`);
  console.log(
    `budget scenarios: ${(plan.budgetAssessment.budgetScenarios || [])
      .map((scenario) => `${money(scenario.budgetUsd)}${scenario.planningOnly ? "(planning)" : "(active)"}`)
      .join(" | ")}`,
  );

  console.log("\nRecommended pivot order");
  for (const pivot of plan.pivots) {
    printPivot(pivot);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
