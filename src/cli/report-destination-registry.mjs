#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationStrategyRegistry } from "../strategy/destination-registry.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nativeSurfacePath = join(config.dataDir, "native-btc-opportunity-surface.json");
  const nativeBtcSurface = await readJson(nativeSurfacePath);
  const report = buildDestinationStrategyRegistry({ nativeBtcSurface });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-strategy-registry.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`chains=${report.summary.chainCount}`);
  console.log(`chainStrategies=${report.summary.chainStrategyCount}`);
  console.log(`globalStrategies=${report.summary.globalStrategyCount}`);
  console.log(`pendingReview=${report.summary.pendingReviewCount}`);
  console.log("");
  for (const chain of report.chains) {
    console.log(`${chain.chain}: routes=${chain.liveRouteCount} strategies=${chain.strategies.length} assets=${chain.arrivalAssets.join(",") || "none"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
