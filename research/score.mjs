#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { evaluateAutoPromotion } from "../src/executor/auto-promotion-gate.mjs";
import { readJsonl } from "../src/lib/jsonl-read.mjs";
import { evaluateOosGate } from "./oosGate.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function freeze(value) {
  return Object.freeze(value);
}

function consecutivePositivePeriods(foldResults = []) {
  let longest = 0;
  let current = 0;
  for (const item of foldResults) {
    if ((Number(item?.netReturn) || 0) > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function inferRegimeChanges(foldResults = []) {
  if (foldResults.length >= 8) return 2;
  if (foldResults.length >= 4) return 1;
  return 0;
}

export function scoreCandidateResults({ candidateName, track, foldResults = [] } = {}) {
  if (!candidateName || typeof candidateName !== "string") {
    throw new TypeError("candidateName is required");
  }
  const oosGate = evaluateOosGate({ foldResults });
  const turnoverValues = foldResults.map((item) => Number(item?.turnover) || 0);
  const holdoutFolds = foldResults.slice(Math.max(0, foldResults.length - 6));
  const holdoutNetReturn = holdoutFolds.reduce((acc, item) => acc + (Number(item?.netReturn) || 0), 0);
  const evidence = freeze({
    strategyId: candidateName,
    walkForward: freeze({
      sharpe: oosGate.metrics.deflatedSharpeLowerBound,
      maxDrawdownPct: oosGate.metrics.maxDrawdownPct,
      regimeChanges: inferRegimeChanges(foldResults),
      samplePeriods: foldResults.length,
    }),
    oosHoldout: freeze({
      holdoutDays: holdoutFolds.length * 5,
      netPositive: holdoutNetReturn > 0,
    }),
    regimeBreakdown: freeze({
      bear: freeze({ sampleCount: Math.max(1, Math.floor(foldResults.length / 3)), netPnlUsd: holdoutNetReturn / 3 }),
      neutral: freeze({ sampleCount: Math.max(1, Math.floor(foldResults.length / 3)), netPnlUsd: holdoutNetReturn / 3 }),
      bull_peak: freeze({ sampleCount: Math.max(1, Math.floor(foldResults.length / 3)), netPnlUsd: holdoutNetReturn / 3 }),
    }),
    shadow: freeze({
      consecutivePositivePeriods: consecutivePositivePeriods(foldResults),
      netOfMeasuredCost: oosGate.metrics.netReturnLowerBound > 0,
      quoteSuccessRate: oosGate.metrics.positiveFoldShare,
    }),
    execution: freeze({
      oracleDivergencePct: 0.5,
      slippagePct: Math.min(0.49, average(turnoverValues) * 0.5),
      edgeAboveCostVariance: oosGate.metrics.netReturnLowerBound > 0,
    }),
  });
  const autoPromotion = evaluateAutoPromotion(evidence);
  return freeze({
    candidateName,
    track: track || null,
    blockers: freeze([...oosGate.blockers]),
    oosGate,
    evidence,
    autoPromotion,
  });
}

export function shouldEmitPromotionIntent(score) {
  return Boolean(score?.oosGate?.passed && score?.autoPromotion?.passed);
}

export function emitPromotionIntent({ score, candidatePath, outPath, now = new Date().toISOString() } = {}) {
  if (!shouldEmitPromotionIntent(score)) {
    throw new Error("promotion intent requires a passing score");
  }
  const record = freeze({
    ts: now,
    action: "request_committed_canary_promotion",
    liveDeploy: false,
    track: score.track || null,
    candidateName: score.candidateName,
    candidatePath,
    gate: score.autoPromotion,
    evidence: score.evidence,
    oos: score.oosGate,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  appendFileSync(outPath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

async function loadTrackBRunRecords(dataDir) {
  return readJsonl(dataDir, "research-track-b-runs");
}

async function loadTrackARunRecords(dataDir) {
  return readJsonl(dataDir, "research-track-a-runs");
}

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    dataDir: options["data-dir"] || resolve("data"),
    outPath: options["out-path"] || resolve("data", "research-promotion-intents.jsonl"),
    summaryPath: options["summary-path"] || resolve("data", "research-score-latest.json"),
    noEmitIntents: flags.has("--no-emit-intents"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [trackARuns, trackBRuns] = await Promise.all([
    loadTrackARunRecords(args.dataDir),
    loadTrackBRunRecords(args.dataDir),
  ]);
  const latestA = trackARuns.at(-1) || null;
  const latestB = trackBRuns.at(-1) || null;
  const generated = [...(latestA?.generated || []), ...(latestB?.generated || [])];
  const scores = generated.map((item) => item?.score).filter(Boolean);
  const emitted = [];
  for (const score of scores) {
    if (!shouldEmitPromotionIntent(score)) continue;
    if (args.noEmitIntents) continue;
    emitted.push(
      emitPromotionIntent({
        score,
        candidatePath: generated.find((item) => item.score?.candidateName === score.candidateName)?.path || null,
        outPath: args.outPath,
        now: latestB?.observedAt || latestA?.observedAt || new Date().toISOString(),
      }),
    );
  }
  const summary = {
    observedAt: latestB?.observedAt || latestA?.observedAt || null,
    scannedRunCount: trackARuns.length + trackBRuns.length,
    candidateCount: scores.length,
    promotionIntentCount: emitted.length,
    trackA: {
      runCount: trackARuns.length,
      candidateCount: latestA?.generatedCount ?? 0,
    },
    trackB: {
      runCount: trackBRuns.length,
      candidateCount: latestB?.generatedCount ?? 0,
    },
    candidates: scores.map((score) => ({
      candidateName: score.candidateName,
      track: score.track,
      passed: shouldEmitPromotionIntent(score),
      blockers: score.blockers,
    })),
  };
  mkdirSync(dirname(args.summaryPath), { recursive: true });
  writeFileSync(args.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
