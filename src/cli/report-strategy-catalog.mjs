#!/usr/bin/env node

import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildStrategyCatalog } from "../strategy/strategy-catalog.mjs";

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
  };
}

function printEntries(title, entries) {
  console.log(`\n${title}`);
  for (const entry of entries) {
    console.log(`- ${entry.label}: ${entry.status}`);
    if (entry.reason) console.log(`  reason: ${entry.reason}`);
    if (entry.ethApplicability) console.log(`  ETH applicability: ${entry.ethApplicability.classification}`);
    if (entry.evidence?.bestRoute) console.log(`  best route: ${entry.evidence.bestRoute}`);
    if (entry.evidence?.bestNetPct != null) console.log(`  best net: ${entry.evidence.bestNetPct}%`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts } = await buildCurrentDashboardContext();
  const catalog = buildStrategyCatalog({ dashboardStatus, state, triangleArtifacts });

  if (args.json) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }

  console.log("BOB Claw Strategy Catalog");
  console.log(`generated: ${catalog.generatedAt}`);
  console.log(`liveTrading: ${catalog.policy.liveTrading}`);
  console.log(`ethereumL1: ${catalog.policy.ethereumL1}`);
  console.log(`flash live: ${catalog.policy.flashLiveAdmission}`);
  console.log(`odos trust: ${catalog.policy.odosExecutionTrust}`);

  printEntries("BTC families", catalog.btcFamilies);
  printEntries("ETH branches", catalog.ethBranches);

  console.log("\nShared infrastructure");
  for (const item of catalog.sharedInfrastructure) {
    console.log(`- ${item.kind}: ${item.surfaces.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
