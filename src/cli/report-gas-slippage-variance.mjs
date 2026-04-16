#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  buildGasSlippageVarianceArtifact,
  summarizeGasSlippageVarianceArtifact,
} from "../risk/gas-slippage-variance.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(4)}` : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [state, receiptRecords] = await Promise.all([
    loadCanaryState({ dataDir: config.dataDir }),
    readJsonl(config.dataDir, "receipt-reconciliations"),
  ]);

  const artifact = buildGasSlippageVarianceArtifact({
    shadowObservations: state.shadowObservations || [],
    receiptRecords,
    scores: state.scoreSnapshot?.scores || [],
    now: state.scoreSnapshot?.generatedAt || new Date().toISOString(),
  });
  const summary = summarizeGasSlippageVarianceArtifact(artifact);

  if (args.write) {
    const outputPath = join(config.dataDir, "gas-slippage-variance-latest.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  console.log(`routeVariants=${summary?.routeVariantCount ?? 0}`);
  console.log(`varianceReadyRoutes=${summary?.varianceReadyRouteCount ?? 0}`);
  console.log(`shadowBackedRoutes=${summary?.shadowBackedRouteCount ?? 0}`);
  console.log(`receiptBackedRoutes=${summary?.receiptBackedRouteCount ?? 0}`);
  if (summary?.topVarianceRoute) {
    console.log(
      `topVariance=${summary.topVarianceRoute.routeKey || "n/a"} amount=${summary.topVarianceRoute.amount || "n/a"} noiseFloor=${money(summary.topVarianceRoute.policyNoiseFloorUsd)} centerNet=${money(summary.topVarianceRoute.centerNetUsd)}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
