#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { GatewayClient } from "../gateway/client.mjs";
import { buildNativeBtcOpportunitySurface } from "../strategy/native-btc-opportunity-surface.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new GatewayClient({ baseUrl: config.gatewayApiBase });
  const routesResult = await client.getRoutes();
  const strategySnapshot = await readJsonIfExists(join(config.dataDir, "strategy-snapshot.json"));
  const report = buildNativeBtcOpportunitySurface({
    routes: routesResult.body || [],
    strategySnapshot,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "native-btc-opportunity-surface.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`nativeBtcRoutes=${report.liveSurface.nativeBtcRouteCount}`);
  console.log(`wrappedBtcRoutes=${report.liveSurface.destinationFamilies.wrappedBtc}`);
  console.log(`stablecoinRoutes=${report.liveSurface.destinationFamilies.stablecoin}`);
  console.log(`ethLikeRoutes=${report.liveSurface.destinationFamilies.ethLike}`);
  console.log(`storeOfValueRoutes=${report.liveSurface.destinationFamilies.storeOfValue}`);
  console.log(`otherRoutes=${report.liveSurface.destinationFamilies.other}`);
  console.log(`wrappedBtcChains=${report.currentReality.directWrappedBtcChains.join(",") || "none"}`);
  console.log(`stablecoinChains=${report.currentReality.directStablecoinChains.join(",") || "none"}`);
  console.log(`ethLikeChains=${report.currentReality.directEthLikeChains.join(",") || "none"}`);
  console.log(`allStrategyFamilies=${report.allStrategyFamilies.length}`);
  console.log("");
  for (const family of report.rankedOpportunityFamilies) {
    console.log(
      `rank=${family.rank} id=${family.id} status=${family.status} liveRoutes=${family.liveRouteCount} support=${family.supportBreadthScore}`,
    );
  }
  console.log("");
  console.log(`missingFromLiveRoutes=${report.staleAssumptionsRemoved.missingFromLiveRoutes.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
