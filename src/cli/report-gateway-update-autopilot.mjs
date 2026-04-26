#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { summarizeGatewayUpdateAutopilotRuns } from "../strategy/gateway-update-autopilot.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runs = await readJsonl(config.dataDir, "gateway-update-autopilot-runs");
  const summary = summarizeGatewayUpdateAutopilotRuns(runs);
  const latest = (await readJsonIfExists(join(config.dataDir, "gateway-update-autopilot-latest.json"))) || summary;

  if (args.write) {
    const outputPath = join(config.dataDir, "gateway-update-autopilot.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(latest, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  if (args.json) {
    console.log(JSON.stringify(latest, null, 2));
    return;
  }

  console.log(`executionMode=${latest.executionMode}`);
  console.log(`runs=${latest.runCount}`);
  console.log(`latestExecutionStatus=${latest.latestExecutionStatus || "none"}`);
  console.log(`latestUpdateDetected=${latest.latestUpdateDetected}`);
  console.log(`changeReasons=${latest.latestChangeReasons.join(",") || "none"}`);
  console.log(`routeHash=${latest.latestRouteHash || "none"}`);
  console.log(`supportedRoutes=${latest.latestSupportedSurface?.supportedRouteCount ?? 0} ignoredRoutes=${latest.latestSupportedSurface?.ignoredRouteCount ?? 0}`);
  console.log(`unsupportedChains=${latest.latestSupportedSurface?.unsupportedChains?.join(",") || "none"}`);
  console.log(`autonomousDiscovery opportunities=${latest.latestAutonomousDiscoveryBoard?.opportunityCount ?? 0} readyNow=${latest.latestAutonomousDiscoveryBoard?.readyNowCount ?? 0} top=${latest.latestAutonomousDiscoveryBoard?.topOpportunity?.id || "n/a"} next=${latest.latestAutonomousDiscoveryBoard?.nextAction?.code || "n/a"}`);
  console.log(`paperPnlBtc=${latest.pnl?.paper?.btc ?? "n/a"} paperPnlUsd=${latest.pnl?.paper?.usdProjection ?? "n/a"} paperPnlStatus=${latest.pnl?.paper?.status || "n/a"}`);
  console.log(`estimatedPnlBtc=${latest.pnl?.estimated?.btc ?? "n/a"} estimatedPnlUsd=${latest.pnl?.estimated?.usdProjection ?? "n/a"} estimatedPnlStatus=${latest.pnl?.estimated?.status || "n/a"}`);
  console.log(`realizedPnlBtc=${latest.pnl?.realized?.btc ?? "n/a"} realizedPnlUsd=${latest.pnl?.realized?.usdProjection ?? "n/a"} realizedPnlStatus=${latest.pnl?.realized?.status || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
