import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ITERATIONS = 20;
const MIN_ITERATIONS = 20;
const DEFAULT_MAX_EXPERIMENTS = 3;

function finiteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(finiteNumber(value) ?? fallback);
  return parsed > 0 ? parsed : fallback;
}

function safeId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120) || "run";
}

function tail(text, lines = 4) {
  return String(text || "").trim().split("\n").filter(Boolean).slice(-lines).join(" | ");
}

function parseJsonFromStdout(stdout = "") {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstObject = trimmed.indexOf("{");
    const lastObject = trimmed.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(trimmed.slice(firstObject, lastObject + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function blockerCounts(candidates = []) {
  const counts = new Map();
  for (const candidate of candidates) {
    for (const blocker of candidate?.blockers || []) {
      counts.set(blocker, (counts.get(blocker) || 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function summarizeScore(score = null) {
  const candidates = Array.isArray(score?.candidates) ? score.candidates : [];
  return {
    observedAt: score?.observedAt || null,
    scannedRunCount: finiteNumber(score?.scannedRunCount) ?? null,
    candidateCount: finiteNumber(score?.candidateCount) ?? candidates.length,
    promotionIntentCount: finiteNumber(score?.promotionIntentCount) ?? 0,
    passedCount: candidates.filter((item) => item?.passed === true).length,
    blockerCounts: blockerCounts(candidates),
  };
}

function iterationLabel(index) {
  return `iter-${String(index + 1).padStart(2, "0")}`;
}

function iterationPaths({ rootDir, index }) {
  const label = iterationLabel(index);
  const iterationRoot = join(rootDir, "iterations", label);
  return {
    label,
    iterationRoot,
    dataDir: join(iterationRoot, "data"),
    candidateDir: join(iterationRoot, "candidates"),
    resultsPath: join(iterationRoot, "results.tsv"),
    scoreSummaryPath: join(iterationRoot, "research-score-latest.json"),
  };
}

function nodeStep({ name, script, args = [], timeoutMs = 1_200_000, scope = "final", iteration = null, parseJson = false }) {
  return Object.freeze({
    name,
    script,
    args: Object.freeze(args.map(String)),
    timeoutMs,
    scope,
    iteration,
    parseJson,
  });
}

export function buildPaybackRunwayAutoResearchPlan({
  iterations = DEFAULT_ITERATIONS,
  maxExperiments = DEFAULT_MAX_EXPERIMENTS,
  rootDir = resolve("data", "payback-runway-autoresearch"),
  runId = `payback-runway-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
  includeFinalPreview = true,
} = {}) {
  const resolvedIterations = Math.max(MIN_ITERATIONS, positiveInteger(iterations, DEFAULT_ITERATIONS));
  const resolvedMaxExperiments = positiveInteger(maxExperiments, DEFAULT_MAX_EXPERIMENTS);
  const runRoot = join(rootDir, safeId(runId));
  const steps = [];
  for (let index = 0; index < resolvedIterations; index += 1) {
    const paths = iterationPaths({ rootDir: runRoot, index });
    steps.push(nodeStep({
      name: "research_run",
      script: "research/run.mjs",
      scope: "iteration",
      iteration: index + 1,
      args: [
        `--max-experiments=${resolvedMaxExperiments}`,
        "--no-agent",
        `--data-dir=${paths.dataDir}`,
        `--candidate-dir=${paths.candidateDir}`,
        `--results-path=${paths.resultsPath}`,
      ],
      timeoutMs: 1_200_000,
    }));
    steps.push(nodeStep({
      name: "research_score",
      script: "research/score.mjs",
      scope: "iteration",
      iteration: index + 1,
      parseJson: true,
      args: [
        `--data-dir=${paths.dataDir}`,
        `--summary-path=${paths.scoreSummaryPath}`,
        "--no-emit-intents",
      ],
      timeoutMs: 300_000,
    }));
  }
  const finalSteps = includeFinalPreview
    ? [
        nodeStep({ name: "audit_overfit", script: "src/cli/audit-overfit.mjs", timeoutMs: 300_000 }),
        nodeStep({ name: "audit_eth_family_overfit", script: "src/cli/audit-eth-family-overfit.mjs", timeoutMs: 300_000 }),
        nodeStep({ name: "autonomous_discovery_board", script: "src/cli/report-autonomous-discovery-board.mjs", args: ["--write"], timeoutMs: 300_000 }),
        nodeStep({ name: "deterministic_strategy_candidates", script: "src/cli/report-deterministic-strategy-candidates.mjs", args: ["--write"], timeoutMs: 300_000 }),
        nodeStep({
          name: "all_chain_autopilot",
          script: "src/cli/run-all-chain-autopilot.mjs",
          args: ["--json", "--write"],
          timeoutMs: 1_200_000,
          parseJson: true,
        }),
        nodeStep({ name: "payback_status", script: "src/cli/report-payback-status.mjs", args: ["--json"], timeoutMs: 300_000, parseJson: true }),
      ]
    : [];
  return Object.freeze({
    schemaVersion: 1,
    runRoot,
    iterations: resolvedIterations,
    maxExperiments: resolvedMaxExperiments,
    allowLiveExecute: false,
    steps: Object.freeze(steps),
    finalSteps: Object.freeze(finalSteps),
  });
}

function defaultStepRunner(step, { cwd = ROOT, env = process.env } = {}) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [resolve(cwd, step.script), ...step.args], {
    cwd,
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
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    json: step.parseJson ? parseJsonFromStdout(result.stdout) : null,
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function liveExecutionAttempted(finalStepResults = []) {
  return finalStepResults.some(
    (step) =>
      step.name === "all_chain_autopilot" &&
      Array.isArray(step.args) &&
      step.args.includes("--execute"),
  );
}

function summarizeIterations(iterations = []) {
  const scoreSummaries = iterations.map((item) => item.scoreSummary).filter(Boolean);
  return {
    iterationCount: iterations.length,
    okIterationCount: iterations.filter((item) => item.ok).length,
    candidateCount: scoreSummaries.reduce((sum, item) => sum + (finiteNumber(item.candidateCount) ?? 0), 0),
    passedCount: scoreSummaries.reduce((sum, item) => sum + (finiteNumber(item.passedCount) ?? 0), 0),
    promotionIntentCount: scoreSummaries.reduce((sum, item) => sum + (finiteNumber(item.promotionIntentCount) ?? 0), 0),
  };
}

function nextAction({ summary, finalPaybackStatus = null } = {}) {
  const runwayStatus = finalPaybackStatus?.runway?.status || null;
  if (runwayStatus === "payback_delivery_ready") return "run_payback_scheduler_execute";
  if (runwayStatus === "profit_creation_required") return "create_payback_eligible_realized_pnl";
  if (summary.passedCount > 0) return "review_oos_eligible_candidates";
  return "continue_research_or_fix_live_blockers";
}

export async function runPaybackRunwayAutoResearch({
  iterations = DEFAULT_ITERATIONS,
  maxExperiments = DEFAULT_MAX_EXPERIMENTS,
  rootDir = resolve("data", "payback-runway-autoresearch"),
  runId = null,
  includeFinalPreview = true,
  continueOnFailure = false,
  cwd = ROOT,
  env = process.env,
  stepRunner = defaultStepRunner,
  now = new Date().toISOString(),
  persist = true,
} = {}) {
  const resolvedRunId = runId || `payback-runway-${now.replace(/[:.]/gu, "-")}`;
  const plan = buildPaybackRunwayAutoResearchPlan({
    iterations,
    maxExperiments,
    rootDir,
    runId: resolvedRunId,
    includeFinalPreview,
  });
  await mkdir(plan.runRoot, { recursive: true });
  const iterationRecords = [];
  for (let index = 0; index < plan.iterations; index += 1) {
    const paths = iterationPaths({ rootDir: plan.runRoot, index });
    await mkdir(paths.iterationRoot, { recursive: true });
    const steps = plan.steps.filter((step) => step.iteration === index + 1);
    const results = [];
    for (const step of steps) {
      const result = await stepRunner(step, { cwd, env, paths, plan });
      results.push(result);
      if (!result.ok && !continueOnFailure) break;
    }
    const scoreResult = results.find((item) => item.name === "research_score") || null;
    const scoreJson = scoreResult?.json || await readJsonIfExists(paths.scoreSummaryPath);
    const scoreSummary = summarizeScore(scoreJson);
    const ok = results.length === steps.length && results.every((item) => item.ok);
    iterationRecords.push({
      iteration: index + 1,
      label: paths.label,
      ok,
      scoreSummary,
      steps: results,
    });
    if (!ok && !continueOnFailure) break;
  }

  const finalStepResults = [];
  if (includeFinalPreview) {
    for (const step of plan.finalSteps) {
      const result = await stepRunner(step, { cwd, env, plan });
      finalStepResults.push(result);
      if (!result.ok && !continueOnFailure) break;
    }
  }
  const finalPayback = finalStepResults.find((item) => item.name === "payback_status")?.json || null;
  const iterationSummary = summarizeIterations(iterationRecords);
  const summary = {
    observedAt: now,
    runId: resolvedRunId,
    runRoot: plan.runRoot,
    minimumRequiredIterations: MIN_ITERATIONS,
    minimumResearchIterationsPassed: iterationRecords.length >= MIN_ITERATIONS && iterationRecords.every((item) => item.ok),
    allIterationsOk: iterationRecords.every((item) => item.ok),
    finalStepsOk: finalStepResults.every((item) => item.ok),
    liveExecutionAttempted: liveExecutionAttempted(finalStepResults),
    liveExecutionMode: "preview_only",
    finalRunwayStatus: finalPayback?.runway?.status || null,
    finalPaybackReason: finalPayback?.payback?.scheduler?.reason || finalPayback?.decision?.reason || null,
    nextAction: null,
    ...iterationSummary,
  };
  summary.nextAction = nextAction({ summary, finalPaybackStatus: finalPayback });
  const report = {
    schemaVersion: 1,
    observedAt: now,
    runId: resolvedRunId,
    plan,
    summary,
    iterations: iterationRecords,
    finalSteps: finalStepResults,
    finalPaybackStatus: finalPayback
      ? {
          schedulerStatus: finalPayback?.payback?.scheduler?.status || finalPayback?.decision?.status || null,
          schedulerReason: finalPayback?.payback?.scheduler?.reason || finalPayback?.decision?.reason || null,
          grossProfitSatsPeriod: finalPayback?.payback?.grossProfitSatsPeriod ?? null,
          runway: finalPayback?.runway || null,
        }
      : null,
  };
  if (persist) {
    const latestPath = join(rootDir, "payback-runway-autoresearch-latest.json");
    await mkdir(dirname(latestPath), { recursive: true });
    await writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await appendFile(join(rootDir, "payback-runway-autoresearch-runs.jsonl"), `${JSON.stringify(report)}\n`, "utf8");
  }
  return report;
}

export default runPaybackRunwayAutoResearch;
