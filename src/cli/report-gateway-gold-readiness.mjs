#!/usr/bin/env node

import { config } from "../config/env.mjs";
import {
  evaluateGatewayGoldRouteReadiness,
  writeGatewayGoldReadinessReport,
} from "../strategy/gateway-gold-route-readiness.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function printSummary(report) {
  console.log(`observedAt=${report.observedAt}`);
  console.log(`routeAvailable=${report.routeAvailable}`);
  console.log(`bestGoldAsset=${report.bestGoldAsset || "null"}`);
  console.log(`blocker=${report.blocker || "none"}`);
  console.log(`roundTripCostBtc=${report.roundTripCostBtc ?? "n/a"}`);
  console.log(`roundTripCostUsd=${report.roundTripCostUsd ?? "n/a"}`);
  console.log(`slippageBps=${report.slippageBps ?? "n/a"}`);
  console.log(`minViableCanarySizeSats=${report.minViableCanarySizeSats ?? "n/a"}`);
  console.log(`liveEligible=${report.liveEligible === true ? "true" : "false"}`);
  const preflight = report.preflight || {};
  console.log(
    `preflight attempted=${preflight.attempted === true ? "true" : "false"} successful=${preflight.successfulAttemptCount ?? 0} pairs=${preflight.attemptedPairCount ?? 0}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await evaluateGatewayGoldRouteReadiness({
    gatewayApiBase: config.gatewayApiBase,
  });

  let outputPath = null;
  if (args.write) {
    outputPath = await writeGatewayGoldReadinessReport({
      dataDir: config.dataDir,
      report,
    });
  }

  if (args.json) {
    console.log(JSON.stringify({ report, outputPath }, null, 2));
    return;
  }

  printSummary(report);
  if (outputPath) console.log(`wrote=${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
