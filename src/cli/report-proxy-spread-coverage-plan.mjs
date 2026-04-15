#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildProxySpreadCoveragePlan } from "../strategy/proxy-spread-coverage-plan.mjs";

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
    proxyGroup: options["proxy-group"] || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { dashboardStatus } = await buildCurrentDashboardContext();
  const plan = buildProxySpreadCoveragePlan({
    proxySpreadSummary: dashboardStatus?.strategy?.btcProxySpreads || null,
    proxyGroup: args.proxyGroup,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "proxy-spread-coverage-plan-latest.json");
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

  console.log(`overfitAssessment=${plan.overfitAssessment}`);
  console.log(`planCount=${plan.summary.planCount}`);
  console.log(`actionableCount=${plan.summary.actionableCount}`);
  console.log(`totalQuoteQuotaNeeded=${plan.summary.totalQuoteQuotaNeeded}`);
  console.log(`nextProxyGroup=${plan.summary.nextProxyGroup || "none"}`);
  console.log(`nextAction=${plan.summary.nextAction || "none"}`);
  console.log(`nextReason=${plan.summary.nextReason || "none"}`);
  console.log(`nextCommand=${plan.summary.nextCommand || "none"}`);

  for (const entry of plan.plan.slice(0, 10)) {
    console.log(
      [
        `proxyGroup=${entry.proxyGroup}`,
        `action=${entry.nextAction}`,
        `reason=${entry.reason}`,
        `priority=${entry.priority}`,
        `quota=${entry.quoteQuotaNeeded}`,
        `chains=${entry.targetChains.join(",") || "none"}`,
        `amounts=${entry.targetAmountLevels.join(",") || "none"}`,
      ].join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
