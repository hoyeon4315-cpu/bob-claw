#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { loadStrategyExecutionSurfaceInputs } from "./report-strategy-execution-surfaces.mjs";
import { buildStrategyDispatchPlanningBridge } from "../session/strategy-dispatch-planning-bridge.mjs";
import { buildStrategyExecutionSurfaces } from "../strategy/strategy-execution-surfaces.mjs";
import { buildStrategyDispatchSummary, executeStrategyDispatch } from "../session/strategy-dispatch-runner.mjs";
import { defaultRunCommand as runRefreshCommand } from "../session/shadow-refresh-runner.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

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
    write: flags.has("--write"),
    execute: flags.has("--execute"),
    compact: flags.has("--compact"),
    continueOnFailure: flags.has("--continue-on-failure"),
    mode: options.mode || "auto",
    commandTimeoutMs: options["command-timeout-ms"] ? Number(options["command-timeout-ms"]) : null,
    orchestratorRunId: options["orchestrator-run-id"] || null,
    orchestratorSource: options["orchestrator-source"] || null,
    scope: options.scope ? options.scope.split(",").map((item) => item.trim()).filter(Boolean) : [],
    bucket: options.bucket ? options.bucket.split(",").map((item) => item.trim()).filter(Boolean) : [],
  };
}

export async function loadStrategyCatalogDispatchInputs({
  loadStrategyExecutionSurfaceInputsImpl = loadStrategyExecutionSurfaceInputs,
  dataDir = config.dataDir,
} = {}) {
  const { state, dashboardStatus, triangleArtifacts, artifacts } = await loadStrategyExecutionSurfaceInputsImpl({ dataDir });
  const executionSurfaces = buildStrategyExecutionSurfaces({ dashboardStatus, state, triangleArtifacts, artifacts });
  const planningBridge = buildStrategyDispatchPlanningBridge({
    autonomousDiscoveryBoard: artifacts.autonomousDiscoveryBoard || null,
    executionSurfaces,
  });
  return { executionSurfaces, planningBridge };
}

function compactDispatchOutput(output = {}) {
  const record = output.record || {};
  return {
    executionSurfaces: {
      summary: output.executionSurfaces?.summary || null,
    },
    planningBridge: output.planningBridge
      ? {
          authority: output.planningBridge.authority || null,
          candidateCount: output.planningBridge.candidateCount ?? 0,
          topCandidateId: output.planningBridge.topCandidateId || null,
        }
      : null,
    record: {
      schemaVersion: record.schemaVersion ?? null,
      observedAt: record.observedAt || null,
      dispatchId: record.dispatchId || null,
      orchestration: record.orchestration || null,
      mode: record.mode || null,
      requestedMode: record.requestedMode || null,
      selectedCount: record.selectedCount ?? 0,
      batchStatus: record.batchStatus || null,
      stopReason: record.stopReason || null,
      strategyResults: (record.strategyResults || []).map((result) => ({
        strategyId: result.strategyId || null,
        capabilityBucket: result.capabilityBucket || null,
        selectedMode: result.selectedMode || null,
        executionStatus: result.executionStatus || null,
        blockedReason: result.blockedReason || null,
        stepCount: result.stepCount ?? 0,
        scripts: result.scripts || [],
      })),
      followUps: (record.followUps || []).map((result) => ({
        command: result.command || null,
        executionStatus: result.executionStatus || null,
        scripts: result.scripts || [],
      })),
    },
    summary: output.summary || null,
    persistedSummary: output.persistedSummary || null,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { executionSurfaces, planningBridge } = await loadStrategyCatalogDispatchInputs();
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
    orchestration: {
      source: args.orchestratorSource || "run_strategy_catalog_dispatcher",
      runId: args.orchestratorRunId || null,
    },
    stopOnFailure: !args.continueOnFailure,
    ...(Number.isFinite(args.commandTimeoutMs) && args.commandTimeoutMs > 0
      ? {
          runCommand: (details) => runRefreshCommand({
            ...details,
            timeoutMs: args.commandTimeoutMs,
          }),
        }
      : {}),
  });
  const enrichedRecord = {
    ...record,
    planningBridge,
  };

  if (args.execute) {
    const store = new JsonlStore(config.dataDir);
    await store.append("strategy-dispatch-runs", enrichedRecord);
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

  const summary = args.execute ? persistedSummary : buildStrategyDispatchSummary([enrichedRecord]);
  const output = {
    executionSurfaces,
    planningBridge,
    record: enrichedRecord,
    summary,
    persistedSummary,
  };

  if (args.json) {
    const payload = args.compact ? compactDispatchOutput(output) : output;
    await new Promise((resolve, reject) => {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return;
  }

  console.log(`mode=${enrichedRecord.mode}`);
  console.log(`requestedMode=${enrichedRecord.requestedMode}`);
  console.log(`selectedCount=${enrichedRecord.selectedCount}`);
  console.log(`batchStatus=${enrichedRecord.batchStatus}`);
  console.log(`stopReason=${enrichedRecord.stopReason || "none"}`);
  console.log(`planningBridge=${planningBridge?.authority || "none"} top=${planningBridge?.topCandidateId || "none"} candidates=${planningBridge?.candidateCount ?? 0}`);
  for (const result of enrichedRecord.strategyResults || []) {
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

if (IS_MAIN) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
