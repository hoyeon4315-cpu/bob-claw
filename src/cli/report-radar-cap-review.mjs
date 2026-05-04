#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { appendRadarJsonl, readRadarJsonl } from "../strategy/radar/jsonl.mjs";
import { buildRadarCapGraduationReview } from "../strategy/radar/cap-graduation-review.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    args[rawKey] = value;
  }
  return args;
}

function capRaiseCandidateIntent(candidate = {}, now = new Date().toISOString()) {
  const currentCap = Number(candidate.currentTinyLivePerTxUsd);
  const suggestedCap = Number(candidate.suggestedNextTinyLivePerTxUsd);
  return {
    intentId: [
      "radar_cap_raise_candidate",
      candidate.strategyId || candidate.key || "unknown",
      Number.isFinite(currentCap) ? currentCap : "na",
      Number.isFinite(suggestedCap) ? suggestedCap : "na",
    ].join(":"),
    intentType: "capRaiseCandidate",
    generatedAt: now,
    strategyId: candidate.strategyId || null,
    familyKey: candidate.familyKey || null,
    candidateKey: candidate.key || null,
    currentTinyLivePerTxUsd: Number.isFinite(currentCap) ? currentCap : null,
    suggestedNextTinyLivePerTxUsd: Number.isFinite(suggestedCap) ? suggestedCap : null,
    positiveRealizedPnlCount: Number(candidate.positiveRealizedPnlCount || 0),
    distinctCampaignWindowCount: Number(candidate.distinctCampaignWindowCount || 0),
    requiresCommittedDiff: true,
    autoRaise: false,
    source: "radar_cap_review",
  };
}

async function appendMissingCapRaiseCandidates(dataDir, candidates = [], now = new Date().toISOString()) {
  const existing = await readRadarJsonl(dataDir, "cap-raise-candidates");
  const seen = new Set(existing.map((record) => record?.intentId).filter(Boolean));
  let written = 0;
  for (const candidate of candidates) {
    const record = capRaiseCandidateIntent(candidate, now);
    if (!record.intentId || seen.has(record.intentId)) continue;
    await appendRadarJsonl(dataDir, "cap-raise-candidates", record);
    seen.add(record.intentId);
    written += 1;
  }
  return written;
}

async function main() {
  const args = parseArgs();
  const dataDir = resolve(args["data-dir"] || "data");
  const realizationRecords = await readRadarJsonl(dataDir, "realization-records");
  const strategyCapsById = Object.fromEntries(listStrategyCaps().map((config) => [config.strategyId, config]));
  const review = buildRadarCapGraduationReview({
    realizationRecords,
    now: args.now || new Date().toISOString(),
    strategyCapsById,
  });
  const eligibleCandidates = review.candidates.filter((candidate) => candidate.eligible);
  const writtenCandidateIntents = await appendMissingCapRaiseCandidates(
    dataDir,
    eligibleCandidates,
    args.now || new Date().toISOString(),
  );

  if (args.write) {
    const outputPath = resolve(args.write);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`);
    console.log(`wrote=${outputPath}`);
  } else {
    console.log(JSON.stringify(review, null, 2));
  }

  console.log(`capRaiseCandidates=${review.candidates.filter((candidate) => candidate.eligible).length}`);
  console.log(`capRaiseCandidateIntents=${writtenCandidateIntents}`);
  console.log(`radarLossLock=${review.lossLock.tripped ? "TRIPPED" : "clear"}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
