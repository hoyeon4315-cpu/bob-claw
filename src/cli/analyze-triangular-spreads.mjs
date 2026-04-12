#!/usr/bin/env node

/**
 * Analyze Triangular Spread Samples — processes time-series data
 * to identify profitable windows and optimal execution conditions.
 *
 * Usage:
 *   node src/cli/analyze-triangular-spreads.mjs              # full analysis
 *   node src/cli/analyze-triangular-spreads.mjs --json       # JSON output
 *   node src/cli/analyze-triangular-spreads.mjs --hours=24   # last N hours only
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");
const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const flags = new Set(argv.filter(a => a.startsWith("--") && !a.includes("=")));
  const options = Object.fromEntries(
    argv.filter(a => a.startsWith("--") && a.includes("=")).map(a => {
      const [key, ...rest] = a.slice(2).split("=");
      return [key, rest.join("=")];
    })
  );
  return {
    hours: parseFloat(options.hours || "0"),
    json: flags.has("--json"),
    policyMinPct: parseFloat(options["policy-min"] || "0.5"),
    minProfitUsd: parseFloat(options["min-profit-usd"] || "0.30"),
  };
}

async function readSamples(hours) {
  const path = join(DATA_DIR, "triangular-spread-samples.jsonl");
  let raw;
  try { raw = await readFile(path, "utf8"); } catch { return []; }

  const cutoff = hours > 0 ? Date.now() - hours * 3600_000 : 0;
  return raw.trim().split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(s => s && s.observedAt && (!cutoff || new Date(s.observedAt).getTime() >= cutoff));
}

function analyzeDistribution(values) {
  if (!values.length) return { count: 0, min: null, max: null, mean: null, median: null, p75: null, p90: null, p95: null, stddev: null };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: round(mean),
    median: round(sorted[Math.floor(n / 2)]),
    p75: round(sorted[Math.floor(n * 0.75)]),
    p90: round(sorted[Math.floor(n * 0.9)]),
    p95: round(sorted[Math.floor(n * 0.95)]),
    stddev: round(Math.sqrt(variance)),
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }

function analyzeRoutes(samples) {
  const routeMap = new Map();

  for (const sample of samples) {
    if (!sample.triangular) continue;
    for (const route of sample.triangular) {
      if (!route.ok) continue;
      const label = route.label;
      if (!routeMap.has(label)) routeMap.set(label, []);
      routeMap.get(label).push({
        observedAt: sample.observedAt,
        netPct: route.netPct,
        netAfterFlashPct: route.netAfterFlashPct,
        netAfterFlash: route.netAfterFlash,
        netProfit: route.netProfit,
        totalGas: route.totalGas,
      });
    }
  }

  const results = [];
  for (const [label, entries] of routeMap) {
    const netPcts = entries.map(e => e.netPct);
    const flashPcts = entries.map(e => e.netAfterFlashPct);
    const profitUsd = entries.map(e => e.netProfit);
    const flashUsd = entries.map(e => e.netAfterFlash);

    results.push({
      label,
      sampleCount: entries.length,
      netPctDist: analyzeDistribution(netPcts),
      flashPctDist: analyzeDistribution(flashPcts),
      profitUsdDist: analyzeDistribution(profitUsd),
      flashUsdDist: analyzeDistribution(flashUsd),
      profitableCount: entries.filter(e => e.netProfit > 0).length,
      profitableAfterFlash: entries.filter(e => e.netAfterFlash > 0).length,
      profitablePct: round(entries.filter(e => e.netProfit > 0).length / entries.length * 100),
    });
  }

  return results.sort((a, b) => (b.netPctDist.median ?? 0) - (a.netPctDist.median ?? 0));
}

function analyzePairSpreads(samples) {
  const pairMap = new Map();

  for (const sample of samples) {
    if (!sample.pairwise) continue;
    for (const pair of sample.pairwise) {
      if (!pair.ok) continue;
      const key = `${pair.from}→${pair.to}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key).push({ observedAt: sample.observedAt, spreadPct: pair.spreadPct });
    }
  }

  const results = [];
  for (const [key, entries] of pairMap) {
    const spreads = entries.map(e => e.spreadPct);
    results.push({ pair: key, ...analyzeDistribution(spreads) });
  }
  return results.sort((a, b) => Math.abs(b.median ?? 0) - Math.abs(a.median ?? 0));
}

function analyzeHourlyBuckets(samples) {
  const buckets = new Map();
  for (const sample of samples) {
    if (!sample.summary?.bestNetPct) continue;
    const hour = new Date(sample.observedAt).getUTCHours();
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(sample.summary.bestNetPct);
  }

  return [...buckets.entries()]
    .map(([hour, values]) => ({ hour, ...analyzeDistribution(values) }))
    .sort((a, b) => (b.median ?? 0) - (a.median ?? 0));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const samples = await readSamples(args.hours);

  if (!samples.length) {
    console.log("No triangular spread samples found. Run: npm run collect:triangular-spreads -- --once");
    return;
  }

  const ts = new Date().toISOString();
  const timeRange = {
    from: samples[0].observedAt,
    to: samples[samples.length - 1].observedAt,
    hours: round((new Date(samples[samples.length - 1].observedAt) - new Date(samples[0].observedAt)) / 3600_000),
  };

  const routes = analyzeRoutes(samples);
  const pairSpreads = analyzePairSpreads(samples);
  const hourly = analyzeHourlyBuckets(samples);

  // Opportunity analysis
  const allBestPcts = samples.filter(s => s.summary?.bestNetPct != null).map(s => s.summary.bestNetPct);
  const bestDist = analyzeDistribution(allBestPcts);
  const policyHits = allBestPcts.filter(p => p >= args.policyMinPct).length;
  const profitableHits = allBestPcts.filter(p => p > 0).length;

  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: ts,
    timeRange,
    sampleCount: samples.length,
    policy: { minPct: args.policyMinPct, minUsd: args.minProfitUsd },
    overallBest: bestDist,
    policyHitCount: policyHits,
    policyHitPct: round(policyHits / allBestPcts.length * 100),
    profitableHitCount: profitableHits,
    profitableHitPct: round(profitableHits / allBestPcts.length * 100),
    routeAnalysis: routes,
    pairSpreadAnalysis: pairSpreads,
    hourlyAnalysis: hourly,
    verdict: policyHits > 0
      ? `policy_opportunity_detected — ${policyHits}/${allBestPcts.length} samples meet ${args.policyMinPct}% threshold`
      : bestDist.max >= args.policyMinPct * 0.5
        ? `near_policy — best observed ${bestDist.max}% is within 2x of ${args.policyMinPct}% target`
        : `no_opportunity — best observed ${bestDist.max}% is far from ${args.policyMinPct}% target`,
  };

  await writeFile(join(DATA_DIR, "triangular-spread-analysis.json"), JSON.stringify(report, null, 2));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Pretty print
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  Triangular Spread Analysis                          ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`  Samples: ${samples.length} | Range: ${timeRange.hours}h | ${timeRange.from.slice(0,16)} → ${timeRange.to.slice(0,16)}`);
  console.log(`  Policy: ≥${args.policyMinPct}% net or ≥$${args.minProfitUsd}`);
  console.log();

  console.log(`── Best Route Distribution ──`);
  console.log(`  Mean: ${bestDist.mean}% | Median: ${bestDist.median}% | Max: ${bestDist.max}%`);
  console.log(`  P90: ${bestDist.p90}% | P95: ${bestDist.p95}%`);
  console.log(`  Profitable: ${profitableHits}/${allBestPcts.length} (${round(profitableHits/allBestPcts.length*100)}%)`);
  console.log(`  Policy hits: ${policyHits}/${allBestPcts.length} (${round(policyHits/allBestPcts.length*100)}%)`);
  console.log();

  console.log(`── Route Rankings ──`);
  for (const r of routes.slice(0, 6)) {
    console.log(`  ${r.label.padEnd(28)} median=${r.netPctDist.median}% max=${r.netPctDist.max}% p95=${r.netPctDist.p95}% profitable=${r.profitablePct}%`);
  }
  console.log();

  console.log(`── Pair Spreads ──`);
  for (const p of pairSpreads) {
    console.log(`  ${p.pair.padEnd(16)} median=${p.median}% max=${p.max}% min=${p.min}% stddev=${p.stddev}%`);
  }
  console.log();

  if (hourly.length) {
    console.log(`── Best Hours (UTC) ──`);
    for (const h of hourly.slice(0, 5)) {
      console.log(`  ${String(h.hour).padStart(2, "0")}:00  median=${h.median}% max=${h.max}% samples=${h.count}`);
    }
    console.log();
  }

  console.log(`── Verdict ──`);
  console.log(`  ${report.verdict}`);
  console.log();
}

main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
