#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildEthereumRouteAnalysis, formatEthereumRouteAnalysis } from "../strategy/ethereum-route-analysis.mjs";

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
  const [routeRecords, quotes, failures, dexQuotes, shadowObservations, scoreSnapshot] = await Promise.all([
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonl(config.dataDir, "dex-quotes"),
    readJsonl(config.dataDir, "gateway-shadow-observations"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
  ]);

  const analysis = buildEthereumRouteAnalysis({
    routesRecord: routeRecords.at(-1) || null,
    routeRecords,
    quotes,
    failures,
    dexQuotes,
    scores: scoreSnapshot?.scores || [],
    shadowObservations,
  });

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "ethereum-route-analysis.json"),
      `${JSON.stringify(analysis, null, 2)}\n`,
    );
  }

  if (args.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  console.log(formatEthereumRouteAnalysis(analysis));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
