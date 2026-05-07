#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  buildResearchSplits,
  loadResearchPanel,
  RESEARCH_PANEL_DEFAULTS,
  RESEARCH_SEEDS,
  RESEARCH_SPLIT_DEFAULTS,
} from "./prepare.mjs";
import { appendTrackBRun, runTrackBSearch } from "./factorSearch.mjs";
import { emitPromotionIntent, scoreCandidateResults, shouldEmitPromotionIntent } from "./score.mjs";
import { scanResearchIsolation } from "./isolationGuard.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
const TSV_HEADER = "commit\tevent\tcandidate_name\tsharpe\tmaxdd\tturnover\tnotes\n";

function freeze(value) {
  return Object.freeze(value);
}

function sanitizeNotes(value) {
  return String(value || "").replace(/[\t\r\n]+/gu, " ").trim();
}

function sanitizeCandidateName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

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

function helperSet() {
  return freeze({
    sma: movingAverage,
  });
}

function computeFoldMetrics(rows, signals) {
  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  let turnoverEvents = 0;
  const returns = [];
  let previousSignal = Number(signals[0]) || 0;
  for (let index = 1; index < rows.length; index += 1) {
    const prevClose = rows[index - 1].close;
    const nextClose = rows[index].close;
    const stepReturn = prevClose > 0 ? (nextClose - prevClose) / prevClose : 0;
    const pnl = stepReturn * previousSignal;
    returns.push(pnl);
    equity *= 1 + pnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
    const currentSignal = Number(signals[index]) || 0;
    if (currentSignal !== previousSignal) turnoverEvents += 1;
    previousSignal = currentSignal;
  }
  const avg = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length
    ? returns.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / returns.length
    : 0;
  const sharpe = variance > 0 ? (avg / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  const turnover = returns.length ? turnoverEvents / returns.length : 0;
  return freeze({
    sharpe,
    maxDrawdownPct,
    turnover,
    netReturn: equity - 1,
  });
}

function activeCandidateFiles(candidateDir) {
  if (!existsSync(candidateDir)) return [];
  return readdirSync(candidateDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs") && !entry.name.startsWith("_"))
    .map((entry) => join(candidateDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function classifyCandidatePath(path) {
  const name = basename(path, ".mjs");
  if (name.startsWith("agent_")) return "A";
  if (name.startsWith("factor_")) return "B";
  return "other";
}

function reserveTrackASlot(candidateDir) {
  const active = activeCandidateFiles(candidateDir);
  const factorFiles = active.filter((path) => classifyCandidatePath(path) === "B");
  const desiredFactorCount = 2;
  const removed = [];
  for (const path of factorFiles.slice(desiredFactorCount)) {
    rmSync(path, { force: true });
    removed.push(path);
  }
  return freeze({
    removed: freeze(removed),
  });
}

export function validateCandidateWorkspace(candidateDir) {
  const activeFiles = activeCandidateFiles(candidateDir);
  const blockers = [];
  if (activeFiles.length > 3) blockers.push("too_many_active_candidates");
  return freeze({
    ok: blockers.length === 0,
    activeFiles: freeze(activeFiles),
    blockers: freeze(blockers),
  });
}

export function decideStagnationKills(rows = []) {
  const stableCounts = new Map();
  for (const row of rows) {
    const candidateName = row?.candidate_name || row?.candidateName;
    if (!candidateName) continue;
    if (row.event === "stable") {
      stableCounts.set(candidateName, (stableCounts.get(candidateName) || 0) + 1);
      continue;
    }
    stableCounts.set(candidateName, 0);
  }
  const mustKillOrTouch = [...stableCounts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([candidateName]) => candidateName)
    .sort((left, right) => left.localeCompare(right));
  return freeze({
    mustKillOrTouch: freeze(mustKillOrTouch),
  });
}

export function appendResultRow(resultsPath, row) {
  mkdirSync(dirname(resultsPath), { recursive: true });
  if (!existsSync(resultsPath)) {
    writeFileSync(resultsPath, TSV_HEADER, "utf8");
  }
  const line = [
    row.commit || "unknown",
    row.event || "stable",
    row.candidate_name || row.candidateName || "unknown",
    Number(row.sharpe || 0).toFixed(6),
    Number(row.maxdd || 0).toFixed(6),
    Number(row.turnover || 0).toFixed(6),
    sanitizeNotes(row.notes),
  ].join("\t");
  appendFileSync(resultsPath, `${line}\n`, "utf8");
}

async function loadCandidateModule(path) {
  const moduleUrl = `${pathToFileURL(path).href}?ts=${Date.now()}`;
  return import(moduleUrl);
}

function validateCandidateModule(path, candidate) {
  if (!candidate?.metadata || typeof candidate.metadata !== "object") {
    throw new Error(`candidate missing metadata: ${path}`);
  }
  if (typeof candidate.buildSignals !== "function") {
    throw new Error(`candidate missing buildSignals(): ${path}`);
  }
}

function candidateSignalsForSplit(candidate, panel, split) {
  const signalOutput = candidate.buildSignals({
    panel,
    split,
    helpers: helperSet(),
  });
  const fullSignals = Array.isArray(signalOutput) ? signalOutput : [];
  const valRows = panel.rows.slice(split.val.start, split.val.end + 1);
  const signals = fullSignals.length === panel.rows.length
    ? fullSignals.slice(split.val.start, split.val.end + 1)
    : fullSignals;
  if (signals.length !== valRows.length) {
    throw new Error(`signal length mismatch for split ${split.id}`);
  }
  return { valRows, signals };
}

async function evaluateCandidatePath({ candidatePath, panel, splits }) {
  const candidate = await loadCandidateModule(candidatePath);
  validateCandidateModule(candidatePath, candidate);
  const foldResults = splits.map((split) => {
    const { valRows, signals } = candidateSignalsForSplit(candidate, panel, split);
    return computeFoldMetrics(valRows, signals);
  });
  const candidateName = basename(candidatePath, ".mjs");
  const track = candidate.metadata?.track || null;
  const score = scoreCandidateResults({
    candidateName,
    track,
    foldResults,
  });
  return freeze({
    candidateName,
    path: candidatePath,
    metadata: candidate.metadata,
    foldResults: freeze(foldResults),
    score,
  });
}

async function evaluateCandidatePathAcrossContexts({ candidatePath, contexts }) {
  const evaluations = [];
  for (const context of contexts) {
    evaluations.push(
      await evaluateCandidatePath({
        candidatePath,
        panel: context.panel,
        splits: context.splits,
      }),
    );
  }
  const first = evaluations[0];
  const foldResults = evaluations.flatMap((item) => [...item.foldResults]);
  const score = scoreCandidateResults({
    candidateName: first.candidateName,
    track: first.metadata?.track || null,
    foldResults,
  });
  return freeze({
    candidateName: first.candidateName,
    path: first.path,
    metadata: first.metadata,
    panelContextCount: contexts.length,
    foldResults: freeze(foldResults),
    score,
  });
}

export async function runCandidateRound({
  candidateDir,
  resultsPath,
  panel,
  split,
  commit = "dirty",
} = {}) {
  const workspace = validateCandidateWorkspace(candidateDir);
  if (!workspace.ok) {
    throw new Error(workspace.blockers.join(","));
  }
  const rows = [];
  for (const filePath of workspace.activeFiles) {
    const candidate = await loadCandidateModule(filePath);
    validateCandidateModule(filePath, candidate);
    const candidateName = basename(filePath, ".mjs");
    const signalOutput = candidate.buildSignals({
      panel,
      split,
      helpers: helperSet(),
    });
    const fullSignals = Array.isArray(signalOutput) ? signalOutput : [];
    const valRows = panel.rows.slice(split.val.start, split.val.end + 1);
    const signals = fullSignals.length === panel.rows.length
      ? fullSignals.slice(split.val.start, split.val.end + 1)
      : fullSignals;
    const metrics = computeFoldMetrics(valRows, signals);
    const row = freeze({
      commit,
      event: candidate.metadata.event || "stable",
      candidate_name: candidateName,
      sharpe: metrics.sharpe,
      maxdd: -(metrics.maxDrawdownPct / 100),
      turnover: metrics.turnover,
      notes: candidate.metadata.notes || "",
    });
    appendResultRow(resultsPath, row);
    rows.push(row);
  }
  return freeze({ rows: freeze(rows) });
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
    noAgent: flags.has("--no-agent"),
    daily: flags.has("--daily"),
    dataDir: options["data-dir"] || resolve("data"),
    candidateDir: options["candidate-dir"] || resolve("research", "candidates"),
    resultsPath: options["results-path"] || resolve("research", "results.tsv"),
    maxExperiments: options["max-experiments"] ? Number(options["max-experiments"]) : 100,
  };
}

function parseAgentArgs(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      // Fall through to whitespace split.
    }
  }
  return trimmed.split(/\s+/u).filter(Boolean);
}

function parseAgentPayload(stdout = "") {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return { candidates: [] };
  return JSON.parse(trimmed);
}

function materializeTrackACandidates({ candidateDir, proposals = [] }) {
  mkdirSync(candidateDir, { recursive: true });
  const existing = activeCandidateFiles(candidateDir);
  const proposalNames = new Set(
    proposals
      .map((proposal) => sanitizeCandidateName(proposal.name || proposal.filename || "agent_candidate"))
      .filter(Boolean),
  );
  const occupiedByOthers = existing.filter((path) => !proposalNames.has(basename(path, ".mjs"))).length;
  const remainingSlots = Math.max(0, 3 - occupiedByOthers);
  const written = [];
  for (const proposal of proposals.slice(0, remainingSlots)) {
    const candidateName = sanitizeCandidateName(proposal.name || proposal.filename || "agent_candidate");
    if (!candidateName) continue;
    const filePath = join(candidateDir, `${candidateName}.mjs`);
    writeFileSync(filePath, String(proposal.body || ""), "utf8");
    written.push(
      freeze({
        candidateName,
        path: filePath,
      }),
    );
  }
  return freeze({
    requestedCount: proposals.length,
    materializedCount: written.length,
    workspaceFull: proposals.length > remainingSlots,
    written: freeze(written),
  });
}

function appendTrackARun(dataDir, record) {
  const path = join(dataDir, "research-track-a-runs.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

async function maybeRunTrackA({
  dataDir,
  noAgent,
  maxExperiments,
  candidateDir,
  contexts,
  resultsPath,
  commit,
}) {
  const now = new Date().toISOString();
  const agentCommand = process.env.RESEARCH_AGENT_CMD || "";
  const agentArgs = parseAgentArgs(process.env.RESEARCH_AGENT_ARGS || "");
  if (noAgent) {
    const record = freeze({
      observedAt: now,
      status: "disabled",
      blocker: "agent_disabled",
      maxExperiments,
      generatedCount: 0,
      oosEligibleCount: 0,
      generated: freeze([]),
    });
    appendTrackARun(dataDir, record);
    return record;
  }
  if (!agentCommand) {
    const record = freeze({
      observedAt: now,
      status: "guidance_only",
      blocker: "agent_not_configured",
      setup: "Set RESEARCH_AGENT_CMD and optional RESEARCH_AGENT_ARGS to enable Track A.",
      maxExperiments,
      generatedCount: 0,
      oosEligibleCount: 0,
      generated: freeze([]),
    });
    appendTrackARun(dataDir, record);
    return record;
  }
  const result = spawnSync(agentCommand, agentArgs, {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    const record = freeze({
      observedAt: now,
      status: "error",
      blocker: "agent_command_failed",
      command: agentCommand,
      args: agentArgs,
      exitCode: result.status ?? 1,
      stdoutPreview: (result.stdout || "").trim().slice(0, 500),
      stderrPreview: (result.stderr || "").trim().slice(0, 500),
      generatedCount: 0,
      oosEligibleCount: 0,
      generated: freeze([]),
    });
    appendTrackARun(dataDir, record);
    return record;
  }
  let payload;
  try {
    payload = parseAgentPayload(result.stdout);
  } catch (error) {
    const record = freeze({
      observedAt: now,
      status: "error",
      blocker: "agent_invalid_output",
      command: agentCommand,
      args: agentArgs,
      exitCode: result.status ?? 0,
      stdoutPreview: (result.stdout || "").trim().slice(0, 500),
      stderrPreview: (result.stderr || "").trim().slice(0, 500),
      error: error.message,
      generatedCount: 0,
      oosEligibleCount: 0,
      generated: freeze([]),
    });
    appendTrackARun(dataDir, record);
    return record;
  }

  reserveTrackASlot(candidateDir);
  const materialized = materializeTrackACandidates({
    candidateDir,
    proposals: Array.isArray(payload?.candidates) ? payload.candidates : [],
  });
  const generated = [];
  for (const item of materialized.written) {
    const evaluation = await evaluateCandidatePathAcrossContexts({
      candidatePath: item.path,
      contexts,
    });
    appendResultRow(resultsPath, {
      commit,
      event: evaluation.metadata?.event || "create",
      candidate_name: evaluation.candidateName,
      sharpe: evaluation.score.oosGate.metrics.deflatedSharpeLowerBound,
      maxdd: -(evaluation.score.oosGate.metrics.maxDrawdownPct / 100),
      turnover: evaluation.score.oosGate.metrics.turnover,
      notes: evaluation.score.oosGate.passed ? "track=A oos=eligible" : evaluation.score.blockers.join(","),
    });
    if (shouldEmitPromotionIntent(evaluation.score)) {
      emitPromotionIntent({
        score: evaluation.score,
        candidatePath: evaluation.path,
        outPath: join(dataDir, "research-promotion-intents.jsonl"),
        now,
      });
    }
    generated.push(evaluation);
  }
  const record = freeze({
    observedAt: now,
    status: "completed",
    blocker: generated.length > 0 ? null : (materialized.workspaceFull ? "candidate_workspace_full" : "agent_no_candidates"),
    command: agentCommand,
    args: agentArgs,
    exitCode: result.status ?? 0,
    stdoutPreview: (result.stdout || "").trim().slice(0, 500),
    stderrPreview: (result.stderr || "").trim().slice(0, 500),
    requestedCount: materialized.requestedCount,
    materializedCount: materialized.materializedCount,
    generatedCount: generated.length,
    oosEligibleCount: generated.filter((item) => item.score.oosGate.passed).length,
    generated: freeze(generated),
  });
  appendTrackARun(dataDir, record);
  return record;
}

function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "dirty";
}

function buildDefaultResearchContexts() {
  return RESEARCH_SEEDS.map((seed) => {
    const panel = loadResearchPanel({
      bars: RESEARCH_PANEL_DEFAULTS.bars,
      chains: RESEARCH_PANEL_DEFAULTS.chains,
      seed,
    });
    return freeze({
      id: `seed_${seed}`,
      seed,
      panel,
      splits: buildResearchSplits(panel, RESEARCH_SPLIT_DEFAULTS),
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = scanResearchIsolation({ rootDir: resolve(".") });
  if (!guard.ok) {
    throw new Error(`research isolation guard failed: ${JSON.stringify(guard.violations.slice(0, 5))}`);
  }

  const contexts = buildDefaultResearchContexts();
  if (contexts.some((context) => !context.splits.length)) throw new Error("research split builder returned no folds");
  const splitCount = contexts.reduce((sum, context) => sum + context.splits.length, 0);
  const commit = currentCommit();

  const trackA = await maybeRunTrackA({
    dataDir: args.dataDir,
    noAgent: args.noAgent,
    maxExperiments: args.maxExperiments,
    candidateDir: args.candidateDir,
    contexts,
    resultsPath: args.resultsPath,
    commit,
  });

  const nonTrackBCandidates = activeCandidateFiles(args.candidateDir)
    .filter((path) => classifyCandidatePath(path) !== "B")
    .length;
  const trackBSlotBudget = Math.max(0, Math.min(3, args.maxExperiments) - nonTrackBCandidates);

  const trackB = await runTrackBSearch({
    candidateDir: args.candidateDir,
    maxCandidates: trackBSlotBudget,
  });
  appendTrackBRun(args.dataDir, trackB);

  for (const item of trackB.generated) {
    appendResultRow(args.resultsPath, {
      commit,
      event: item.metadata.event || "create",
      candidate_name: item.candidateName,
      sharpe: item.score.oosGate.metrics.deflatedSharpeLowerBound,
      maxdd: -(item.score.oosGate.metrics.maxDrawdownPct / 100),
      turnover: item.score.oosGate.metrics.turnover,
      notes: item.score.oosGate.passed ? "track=B oos=eligible" : item.score.blockers.join(","),
    });
    if (shouldEmitPromotionIntent(item.score)) {
      emitPromotionIntent({
        score: item.score,
        candidatePath: item.path,
        outPath: join(args.dataDir, "research-promotion-intents.jsonl"),
        now: trackB.observedAt,
      });
    }
  }

  const summary = {
    observedAt: trackB.observedAt,
    daily: args.daily,
    trackA: {
      observedAt: trackA.observedAt,
      status: trackA.status,
      blocker: trackA.blocker,
      generatedCount: trackA.generatedCount || 0,
      oosEligibleCount: trackA.oosEligibleCount || 0,
    },
    trackB: {
      generatedCount: trackB.generatedCount,
      oosEligibleCount: trackB.oosEligibleCount,
      latestBlocker: trackB.latestBlocker,
    },
    researchPanel: {
      bars: RESEARCH_PANEL_DEFAULTS.bars,
      chains: [...RESEARCH_PANEL_DEFAULTS.chains],
      seeds: [...RESEARCH_SEEDS],
      contextCount: contexts.length,
    },
    splits: splitCount,
    splitDefaults: RESEARCH_SPLIT_DEFAULTS,
    resultsPath: args.resultsPath,
  };
  console.log(`trackA: status=${trackA.status} generated=${trackA.generatedCount || 0} oosEligible=${trackA.oosEligibleCount || 0} blocker=${trackA.blocker || "none"}`);
  console.log(`trackB: generated=${trackB.generatedCount} oosEligible=${trackB.oosEligibleCount} blocker=${trackB.latestBlocker || "none"}`);
  console.log(JSON.stringify(summary, null, 2));
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
