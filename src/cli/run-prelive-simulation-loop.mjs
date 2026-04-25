#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildPreliveSimulationLoopPlan, runPreliveSimulationLoop } from "../prelive/simulation-loop.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
    write: flags.has("--write"),
    execute: flags.has("--execute"),
    continueOnFailure: flags.has("--continue-on-failure"),
    from: options.from || null,
    source: options.source || "objective",
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    limit: options.limit ? Number(options.limit) : 4,
    maxRuns: options["max-runs"] ? Number(options["max-runs"]) : null,
    maxStallRuns: options["max-stall-runs"] ? Number(options["max-stall-runs"]) : 2,
    targetSuccessCount: options["target-success-count"] ? Number(options["target-success-count"]) : 50,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, ...stable } = value;
  return stable;
}

function buildBatchArgs(options) {
  const args = [
    resolve(ROOT, "src/cli/run-prelive-simulations.mjs"),
    "--json",
    "--write",
    `--source=${options.source}`,
    `--limit=${options.limit}`,
    `--target-success-count=${options.targetSuccessCount}`,
  ];
  if (options.routeKey) args.push(`--route-key=${options.routeKey}`);
  if (options.amount) args.push(`--amount=${options.amount}`);
  if (options.from) args.push(`--from=${options.from}`);
  return args;
}

function runSimulationBatchCli(options) {
  const args = buildBatchArgs(options);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return {
      ok: false,
      command: `node src/cli/run-prelive-simulations.mjs --json --write --source=${options.source} --limit=${options.limit} --target-success-count=${options.targetSuccessCount}`,
      error: {
        exitCode: result.status,
        stderr: result.stderr.trim(),
        stdout: result.stdout.trim(),
      },
    };
  }

  try {
    const payload = JSON.parse(result.stdout);
    return {
      ok: true,
      command: `node src/cli/run-prelive-simulations.mjs --json --write --source=${options.source} --limit=${options.limit} --target-success-count=${options.targetSuccessCount}`,
      summary: payload.summary || null,
      results: payload.results || [],
    };
  } catch (error) {
    return {
      ok: false,
      command: `node src/cli/run-prelive-simulations.mjs --json --write --source=${options.source} --limit=${options.limit} --target-success-count=${options.targetSuccessCount}`,
      error: {
        exitCode: result.status,
        stderr: result.stderr.trim(),
        stdout: result.stdout.trim(),
        message: error.message,
      },
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const loadRuns = () => readJsonl(config.dataDir, "prelive-simulation-runs");
  const currentRuns = await loadRuns();
  const preview = buildPreliveSimulationLoopPlan({
    simulationRuns: currentRuns,
    targetSuccessCount: args.targetSuccessCount,
    source: args.source,
    routeKey: args.routeKey,
    amount: args.amount,
    limit: args.limit,
    maxRuns: args.maxRuns,
    maxStallRuns: args.maxStallRuns,
    stopOnFailure: !args.continueOnFailure,
  });

  if (!args.execute) {
    if (args.json) {
      console.log(JSON.stringify({ preview }, null, 2));
      return;
    }
    console.log(`mode=preview`);
    console.log(`nextAction=${preview.nextAction}`);
    console.log(`currentSuccess=${preview.currentSummary.successCount}/${preview.currentSummary.targetSuccessCount}`);
    console.log(`currentFailures=${preview.currentSummary.failureCount}`);
    console.log(`successRemaining=${preview.currentSummary.successRemaining}`);
    console.log(`limit=${preview.settings.limit}`);
    console.log(`maxRuns=${preview.settings.maxRuns}`);
    console.log(`maxStallRuns=${preview.settings.maxStallRuns}`);
    return;
  }

  const record = await runPreliveSimulationLoop({
    loadRuns,
    runBatch: (options) =>
      runSimulationBatchCli({
        ...options,
        from: args.from,
      }),
    targetSuccessCount: args.targetSuccessCount,
    source: args.source,
    routeKey: args.routeKey,
    amount: args.amount,
    limit: args.limit,
    maxRuns: args.maxRuns,
    maxStallRuns: args.maxStallRuns,
    stopOnFailure: !args.continueOnFailure,
  });

  if (args.write) {
    const store = new JsonlStore(config.dataDir);
    await store.append("prelive-simulation-loop-runs", record);
    const outputPath = join(config.dataDir, "prelive-simulation-loop-latest.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify({ preview, record }, null, 2));
    return;
  }

  console.log(`mode=execute`);
  console.log(`executionStatus=${record.executionStatus}`);
  console.log(`stopReason=${record.stopReason || "none"}`);
  console.log(`initialSuccess=${record.initialSummary.successCount}/${record.initialSummary.targetSuccessCount}`);
  console.log(`initialFailures=${record.initialSummary.failureCount}`);
  console.log(`finalSuccess=${record.finalSummary.successCount}/${record.finalSummary.targetSuccessCount}`);
  console.log(`finalFailures=${record.finalSummary.failureCount}`);
  console.log(`iterations=${record.iterations.length}`);
  for (const iteration of record.iterations) {
    console.log(
      [
        `attempt=${iteration.attempt}`,
        `selected=${iteration.selectedCount ?? 0}`,
        `successDelta=${iteration.successDelta ?? 0}`,
        `failureDelta=${iteration.failureDelta ?? 0}`,
        `skippedDelta=${iteration.skippedDelta ?? 0}`,
        iteration.stopReason ? `iterationStop=${iteration.stopReason}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
