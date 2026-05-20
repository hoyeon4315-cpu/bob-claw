#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildMultiFamilyGatewayArbitrageSummary } from "../strategy/dex-gateway-arbitrage.mjs";

const SUPPORTED_FAMILIES = ["wbtc", "stable", "gold"];
const OUTPUT_FILENAME = "gateway-multi-family-arbitrage-latest.json";

function parseArgs(argv) {
  const flags = new Set();
  const families = [];
  for (const token of argv) {
    if (token === "--json" || token === "--write") {
      flags.add(token);
    } else if (token.startsWith("--families=")) {
      const value = token.slice("--families=".length);
      for (const family of value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)) {
        if (!SUPPORTED_FAMILIES.includes(family)) {
          throw new Error(`unsupported family '${family}'. supported=${SUPPORTED_FAMILIES.join(",")}`);
        }
        families.push(family);
      }
    } else if (token === "--help" || token === "-h") {
      flags.add("--help");
    } else {
      throw new Error(`unknown argument '${token}'`);
    }
  }
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    help: flags.has("--help"),
    families: families.length ? families : null,
  };
}

function printHelp() {
  console.log(`Usage: node src/cli/report-gateway-multi-family-arbitrage.mjs [--json] [--write] [--families=wbtc,stable,gold]

Report-only multi-family Gateway arbitrage comparator. Compares wBTC, stable,
and tokenized-gold loop candidates under the same full-cost scanner formula:

  measuredLoopNetUsd =
    destinationExecutableUsd - entryStableUsd - gatewayKnownCostUsd - entryGasUsd

Inputs:
  data/gateway-scores.json     (latest score snapshot)
  data/dex-quotes.jsonl        (latest gateway_src_entry_leg quotes)

Outputs:
  stdout summary (one row per family)
  --json     full JSON report on stdout
  --write    persist to data/${OUTPUT_FILENAME}

This CLI is report-only. It does not mutate live state or dashboard surfaces.`);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function formatUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(Math.abs(value) >= 1 ? 4 : 6)}` : "n/a";
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(value) : "0";
}

function formatPct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(3)}%` : "n/a";
}

function printSummary(summary) {
  console.log(`generatedAt=${summary.generatedAt || "n/a"}`);
  console.log(`families=${summary.requestedFamilies.join(",")}`);
  console.log("");
  console.log(
    "family | routes | exact | profitable | best.measuredLoopNetUsd | closest.routeKey | closest.amountGapPct",
  );
  for (const row of summary.families) {
    const best = row.bestLoop || null;
    const closest = row.closestLoop || null;
    console.log(
      [
        row.family.padEnd(6),
        formatNumber(row.routeCount).padStart(6),
        formatNumber(row.exactAmountMatchCount).padStart(5),
        formatNumber(row.profitableExactCount).padStart(10),
        formatUsd(best?.measuredLoopNetUsd).padStart(24),
        (closest?.routeKey || "n/a").padEnd(40),
        formatPct(closest?.amountGapPct),
      ].join(" | "),
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [scoreSnapshot, dexQuotes] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonl(config.dataDir, "dex-quotes"),
  ]);

  const summary = buildMultiFamilyGatewayArbitrageSummary(
    { scoreSnapshot: scoreSnapshot || null, dexQuotes: dexQuotes || [] },
    { families: args.families || SUPPORTED_FAMILIES },
  );

  let outputPath = null;
  if (args.write) {
    outputPath = join(config.dataDir, OUTPUT_FILENAME);
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify({ summary, outputPath }, null, 2));
    return;
  }

  printSummary(summary);
  if (outputPath) console.log(`wrote=${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
