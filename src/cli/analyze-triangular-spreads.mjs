#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { getTriangleProfile, triangleDatasetNames } from "../flash/triangle-profiles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");
const SCHEMA_VERSION = 2;

function parseArgs(argv) {
  const flags = new Set(argv.filter((item) => item.startsWith("--") && !item.includes("=")));
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );

  return {
    hours: parseFloat(options.hours || "0"),
    json: flags.has("--json"),
    policyMinPct: parseFloat(options["policy-min"] || "0.5"),
    minProfitUsd: parseFloat(options["min-profit-usd"] || "0.30"),
    profile: options.profile,
  };
}

async function readSamples(fileName, hours) {
  const path = join(DATA_DIR, `${fileName}.jsonl`);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }

  const cutoff = hours > 0 ? Date.now() - hours * 3600_000 : 0;
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((sample) => sample && sample.observedAt && (!cutoff || new Date(sample.observedAt).getTime() >= cutoff));
}

function round(number) {
  return Math.round(number * 10000) / 10000;
}

function analyzeDistribution(values) {
  if (!values.length) {
    return { count: 0, min: null, max: null, mean: null, median: null, p75: null, p90: null, p95: null, stddev: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const count = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / count;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  return {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    mean: round(mean),
    median: round(sorted[Math.floor(count / 2)]),
    p75: round(sorted[Math.floor(count * 0.75)]),
    p90: round(sorted[Math.floor(count * 0.9)]),
    p95: round(sorted[Math.floor(count * 0.95)]),
    stddev: round(Math.sqrt(variance)),
  };
}

function analyzeRoutes(samples) {
  const routeMap = new Map();

  for (const sample of samples) {
    if (!sample.triangular) continue;
    for (const route of sample.triangular) {
      if (!route.ok) continue;
      if (!routeMap.has(route.label)) routeMap.set(route.label, []);
      routeMap.get(route.label).push({
        observedAt: sample.observedAt,
        netPct: route.netPct,
        netAfterFlashPct: route.netAfterFlashPct,
        netAfterFlash: route.netAfterFlash,
        netProfit: route.netProfit,
        totalGas: route.totalGas,
      });
    }
  }

  return [...routeMap.entries()]
    .map(([label, entries]) => ({
      label,
      sampleCount: entries.length,
      netPctDist: analyzeDistribution(entries.map((entry) => entry.netPct)),
      flashPctDist: analyzeDistribution(entries.map((entry) => entry.netAfterFlashPct)),
      profitUsdDist: analyzeDistribution(entries.map((entry) => entry.netProfit)),
      flashUsdDist: analyzeDistribution(entries.map((entry) => entry.netAfterFlash)),
      profitableCount: entries.filter((entry) => entry.netProfit > 0).length,
      profitableAfterFlash: entries.filter((entry) => entry.netAfterFlash > 0).length,
      profitablePct: round((entries.filter((entry) => entry.netProfit > 0).length / entries.length) * 100),
    }))
    .sort((left, right) => (right.netPctDist.median ?? 0) - (left.netPctDist.median ?? 0));
}

function analyzePairSpreads(samples) {
  const pairMap = new Map();

  for (const sample of samples) {
    if (!sample.pairwise) continue;
    for (const pair of sample.pairwise) {
      if (!pair.ok || !Number.isFinite(pair.spreadPct)) continue;
      const key = `${pair.from}→${pair.to}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key).push({ observedAt: sample.observedAt, spreadPct: pair.spreadPct });
    }
  }

  return [...pairMap.entries()]
    .map(([pair, entries]) => ({ pair, ...analyzeDistribution(entries.map((entry) => entry.spreadPct)) }))
    .sort((left, right) => Math.abs(right.median ?? 0) - Math.abs(left.median ?? 0));
}

function analyzeHourlyBuckets(samples) {
  const buckets = new Map();
  for (const sample of samples) {
    if (!sample.summary || sample.summary.bestNetPct == null) continue;
    const hour = new Date(sample.observedAt).getUTCHours();
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(sample.summary.bestNetPct);
  }

  return [...buckets.entries()]
    .map(([hour, values]) => ({ hour, ...analyzeDistribution(values) }))
    .sort((left, right) => (right.median ?? 0) - (left.median ?? 0));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getTriangleProfile(args.profile);
  const datasetNames = triangleDatasetNames(profile.id);
  const samples = await readSamples(datasetNames.sampleLogName, args.hours);

  if (!samples.length) {
    console.log(`No triangular spread samples found for ${profile.label}. Run: npm run collect:triangular-spreads -- --once --profile=${profile.id}`);
    return;
  }

  const generatedAt = new Date().toISOString();
  const timeRange = {
    from: samples[0].observedAt,
    to: samples[samples.length - 1].observedAt,
    hours: round((new Date(samples[samples.length - 1].observedAt) - new Date(samples[0].observedAt)) / 3600_000),
  };

  const routeAnalysis = analyzeRoutes(samples);
  const pairSpreadAnalysis = analyzePairSpreads(samples);
  const hourlyAnalysis = analyzeHourlyBuckets(samples);
  const allBestPcts = samples.filter((sample) => sample.summary?.bestNetPct != null).map((sample) => sample.summary.bestNetPct);
  const overallBest = analyzeDistribution(allBestPcts);
  const policyHitCount = allBestPcts.filter((value) => value >= args.policyMinPct).length;
  const profitableHitCount = allBestPcts.filter((value) => value > 0).length;
  const bestDisplay = overallBest.max == null ? "N/A" : `${overallBest.max}%`;

  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    profileId: profile.id,
    profileLabel: profile.label,
    timeRange,
    sampleCount: samples.length,
    policy: { minPct: args.policyMinPct, minUsd: args.minProfitUsd },
    overallBest,
    policyHitCount,
    policyHitPct: allBestPcts.length ? round((policyHitCount / allBestPcts.length) * 100) : 0,
    profitableHitCount,
    profitableHitPct: allBestPcts.length ? round((profitableHitCount / allBestPcts.length) * 100) : 0,
    routeAnalysis,
    pairSpreadAnalysis,
    hourlyAnalysis,
    verdict:
      policyHitCount > 0
        ? `policy_opportunity_detected — ${policyHitCount}/${allBestPcts.length} samples meet ${args.policyMinPct}% threshold`
        : (overallBest.max ?? Number.NEGATIVE_INFINITY) >= args.policyMinPct * 0.5
          ? `near_policy — best observed ${bestDisplay} is within 2x of ${args.policyMinPct}% target`
          : `no_opportunity — best observed ${bestDisplay} is far from ${args.policyMinPct}% target`,
  };

  await writeFile(join(DATA_DIR, datasetNames.analysisFileName), JSON.stringify(report, null, 2));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  Triangular Spread Analysis — ${profile.label.padEnd(17)}║`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Samples: ${samples.length} | Range: ${timeRange.hours}h | ${timeRange.from.slice(0, 16)} → ${timeRange.to.slice(0, 16)}`);
  console.log(`  Policy: ≥${args.policyMinPct}% net or ≥$${args.minProfitUsd}`);
  console.log("");

  console.log("── Best Route Distribution ──");
  console.log(`  Mean: ${overallBest.mean}% | Median: ${overallBest.median}% | Max: ${overallBest.max}%`);
  console.log(`  P90: ${overallBest.p90}% | P95: ${overallBest.p95}%`);
  console.log(
    `  Profitable: ${profitableHitCount}/${allBestPcts.length} (${allBestPcts.length ? round((profitableHitCount / allBestPcts.length) * 100) : 0}%)`,
  );
  console.log(`  Policy hits: ${policyHitCount}/${allBestPcts.length} (${report.policyHitPct}%)`);
  console.log("");

  console.log("── Route Rankings ──");
  for (const route of routeAnalysis.slice(0, 6)) {
    console.log(
      `  ${route.label.padEnd(28)} median=${route.netPctDist.median}% max=${route.netPctDist.max}% ` +
        `p95=${route.netPctDist.p95}% profitable=${route.profitablePct}%`,
    );
  }
  console.log("");

  if (pairSpreadAnalysis.length) {
    console.log("── Pair Spreads ──");
    for (const spread of pairSpreadAnalysis) {
      console.log(
        `  ${spread.pair.padEnd(16)} median=${spread.median}% max=${spread.max}% min=${spread.min}% stddev=${spread.stddev}%`,
      );
    }
    console.log("");
  }

  if (hourlyAnalysis.length) {
    console.log("── Best Hours (UTC) ──");
    for (const hour of hourlyAnalysis.slice(0, 5)) {
      console.log(`  ${String(hour.hour).padStart(2, "0")}:00  median=${hour.median}% max=${hour.max}% samples=${hour.count}`);
    }
    console.log("");
  }

  console.log("── Verdict ──");
  console.log(`  ${report.verdict}`);
  console.log("");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
