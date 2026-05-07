#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildPaybackRunwayAutoResearchPlan,
  runPaybackRunwayAutoResearch,
} from "../research/payback-runway-autoresearch.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
const DEFAULT_ROOT_DIR = "data/payback-runway-autoresearch";

function optionMap(argv) {
  return Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function parseArgs(argv = []) {
  const flags = new Set(argv);
  const options = optionMap(argv);
  if (flags.has("--allow-live-execute")) {
    throw new Error("autoresearch_live_execute_not_supported");
  }
  const plan = buildPaybackRunwayAutoResearchPlan({
    iterations: positiveInteger(options.iterations, 20),
    maxExperiments: positiveInteger(options["max-experiments"], 3),
    rootDir: options["root-dir"] || DEFAULT_ROOT_DIR,
    runId: options["run-id"] || "cli-arg-preview",
    includeFinalPreview: !flags.has("--skip-final-preview"),
  });
  return {
    json: flags.has("--json"),
    iterations: plan.iterations,
    maxExperiments: plan.maxExperiments,
    rootDir: options["root-dir"] || DEFAULT_ROOT_DIR,
    runId: options["run-id"] || null,
    continueOnFailure: flags.has("--continue-on-failure"),
    includeFinalPreview: !flags.has("--skip-final-preview"),
    allowLiveExecute: false,
  };
}

function printSummary(report) {
  const summary = report.summary || {};
  console.log(`observedAt=${report.observedAt}`);
  console.log(`runId=${report.runId}`);
  console.log(`iterations=${summary.iterationCount}/${summary.minimumRequiredIterations}`);
  console.log(`minimumResearchIterationsPassed=${summary.minimumResearchIterationsPassed}`);
  console.log(`allIterationsOk=${summary.allIterationsOk}`);
  console.log(`finalStepsOk=${summary.finalStepsOk}`);
  console.log(`liveExecutionMode=${summary.liveExecutionMode}`);
  console.log(`finalRunwayStatus=${summary.finalRunwayStatus || "unknown"}`);
  console.log(`finalPaybackReason=${summary.finalPaybackReason || "none"}`);
  console.log(`candidateCount=${summary.candidateCount}`);
  console.log(`passedCount=${summary.passedCount}`);
  console.log(`promotionIntentCount=${summary.promotionIntentCount}`);
  console.log(`nextAction=${summary.nextAction}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runPaybackRunwayAutoResearch(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printSummary(report);
  if (!report.summary?.allIterationsOk || !report.summary?.finalStepsOk) process.exitCode = 1;
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
