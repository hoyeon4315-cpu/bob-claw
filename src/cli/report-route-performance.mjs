#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildDefaultRoutePerformancePolicy, buildRoutePerformanceRanking } from "../risk/route-performance.mjs";

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

function formatUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value >= 1 ? 4 : 6)}` : "n/a";
}

function formatPct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [receiptRecords, quotes, quoteFailures, scoreSnapshot] = await Promise.all([
    readJsonl(config.dataDir, "receipt-reconciliations"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
  ]);

  const ranking = buildRoutePerformanceRanking({
    receiptRecords,
    quotes,
    quoteFailures,
    scores: scoreSnapshot?.scores || [],
    policy: buildDefaultRoutePerformancePolicy(),
  });

  if (args.write) {
    const path = join(config.dataDir, "route-performance.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(ranking, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(ranking, null, 2));
    return;
  }

  console.log(`routeVariants=${ranking.summary.routeVariantCount}`);
  console.log(`enabledReviewOnly=${ranking.summary.enabledCount}`);
  console.log(`disabled=${ranking.summary.disabledCount}`);
  console.log(`withRealizedData=${ranking.summary.realizedRouteCount}`);

  for (const route of ranking.routes.slice(0, 10)) {
    console.log("");
    console.log(`${route.routeKey || "unknown"} amount=${route.amount || "n/a"}`);
    console.log(
      `  state=${route.enabledState} realizedSamples=${route.realizedSampleCount} quoteSuccess=${formatPct(route.quoteSuccessRate)} current=${route.currentTradeReadiness || "n/a"}`,
    );
    console.log(
      `  realizedMedian=${formatUsd(route.realizedMedianPnlUsd)} realizedTotal=${formatUsd(route.realizedTotalPnlUsd)} p95Loss=${formatUsd(route.routeP95LossUsd)} fillDrift=${Number.isFinite(route.medianFillDriftBps) ? route.medianFillDriftBps.toFixed(2) : "n/a"}bps`,
    );
    console.log(
      `  currentNet=${formatUsd(route.currentEstimatedNetEdgeUsd)} execNet=${formatUsd(route.currentExecutableNetEdgeUsd)} knownCost=${formatUsd(route.currentKnownCostUsd)} latencyP50=${route.quoteLatencyP50Ms ?? "n/a"} latencyP95=${route.quoteLatencyP95Ms ?? "n/a"}`,
    );
    if (route.rejectionReasons.length) {
      console.log(`  reasons=${route.rejectionReasons.join(",")}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
