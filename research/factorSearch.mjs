#!/usr/bin/env node

import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildResearchSplits, loadResearchPanel } from "./prepare.mjs";
import { scoreCandidateResults } from "./score.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function movingAverage(values, window) {
  const out = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += Number(values[index]) || 0;
    if (index >= window) sum -= Number(values[index - window]) || 0;
    const divisor = Math.min(index + 1, window);
    out.push(sum / divisor);
  }
  return out;
}

function signalsFromMomentum(panel, fastWindow, slowWindow) {
  const close = panel.rows.map((row) => row.close);
  const fast = movingAverage(close, fastWindow);
  const slow = movingAverage(close, slowWindow);
  return close.map((_, index) => (fast[index] > slow[index] ? 1 : 0));
}

function evaluateSignals(panel, split, signals) {
  const valRows = panel.rows.slice(split.val.start, split.val.end + 1);
  const relevantSignals = signals.length === panel.rows.length
    ? signals.slice(split.val.start, split.val.end + 1)
    : signals;
  if (relevantSignals.length !== valRows.length) {
    throw new Error("signal length must match validation window or full panel");
  }
  const returns = [];
  let previousSignal = Number(relevantSignals[0]) || 0;
  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  let turnoverEvents = 0;
  for (let index = 1; index < valRows.length; index += 1) {
    const prevClose = valRows[index - 1].close;
    const nextClose = valRows[index].close;
    const rawReturn = prevClose > 0 ? (nextClose - prevClose) / prevClose : 0;
    const pnl = rawReturn * previousSignal;
    equity *= 1 + pnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
    returns.push(pnl);
    const currentSignal = Number(relevantSignals[index]) || 0;
    if (currentSignal !== previousSignal) turnoverEvents += 1;
    previousSignal = currentSignal;
  }
  const averageReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length
    ? returns.reduce((sum, value) => sum + ((value - averageReturn) ** 2), 0) / returns.length
    : 0;
  const sharpe = variance > 0 ? (averageReturn / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  const turnover = returns.length ? turnoverEvents / returns.length : 0;
  const capacityUsd = 10_000 + averageReturn * 250_000 + (1 - turnover) * 20_000;
  return Object.freeze({
    sharpe,
    maxDrawdownPct,
    turnover,
    capacityUsd,
    netReturn: equity - 1,
  });
}

function candidateSource({ name, fastWindow, slowWindow }) {
  return `export const metadata = {
  name: "${name}",
  track: "B",
  family: "momentum",
  event: "create",
  notes: "deterministic factor candidate"
};

export function buildSignals({ panel, helpers }) {
  const close = panel.rows.map((row) => row.close);
  const fast = helpers.sma(close, ${fastWindow});
  const slow = helpers.sma(close, ${slowWindow});
  return panel.rows.map((_, index) => fast[index] > slow[index] ? 1 : 0);
}
`;
}

export function appendTrackBRun(dataDir, record) {
  const path = join(dataDir, "research-track-b-runs.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

export async function runTrackBSearch({
  candidateDir,
  maxCandidates = 1,
  panel,
  now = new Date().toISOString(),
} = {}) {
  if (!candidateDir) throw new TypeError("candidateDir is required");
  const sourcePanel = panel || loadResearchPanel();
  const safeMax = Math.max(1, Math.min(3, Number(maxCandidates) || 1));
  const splits = buildResearchSplits(sourcePanel, {
    foldCount: Math.min(4, safeMax + 2),
    trainSize: 32,
    valSize: 16,
    purgeSize: 2,
    embargoSize: 2,
  });
  if (!splits.length) {
    return Object.freeze({
      observedAt: now,
      generatedCount: 0,
      oosEligibleCount: 0,
      latestBlocker: "insufficient_data",
      generated: Object.freeze([]),
    });
  }

  mkdirSync(candidateDir, { recursive: true });
  const configs = [
    { name: "factor_momentum_01", fastWindow: 5, slowWindow: 13 },
    { name: "factor_momentum_02", fastWindow: 8, slowWindow: 21 },
    { name: "factor_trend_03", fastWindow: 13, slowWindow: 34 },
  ].slice(0, safeMax);

  const generated = configs.map((config) => {
    const path = join(candidateDir, `${config.name}.mjs`);
    writeFileSync(path, candidateSource(config), "utf8");
    const signals = signalsFromMomentum(sourcePanel, config.fastWindow, config.slowWindow);
    const foldResults = splits.map((split) => evaluateSignals(sourcePanel, split, signals));
    const score = scoreCandidateResults({
      candidateName: config.name,
      track: "B",
      foldResults,
    });
    return Object.freeze({
      candidateName: config.name,
      path,
      metadata: Object.freeze({
        name: config.name,
        track: "B",
        family: "momentum",
        event: "create",
        notes: "deterministic factor candidate",
      }),
      foldResults: Object.freeze(foldResults),
      score,
    });
  });

  return Object.freeze({
    observedAt: now,
    generatedCount: generated.length,
    oosEligibleCount: generated.filter((item) => item.score.oosGate.passed).length,
    latestBlocker: generated.some((item) => item.score.oosGate.passed) ? null : "oos_gate_blocked",
    generated: Object.freeze(generated),
  });
}

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    candidateDir: options["candidate-dir"] || resolve("research", "candidates"),
    dataDir: options["data-dir"] || resolve("data"),
    maxCandidates: options["max-candidates"] ? Number(options["max-candidates"]) : 1,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runTrackBSearch({
    candidateDir: args.candidateDir,
    maxCandidates: args.maxCandidates,
    panel: loadResearchPanel({ bars: 160, chains: ["base"], seed: 21 }),
  });
  appendTrackBRun(args.dataDir, result);
  console.log(JSON.stringify(result, null, 2));
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
