#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { loadStrategyExecutionSurfaceInputs } from "./report-strategy-execution-surfaces.mjs";
import { readExecutionGuards } from "../execution/guards.mjs";
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
  const scope = options.scope ? options.scope.split(",").map((item) => item.trim()).filter(Boolean) : [];
  const target = options.target ? options.target.split(",").map((item) => item.trim()).filter(Boolean) : [];
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    dryRun: flags.has("--dry-run"),
    execute: flags.has("--execute") && !flags.has("--dry-run"),
    compact: flags.has("--compact"),
    continueOnFailure: flags.has("--continue-on-failure"),
    mode: options.mode || "auto",
    commandTimeoutMs: options["command-timeout-ms"] ? Number(options["command-timeout-ms"]) : null,
    orchestratorRunId: options["orchestrator-run-id"] || null,
    orchestratorSource: options["orchestrator-source"] || null,
    target,
    scope: Array.from(new Set([...scope, ...target])),
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
        broadcastReadiness: result.broadcastReadiness || null,
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

function buildExecuteReadinessBlockers(results = []) {
  return (results || [])
    .filter((result) => result.broadcastReadiness?.readyForLiveBroadcast !== true)
    .map((result) => ({
      strategyId: result.strategyId || null,
      policyBlockers: result.broadcastReadiness?.policyDispatchBlockers || [],
      adviceCode: result.broadcastReadiness?.advisoryEvidence?.adviceCode || null,
      selectedMode: result.broadcastReadiness?.selectedMode || null,
    }));
}

function buildNextActionGuide({ target = [], status = "execute_blocked_by_readiness" } = {}) {
  const targetArg = target.length ? target.join(",") : "<strategy-id>";
  return {
    command: `npm run preflight:broadcast -- --target=${targetArg} --json`,
    status,
    requirements: [
      "kill-switch status is RUNNING",
      "signer readiness.readyForBroadcast is true",
      "wallet holdings are fresh and non-divergent",
      "dispatch dry-run reports readyForPolicyDispatch=true",
      "dispatch dry-run reports readyForLiveBroadcast=true",
    ],
  };
}

async function appendCliBlockAudit({
  logsDir = join(process.cwd(), "logs"),
  observedAt,
  reason,
  blockers = [],
  args,
} = {}) {
  await new JsonlStore(logsDir).append("operator-action-audit", {
    schemaVersion: 1,
    observedAt,
    action: "broadcast_blocked_at_cli",
    reason,
    strategyId: blockers.length === 1 ? blockers[0].strategyId : null,
    target: args?.target || [],
    requestedMode: args?.mode || "auto",
    blockers,
    policyAuthority: "policy_engine_only",
    signerAuthority: "signer_daemon_after_policy_approval",
  });
}

function renderJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderHumanOutput({ enrichedRecord, planningBridge, summary }) {
  const lines = [];
  lines.push(`mode=${enrichedRecord.mode}`);
  lines.push(`requestedMode=${enrichedRecord.requestedMode}`);
  lines.push(`selectedCount=${enrichedRecord.selectedCount}`);
  lines.push(`batchStatus=${enrichedRecord.batchStatus}`);
  lines.push(`stopReason=${enrichedRecord.stopReason || "none"}`);
  lines.push(`planningBridge=${planningBridge?.authority || "none"} top=${planningBridge?.topCandidateId || "none"} candidates=${planningBridge?.candidateCount ?? 0}`);
  for (const result of enrichedRecord.strategyResults || []) {
    lines.push(
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
  lines.push(`dispatchSummary runs=${summary.runCount} success=${summary.successCount} failed=${summary.failureCount} preview=${summary.previewCount}`);
  return `${lines.join("\n")}\n`;
}

export async function runStrategyCatalogDispatcherCli(
  argv = process.argv.slice(2),
  {
    dataDir = config.dataDir,
    logsDir = join(process.cwd(), "logs"),
    loadStrategyCatalogDispatchInputsImpl = loadStrategyCatalogDispatchInputs,
    executeStrategyDispatchImpl = executeStrategyDispatch,
    buildStrategyDispatchSummaryImpl = buildStrategyDispatchSummary,
    readJsonlImpl = readJsonl,
    writeTextIfChangedImpl = writeTextIfChanged,
    readExecutionGuardsImpl = readExecutionGuards,
    runCommand,
    now = new Date().toISOString(),
  } = {},
) {
  const args = parseArgs(argv);

  if (args.execute) {
    const guards = await readExecutionGuardsImpl({
      emergencyStopPath: config.emergencyStopFlagPath,
      liveModePath: config.liveModeFlagPath,
      mode: "dry_run",
    });
    if (guards.blocked) {
      const status = guards.reasons?.includes("kill_switch_active")
        ? "execute_blocked_by_kill_switch"
        : "execute_blocked_by_execution_guard";
      const blockers = (args.target.length ? args.target : ["<target-not-specified>"]).map((strategyId) => ({
        strategyId,
        policyBlockers: guards.reasons || [],
        adviceCode: null,
        selectedMode: null,
      }));
      const payload = {
        status,
        observedAt: now,
        blockers,
        nextActionGuide: buildNextActionGuide({ target: args.target, status }),
      };
      await appendCliBlockAudit({ logsDir, observedAt: now, reason: status, blockers, args });
      return {
        exitCode: 2,
        stdout: renderJson(payload),
        stderr: "",
        payload,
      };
    }
  }

  const { executionSurfaces, planningBridge } = await loadStrategyCatalogDispatchInputsImpl({ dataDir });
  let strategies = executionSurfaces.strategies || [];
  if (args.scope.length) {
    const scopeSet = new Set(args.scope);
    strategies = strategies.filter((strategy) => scopeSet.has(strategy.id));
  }
  if (args.bucket.length) {
    const bucketSet = new Set(args.bucket);
    strategies = strategies.filter((strategy) => bucketSet.has(strategy.capabilityBucket));
  }

  const dispatchOptions = {
    strategies,
    requestedMode: args.mode,
    orchestration: {
      source: args.orchestratorSource || "run_strategy_catalog_dispatcher",
      runId: args.orchestratorRunId || null,
    },
    stopOnFailure: !args.continueOnFailure,
    now,
    ...(Number.isFinite(args.commandTimeoutMs) && args.commandTimeoutMs > 0
      ? {
          runCommand: (details) => runRefreshCommand({
            ...details,
            timeoutMs: args.commandTimeoutMs,
          }),
        }
      : runCommand
        ? { runCommand }
        : {}),
  };

  if (args.execute) {
    const previewRecord = await executeStrategyDispatchImpl({
      ...dispatchOptions,
      execute: false,
    });
    const readinessBlockers = buildExecuteReadinessBlockers(previewRecord.strategyResults || []);
    if (readinessBlockers.length > 0) {
      const payload = {
        status: "execute_blocked_by_readiness",
        observedAt: now,
        blockers: readinessBlockers,
        nextActionGuide: buildNextActionGuide({ target: args.target }),
        record: {
          ...previewRecord,
          planningBridge,
        },
      };
      await appendCliBlockAudit({
        logsDir,
        observedAt: now,
        reason: "execute_blocked_by_readiness",
        blockers: readinessBlockers,
        args,
      });
      return {
        exitCode: 2,
        stdout: renderJson(payload),
        stderr: "",
        payload,
      };
    }
  }

  const record = await executeStrategyDispatchImpl({
    ...dispatchOptions,
    execute: args.execute,
    ...(args.execute
      ? {
          readGuards: (details) => readExecutionGuardsImpl(details),
        }
      : {}),
  });
  const enrichedRecord = {
    ...record,
    planningBridge,
  };

  if (args.execute) {
    const store = new JsonlStore(dataDir);
    await store.append("strategy-dispatch-runs", enrichedRecord);
  }

  const allRecords = args.execute || args.write ? await readJsonlImpl(dataDir, "strategy-dispatch-runs") : [];
  const persistedSummary = buildStrategyDispatchSummaryImpl(allRecords);
  if (args.write || args.execute) {
    await writeTextIfChangedImpl(join(dataDir, "strategy-dispatch-summary.json"), `${JSON.stringify(persistedSummary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  const summary = args.execute ? persistedSummary : buildStrategyDispatchSummaryImpl([enrichedRecord]);
  const output = {
    executionSurfaces,
    planningBridge,
    record: enrichedRecord,
    summary,
    persistedSummary,
  };

  if (args.json) {
    const payload = args.compact ? compactDispatchOutput(output) : output;
    return {
      exitCode: 0,
      stdout: renderJson(payload),
      stderr: "",
      payload,
    };
  }

  return {
    exitCode: 0,
    stdout: renderHumanOutput({ enrichedRecord, planningBridge, summary }),
    stderr: "",
    payload: output,
  };
}

async function main() {
  const result = await runStrategyCatalogDispatcherCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
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
