#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { buildStrategyExecutionSurfaces } from "../strategy/strategy-execution-surfaces.mjs";
import { buildStrategyDispatchSummary, executeStrategyDispatch } from "../session/strategy-dispatch-runner.mjs";

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
    mode: options.mode || "auto",
    scope: options.scope ? options.scope.split(",").map((item) => item.trim()).filter(Boolean) : [],
    bucket: options.bucket ? options.bucket.split(",").map((item) => item.trim()).filter(Boolean) : [],
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts } = await buildCurrentDashboardContext();
  const executionSurfaces = buildStrategyExecutionSurfaces({ dashboardStatus, state, triangleArtifacts });
  let strategies = executionSurfaces.strategies || [];
  if (args.scope.length) {
    const scopeSet = new Set(args.scope);
    strategies = strategies.filter((strategy) => scopeSet.has(strategy.id));
  }
  if (args.bucket.length) {
    const bucketSet = new Set(args.bucket);
    strategies = strategies.filter((strategy) => bucketSet.has(strategy.capabilityBucket));
  }

  const record = await executeStrategyDispatch({
    strategies,
    execute: args.execute,
    requestedMode: args.mode,
    stopOnFailure: !args.continueOnFailure,
  });

  if (args.execute) {
    const store = new JsonlStore(config.dataDir);
    await store.append("strategy-dispatch-runs", record);
  }

  const allRecords = args.execute || args.write ? await readJsonl(config.dataDir, "strategy-dispatch-runs") : [];
  const persistedSummary = buildStrategyDispatchSummary(allRecords);
  if (args.write || args.execute) {
    await writeTextIfChanged(join(config.dataDir, "strategy-dispatch-summary.json"), `${JSON.stringify(persistedSummary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  const summary = args.execute ? persistedSummary : buildStrategyDispatchSummary([record]);
  const output = {
    executionSurfaces,
    record,
    summary,
    persistedSummary,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`mode=${record.mode}`);
  console.log(`requestedMode=${record.requestedMode}`);
  console.log(`selectedCount=${record.selectedCount}`);
  console.log(`batchStatus=${record.batchStatus}`);
  console.log(`stopReason=${record.stopReason || "none"}`);
  for (const result of record.strategyResults || []) {
    console.log(
      [
        "strategy",
        `id=${result.strategyId}`,
        `bucket=${result.capabilityBucket}`,
        `mode=${result.selectedMode}`,
        `status=${result.executionStatus}`,
        result.blockedReason ? `reason=${result.blockedReason}` : null,
        result.scripts?.length ? `scripts=${result.scripts.join(",")}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  console.log(`dispatchSummary runs=${summary.runCount} success=${summary.successCount} failed=${summary.failureCount} preview=${summary.previewCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
