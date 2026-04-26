#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildAutonomousDiscoveryBoard, filterOfficialGatewayRoutes } from "../strategy/autonomous-discovery-board.mjs";
import { buildDexRouteUniverseSummary, buildEthRouteUniverseSummary } from "../strategy/dex-route-universe.mjs";

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
  const [deterministicStrategyCandidates, destinationResearchQueue, destinationPromotionGate, routeRecords, iterationRecords] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "deterministic-strategy-candidates.json")),
    readJsonIfExists(join(config.dataDir, "destination-research-queue.json")),
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "autonomous-discovery-board-runs"),
  ]);
  const latestRoutesRecord = routeRecords.at(-1) || null;
  const gatewayRoutes = filterOfficialGatewayRoutes(latestRoutesRecord?.routes || []);
  const btcRouteUniverse = buildDexRouteUniverseSummary({
    routes: gatewayRoutes,
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  const ethRouteUniverse = buildEthRouteUniverseSummary({
    routes: gatewayRoutes,
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  const report = buildAutonomousDiscoveryBoard({
    deterministicStrategyCandidates,
    destinationResearchQueue,
    destinationPromotionGate,
    btcRouteUniverse,
    ethRouteUniverse,
    gatewayRoutes,
    iterationRecords,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "autonomous-discovery-board.json");
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

  console.log(`opportunities=${report.summary?.opportunityCount ?? 0}`);
  console.log(`readyNow=${report.summary?.readyNowCount ?? 0}`);
  console.log(`deterministic=${report.summary?.deterministicCount ?? 0}`);
  console.log(`destination=${report.summary?.destinationCount ?? 0}`);
  console.log(`routeGaps=${report.summary?.routeGapCount ?? 0}`);
  console.log(`routeDevelopment=${report.summary?.routeDevelopmentCount ?? 0}`);
  console.log(`keep=${report.summary?.keepCount ?? 0}`);
  console.log(`discard=${report.summary?.discardCount ?? 0}`);
  console.log(`topOpportunity=${report.summary?.topOpportunityId || "n/a"}`);
  console.log(`nextAction=${report.summary?.nextAction?.code || "n/a"}`);
  console.log(`paperPnlBtc=${report.summary?.pnl?.paper?.btc ?? "n/a"} paperPnlUsd=${report.summary?.pnl?.paper?.usdProjection ?? "n/a"} paperPnlStatus=${report.summary?.pnl?.paper?.status || "n/a"}`);
  console.log(`estimatedPnlBtc=${report.summary?.pnl?.estimated?.btc ?? "n/a"} estimatedPnlUsd=${report.summary?.pnl?.estimated?.usdProjection ?? "n/a"} estimatedPnlStatus=${report.summary?.pnl?.estimated?.status || "n/a"}`);
  console.log(`realizedPnlBtc=${report.summary?.pnl?.realized?.btc ?? "n/a"} realizedPnlUsd=${report.summary?.pnl?.realized?.usdProjection ?? "n/a"} realizedPnlStatus=${report.summary?.pnl?.realized?.status || "n/a"}`);
  for (const item of (report.opportunities || []).slice(0, 5)) {
    console.log(
      `${item.selectionRank || "n/a"} ${item.id} lane=${item.lane} status=${item.status} score=${item.priorityScore} selection=${item.selectionScore} keep=${item.researchLoop?.keepScore ?? "n/a"} discard=${item.researchLoop?.discardScore ?? "n/a"}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
