#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseNumberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseArgs(argv) {
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
    loop: flags.has("--loop"),
    force: flags.has("--force"),
    continueOnFailure: flags.has("--continue-on-failure"),
    skipScore: flags.has("--skip-score"),
    skipResearchBoard: flags.has("--skip-research-board"),
    skipDeterministicCandidates: flags.has("--skip-deterministic-candidates"),
    intervalMs: parseNumberOption(options.intervalMs, 1_800_000),
    staleHours: parseNumberOption(options["stale-hours"], 20),
    maxExperiments: parseNumberOption(options["max-experiments"], 100),
  };
}

async function latestObservedAt(dataDir = config.dataDir) {
  const [trackARuns, trackBRuns] = await Promise.all([
    readJsonl(dataDir, "research-track-a-runs"),
    readJsonl(dataDir, "research-track-b-runs"),
  ]);
  return [trackARuns.at(-1)?.observedAt, trackBRuns.at(-1)?.observedAt]
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

export function isResearchRefreshDue({ latestRunAt = null, staleHours = 20, now = Date.now() } = {}) {
  if (!latestRunAt) return true;
  const latestMs = new Date(latestRunAt).getTime();
  if (!Number.isFinite(latestMs)) return true;
  return (now - latestMs) >= staleHours * 3_600_000;
}

function buildNodeStep({ name, script, args = [], timeoutMs = 1_200_000 }) {
  return { name, script, args, timeoutMs };
}

export function buildAutoResearchRefreshPlan({ args, runResearch = true } = {}) {
  const plan = [];
  if (runResearch) {
    plan.push(buildNodeStep({
      name: "research_daily",
      script: "research/run.mjs",
      args: ["--daily", `--max-experiments=${args.maxExperiments}`],
      timeoutMs: 1_200_000,
    }));
  }
  if (!args.skipScore) {
    plan.push(buildNodeStep({
      name: "research_score",
      script: "research/score.mjs",
      args: ["--no-emit-intents"],
      timeoutMs: 300_000,
    }));
  }
  if (!args.skipResearchBoard) {
    plan.push(buildNodeStep({
      name: "strategy_research_board",
      script: "src/cli/report-strategy-research-board.mjs",
      args: ["--write"],
      timeoutMs: 300_000,
    }));
  }
  if (!args.skipDeterministicCandidates) {
    plan.push(buildNodeStep({
      name: "deterministic_strategy_candidates",
      script: "src/cli/report-deterministic-strategy-candidates.mjs",
      args: ["--write"],
      timeoutMs: 300_000,
    }));
  }
  return plan;
}

function runNodeStep(step, env = process.env) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [resolve(ROOT, step.script), ...step.args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: step.timeoutMs,
  });
  return {
    name: step.name,
    script: step.script,
    args: step.args,
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal || null,
    durationMs: Date.now() - started,
    stdoutTail: (result.stdout || "").trim().split("\n").filter(Boolean).slice(-3).join(" | "),
    stderrTail: (result.stderr || "").trim().split("\n").filter(Boolean).slice(-3).join(" | "),
  };
}

async function persistReport(report, dataDir = config.dataDir) {
  const latestPath = join(dataDir, "auto-research-refresh-latest.json");
  await writeTextIfChanged(latestPath, `${JSON.stringify(report, null, 2)}\n`);
  await new JsonlStore(dataDir).append("auto-research-refresh-runs", report);
}

export async function runAutoResearchRefreshOnce(args, { dataDir = config.dataDir } = {}) {
  const observedAt = new Date().toISOString();
  const latestRunAt = await latestObservedAt(dataDir);
  const runResearch = args.force || isResearchRefreshDue({
    latestRunAt,
    staleHours: args.staleHours,
    now: Date.parse(observedAt),
  });
  const plan = buildAutoResearchRefreshPlan({ args, runResearch });
  const steps = [];
  for (const step of plan) {
    const result = runNodeStep(step);
    steps.push(result);
    if (!result.ok && !args.continueOnFailure) break;
  }
  const report = {
    schemaVersion: 1,
    observedAt,
    latestRunAt,
    staleHours: args.staleHours,
    researchRunTriggered: runResearch,
    attemptedStepCount: steps.length,
    steps,
    ok: steps.every((step) => step.ok),
  };
  await persistReport(report, dataDir);
  return report;
}

function printSummary(report) {
  console.log(`observedAt=${report.observedAt}`);
  console.log(`latestRunAt=${report.latestRunAt || "none"}`);
  console.log(`researchRunTriggered=${report.researchRunTriggered}`);
  for (const step of report.steps) {
    console.log(`  step=${step.name} ok=${step.ok} exit=${step.exitCode} ms=${step.durationMs}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let report = null;
  do {
    report = await runAutoResearchRefreshOnce(args);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printSummary(report);
    if (!args.loop) break;
    await delay(Math.max(5_000, args.intervalMs));
  } while (true);

  if (!report?.ok) process.exitCode = 1;
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
