#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildStrategyPivotPlan } from "../strategy/pivot-plan.mjs";
import { buildYieldShadowBook } from "../ledger/yield-shadow-book.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    aprBps: options["apr-bps"]
      ? options["apr-bps"]
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item) && item > 0)
      : undefined,
  };
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts } = await buildCurrentDashboardContext();
  const pivotPlan = buildStrategyPivotPlan({ dashboardStatus, state, triangleArtifacts });
  const book = buildYieldShadowBook({ pivotPlan, scenarioAprBps: args.aprBps });

  if (args.write) {
    const outputPath = join(config.dataDir, "yield-shadow-book-latest.json");
    const writeResult = await writeTextIfChanged(outputPath, `${JSON.stringify(book, null, 2)}\n`, {
      normalize(contents) {
        return JSON.stringify(JSON.parse(contents));
      },
    });
    console.log(`${writeResult.changed ? "wrote" : "unchanged"}=${writeResult.path}`);
    if (!args.json) console.log("");
  }

  if (args.json) {
    console.log(JSON.stringify(book, null, 2));
    return;
  }

  console.log(`bookStatus=${book.bookStatus}`);
  console.log(`currentBudgetUsd=${money(book.currentBudgetUsd)}`);
  console.log(
    `budgetScenarios=${(book.budgetScenarios || [])
      .map((scenario) => `${money(scenario.budgetUsd)}:${scenario.readyProfileCount}${scenario.planningOnly ? ":planning" : ":active"}`)
      .join(",")}`,
  );
  console.log(`profileCount=${book.summary.profileCount}`);
  console.log(`withinBudgetCount=${book.summary.withinBudgetCount}`);
  console.log(`estimatedSampleCount=${book.summary.estimatedSampleCount}`);
  console.log(`realizedSampleCount=${book.summary.realizedSampleCount}`);

  for (const profile of book.profiles) {
    const baseScenario = profile?.pnl?.paper?.scenarios?.find((item) => item.aprBps === 500) || profile?.pnl?.paper?.scenarios?.[0] || null;
    console.log(
      [
        `profile=${profile.id}`,
        `status=${profile.status}`,
        `capital=${money(profile.capitalRequiredUsd)}`,
        `deployable=${money(profile.deployableUsd)}`,
        `reserve=${money(profile.reserveUsd)}`,
        `fitsBudget=${profile.fitsCurrentBudget}`,
        `budgetGap=${money(profile.budgetGapUsd)}`,
        `scenarioFits=${(profile.budgetScenarios || [])
          .map((scenario) => `${scenario.budgetUsd}:${scenario.fitsBudget === true ? "fit" : scenario.fitsBudget === false ? "gap" : "n/a"}`)
          .join(",")}`,
        `paperDaily=${money(baseScenario?.oneDayUsd)}`,
        `paper30d=${money(baseScenario?.thirtyDayUsd)}`,
        `estimated=${profile.pnl?.estimated?.status || "n/a"}`,
        `realized=${profile.pnl?.realized?.status || "n/a"}`,
      ].join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
