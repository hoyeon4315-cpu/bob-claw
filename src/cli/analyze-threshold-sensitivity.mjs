#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";

const THRESHOLDS = [
  { label: "current", minProfitUsd: 0.3, minProfitPct: 0.005 },
  { label: "looser_0.10usd_0.10pct", minProfitUsd: 0.1, minProfitPct: 0.001 },
  { label: "looser_0.05usd_0.05pct", minProfitUsd: 0.05, minProfitPct: 0.0005 },
  { label: "tiny_0.01usd_0.01pct", minProfitUsd: 0.01, minProfitPct: 0.0001 },
];

const MAJOR_GAPS = new Set([
  "stale_src_gas_snapshot",
  "stale_dex_output_quote",
  "exact_src_execution_gas_not_estimated",
  "missing_src_token_price",
  "missing_dst_token_price",
  "missing_src_token_decimals",
  "missing_dst_token_decimals",
  "bitcoin_network_fee_not_modelled",
]);

const FRESHNESS_GAPS = new Set([
  "stale_src_gas_snapshot",
  "stale_dex_output_quote",
]);

function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function hasAnyGap(score, gapSet) {
  return (score.dataGaps || []).some((gap) => gapSet.has(gap));
}

function summarizeScores(scores, metric, thresholds) {
  return thresholds.map((threshold) => {
    const passing = scores.filter((score) => {
      const candidateUsd = score[metric.usdKey];
      const candidatePct = Number.isFinite(score[metric.pctKey])
        ? score[metric.pctKey]
        : pct(candidateUsd, score.inputUsd);
      return (
        Number.isFinite(candidateUsd) &&
        candidateUsd >= threshold.minProfitUsd &&
        Number.isFinite(candidatePct) &&
        candidatePct >= threshold.minProfitPct
      );
    });

    return {
      label: threshold.label,
      minProfitUsd: threshold.minProfitUsd,
      minProfitPct: threshold.minProfitPct,
      passCount: passing.length,
      passWithoutAnyGap: passing.filter((score) => (score.dataGaps || []).length === 0).length,
      passWithoutFreshnessGap: passing.filter((score) => !hasAnyGap(score, FRESHNESS_GAPS)).length,
      passWithoutMajorGap: passing.filter((score) => !hasAnyGap(score, MAJOR_GAPS)).length,
      sampleRoutes: passing.slice(0, 5).map((score) => ({
        routeKey: score.routeKey,
        amount: score.amount,
        usd: score[metric.usdKey],
        pct: Number.isFinite(score[metric.pctKey]) ? score[metric.pctKey] : pct(score[metric.usdKey], score.inputUsd),
        tradeReadiness: score.tradeReadiness,
        dataGaps: score.dataGaps || [],
      })),
    };
  });
}

function summarizeTriangularArb(report, thresholds) {
  const rows = (report.sweeps || []).flatMap((sweep) => sweep.results || []).filter((result) => result.ok);
  return thresholds.map((threshold) => {
    const minPct = threshold.minProfitPct * 100;
    const passing = rows.filter((row) => Number.isFinite(row.netPct) && row.netPct >= minPct);
    const best = [...passing].sort((left, right) => right.netPct - left.netPct)[0] || null;
    return {
      label: threshold.label,
      minPct,
      passCount: passing.length,
      bestRoute: best
        ? {
            label: best.label,
            netPct: best.netPct,
            netProfitUsd: best.netProfit,
          }
        : null,
    };
  });
}

function buildConclusion({ effectiveSystemSummary, triangularSummary }) {
  const currentEffective = effectiveSystemSummary.find((item) => item.label === "current");
  const loosestEffective = effectiveSystemSummary.at(-1);
  const currentTriangle = triangularSummary.find((item) => item.label === "current");
  const looseTriangle = triangularSummary.find((item) => item.label === "looser_0.10usd_0.10pct");

  const lines = [];
  if ((currentEffective?.passCount || 0) === 0 && (loosestEffective?.passCount || 0) === 0) {
    lines.push("Gateway score candidates do not become actionable even under tiny profit thresholds because effective system PnL never turns positive.");
  } else if ((currentEffective?.passCount || 0) === 0) {
    lines.push("Looser thresholds create paper candidates, but the current policy is still filtering them out.");
  } else {
    lines.push("At least one Gateway candidate passes the current effective system threshold.");
  }

  if ((currentTriangle?.passCount || 0) === 0 && (looseTriangle?.passCount || 0) > 0) {
    lines.push("Triangular arb looks small-positive under a looser 0.10% floor, but still does not meet the repo's current 0.50% policy.");
  }

  return lines;
}

async function main() {
  const dataDir = config.dataDir;
  const scoreReport = await readJson(join(dataDir, "gateway-scores.json"));
  const triangularReport = await readJson(join(dataDir, "triangular-arb-sim.json")).catch(() => null);
  const scores = scoreReport.scores || [];

  const referenceSummary = summarizeScores(
    scores,
    { usdKey: "netEdgeUsd", pctKey: "netEdgePct" },
    THRESHOLDS,
  );
  const executableSummary = summarizeScores(
    scores,
    { usdKey: "executableNetEdgeUsd", pctKey: "executableNetEdgePct" },
    THRESHOLDS,
  );
  const effectiveSystemSummary = summarizeScores(
    scores,
    { usdKey: "effectiveSystemNetPnlUsd", pctKey: "effectiveSystemNetPnlPct" },
    THRESHOLDS,
  );
  const triangularSummary = triangularReport ? summarizeTriangularArb(triangularReport, THRESHOLDS) : [];

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scoreObservedAt: scoreReport.generatedAt || null,
    thresholdGrid: THRESHOLDS,
    gateway: {
      totalScores: scores.length,
      referenceSummary,
      executableSummary,
      effectiveSystemSummary,
    },
    triangularArb: triangularSummary.length > 0 ? triangularSummary : null,
    conclusion: buildConclusion({ effectiveSystemSummary, triangularSummary }),
  };

  await mkdir(dataDir, { recursive: true });
  const outputPath = join(dataDir, "threshold-sensitivity.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`wrote=${outputPath}`);
  console.log(`scoreObservedAt=${report.scoreObservedAt || "n/a"}`);
  for (const item of effectiveSystemSummary) {
    console.log(
      `effective ${item.label} pass=${item.passCount} noGap=${item.passWithoutAnyGap} noFreshGap=${item.passWithoutFreshnessGap} noMajorGap=${item.passWithoutMajorGap}`,
    );
  }
  if (triangularSummary.length > 0) {
    for (const item of triangularSummary) {
      console.log(`triangle ${item.label} pass=${item.passCount} best=${item.bestRoute?.netPct ?? "n/a"}%`);
    }
  }
  for (const line of report.conclusion) {
    console.log(`note=${line}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
