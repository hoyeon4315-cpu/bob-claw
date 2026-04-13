#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildEdgeViabilitySummary } from "../strategy/edge-viability.mjs";
import { buildEdgeResearchSummary } from "../strategy/edge-research.mjs";
import { buildNoEdgePersistenceSummary } from "../strategy/no-edge-persistence.mjs";
import { buildRouteEconomicsAudit } from "../strategy/route-economics-audit.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    address: options.address || null,
    limit: options.limit ? Number(options.limit) : 5,
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
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function compactReasons(reasons = []) {
  return reasons.map((item) => `${item.reason}:${item.count}`).join(",") || "none";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  const [quotes, quoteFailures, shadowObservations, dexQuotes, readinessRecords, readinessFailures, scoreSnapshot, prices] = await Promise.all([
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonl(config.dataDir, "gateway-shadow-observations"),
    readJsonl(config.dataDir, "dex-quotes"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    getCoinGeckoPricesUsd().catch(() => null),
  ]);

  const plan = buildCanaryRoutePlan(
    {
      quotes,
      scores: scoreSnapshot?.scores || [],
      readinessRecords,
      readinessFailures,
    },
    {
      address: resolved.address,
      prices,
      limit: args.limit,
    },
  );
  const edgeViability = buildEdgeViabilitySummary({ scoreSnapshot: scoreSnapshot || null, dexQuotes });
  const edgeResearch = buildEdgeResearchSummary({ scoreSnapshot: scoreSnapshot || null, shadowObservations });
  const noEdgePersistence = buildNoEdgePersistenceSummary({ scoreSnapshot: scoreSnapshot || null, dexQuotes });
  const shadowEvidenceBoard = buildRouteEconomicsAudit({
    scoreSnapshot: scoreSnapshot || null,
    routePlan: plan,
    edgeViability,
    edgeResearch,
    noEdgePersistence,
    quotes,
    quoteFailures,
    shadowObservations,
  });

  if (args.json) {
    console.log(JSON.stringify({ ...plan, shadowEvidenceBoard }, null, 2));
    return;
  }

  console.log(`address=${plan.address}`);
  console.log(`routes=${plan.candidateCount} txReady=${plan.txReadyCount} viableForPrep=${plan.viableCount}`);
  console.log(
    `shadowEvidence strategy=${shadowEvidenceBoard.summary.strategyDecisionCode} dense=${shadowEvidenceBoard.summary.evidenceCounts.denseShadowCandidates} multiAmount=${shadowEvidenceBoard.summary.evidenceCounts.multiAmountCandidates} multiHour=${shadowEvidenceBoard.summary.evidenceCounts.multiHourCandidates}`,
  );
  for (const candidate of plan.topCandidates) {
    const candidateEvidence = shadowEvidenceBoard.candidateAudits.find(
      (item) => item.routeKey === candidate.routeKey && String(item.amount) === String(candidate.amount),
    ) || null;
    console.log("");
    console.log(`${candidate.label} amount=${candidate.amount}`);
    console.log(
      `  prep=${candidate.viableForPrep ? "viable" : "blocked"} txReady=${candidate.txReady} exactGas=${candidate.exactGasDone} readiness=${candidate.tradeReadiness || "none"}`,
    );
    if (candidate.prepBlockers.length) {
      console.log(`  blockers=${candidate.prepBlockers.join(",")}`);
    }
    if (candidate.readinessFailureReason) {
      console.log(`  failure=${candidate.readinessFailureReason}`);
    }
    if (candidate.scoreDisqualifiers.length) {
      console.log(`  scoreGaps=${candidate.scoreDisqualifiers.join(",")}`);
    }
    console.log(
      `  input=${formatUsd(candidate.inputUsd)} prepFunding=${formatUsd(candidate.prepFundingUsd)} nativeShortfall=${formatUsd(candidate.nativeShortfallUsd)} tokenShortfall=${formatUsd(candidate.tokenShortfallUsd)} netEdge=${formatUsd(candidate.netEdgeUsd)} execNet=${formatUsd(candidate.executableNetEdgeUsd)}`,
    );
    if (candidateEvidence?.evidence) {
      console.log(
        `  evidence=shadow:${candidateEvidence.evidence.shadowObservationCount}/${candidateEvidence.evidence.routeShadowObservationCount} quotes:${candidateEvidence.evidence.quoteSampleCount ?? 0}/${candidateEvidence.evidence.quoteAttemptCount} success:${formatPct(candidateEvidence.evidence.quoteSuccessRate)} p95=${candidateEvidence.evidence.quoteLatencyP95Ms ?? "n/a"}ms amountLevels=${candidateEvidence.evidence.routeAmountLevelCount} hourBuckets=${candidateEvidence.evidence.routeHourBucketCount}`,
      );
      console.log(
        `  verdict=${candidateEvidence.verdict} family=${candidateEvidence.routeFamilyVerdict || "n/a"} systemNet=${formatUsd(candidateEvidence.effectiveSystemNetPnlUsd)} measuredNet=${formatUsd(candidateEvidence.measuredLoopNetUsd)}`,
      );
      console.log(`  reasons=${compactReasons(candidateEvidence.evidence.rejectionReasons)}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
