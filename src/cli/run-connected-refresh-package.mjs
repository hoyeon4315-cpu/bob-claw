#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import {
  buildConnectedRefreshExecutionSummary,
  executeConnectedRefreshPackage,
  persistConnectedRefreshRun,
} from "../prelive/connected-refresh-runner.mjs";

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
    skipReevaluation: flags.has("--skip-reevaluation"),
    limit: options.limit ? Number(options.limit) : null,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const refreshPackage = context.connectedRefreshPackage;
  const record = await executeConnectedRefreshPackage({
    refreshPackage,
    execute: args.execute,
    includeReevaluation: !args.skipReevaluation,
    limit: args.limit,
    stopOnFailure: !args.continueOnFailure,
  });

  if (args.execute && record.executionStatus !== "failed") {
    const finalContext = await buildCurrentDashboardContext({ dataDir: config.dataDir });
    record.finalPackage = finalContext.connectedRefreshPackage;
    record.finalValidation = finalContext.preliveValidation;
    record.finalReviewPackage = finalContext.reviewPackage;
  }

  let summary = buildConnectedRefreshExecutionSummary([record]);
  if (args.write || args.execute) {
    const persisted = await persistConnectedRefreshRun({
      dataDir: config.dataDir,
      record,
      writeSummary: false,
    });
    summary = persisted || summary;
  }

  if (args.write || args.execute) {
    const outputPath = join(config.dataDir, "connected-refresh-run-summary.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  const output = {
    record,
    package: record.finalPackage || refreshPackage,
    summary,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const activePackage = record.finalPackage || refreshPackage;
  console.log(`mode=${record.mode}`);
  console.log(`packageStatus=${activePackage?.status || "none"}`);
  console.log(`selectedRefreshCount=${record.selectedRefreshCount ?? 0}`);
  console.log(`selectedReevaluationCount=${record.selectedReevaluationCount ?? 0}`);
  console.log(`executionStatus=${record.executionStatus}`);
  console.log(`stopReason=${record.stopReason || "none"}`);
  console.log(`nextAction=${activePackage?.nextAction?.code || activePackage?.summary?.nextActionCode || "none"}`);
  console.log(`runner=${activePackage?.runner?.execute || "npm run run:connected-refresh-package -- --execute"}`);
  for (const entry of record.selectedRefreshes || []) {
    console.log(`refreshStep id=${entry.id || "unknown"} reason=${entry.reason || "none"} command=${entry.command || "n/a"}`);
  }
  for (const entry of record.selectedReevaluationSteps || []) {
    console.log(`reevaluationStep id=${entry.id || "unknown"} command=${entry.command || "n/a"}`);
  }
  console.log(
    `refreshSummary runs=${summary.runCount} preview=${summary.previewCount} success=${summary.successCount} partial=${summary.partialCount} noop=${summary.noopCount} failed=${summary.failureCount}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
