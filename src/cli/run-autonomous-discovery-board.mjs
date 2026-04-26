#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  buildAutonomousDiscoveryBoard,
  buildAutonomousDiscoveryExecutionSummary,
  filterOfficialGatewayRoutes,
  selectAutonomousDiscoveryOpportunities,
} from "../strategy/autonomous-discovery-board.mjs";
import { buildDexRouteUniverseSummary, buildEthRouteUniverseSummary } from "../strategy/dex-route-universe.mjs";
import {
  defaultRunCommand,
  parseWhitelistedRefreshCommand,
  runParsedRefreshSteps,
} from "../session/shadow-refresh-runner.mjs";

export const DEFAULT_ALLOWED_AUTONOMOUS_DISCOVERY_SCRIPTS = new Set([
  "report:autonomous-discovery-board",
  "report:destination-allocation-plan",
  "report:destination-allowlist-board",
  "report:destination-economics-queue",
  "report:destination-estimated-economics",
  "report:destination-evidence-policy",
  "report:destination-input-workbench",
  "report:destination-promotion-gate",
  "report:destination-registry",
  "report:destination-venue-template",
  "report:recursive-lending-loop",
  "report:wrapped-btc-loop",
  "report:wrapped-btc-loop-dry-run",
  "run:recursive-lending-loop-dry-run",
  "run:wrapped-btc-loop-dry-run",
  "scan:quote-surface",
  "seed:destination-source-metadata",
  "verify:gateway:asset-coverage",
]);

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
    rank: options.rank ? Number(options.rank) : null,
    ids: options.id ? options.id.split(",").map((item) => item.trim()).filter(Boolean) : [],
    lanes: options.lane ? options.lane.split(",").map((item) => item.trim()).filter(Boolean) : [],
    limit: options.limit ? Number(options.limit) : 1,
    commandTimeoutMs: options["command-timeout-ms"] ? Number(options["command-timeout-ms"]) : null,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

function previewSteps(steps = []) {
  return steps.map((step) => ({
    script: step.script,
    ok: null,
    exitCode: null,
    signal: null,
    durationMs: null,
    stdoutSummary: null,
    stderrSummary: null,
  }));
}

function outcomeCategoryForRecord(record = {}) {
  if (record.executionStatus === "preview") return "preview_only";
  if (record.executionStatus === "invalid") return "command_invalid";
  if (record.executionStatus === "failed") return "command_failed";
  if (record.executionStatus === "succeeded") {
    if ((record.nextActionCode || "").startsWith("review_")) return "review_completed";
    if ((record.nextActionCode || "").startsWith("record_") || (record.nextActionCode || "").startsWith("run_")) {
      return "evidence_capture_completed";
    }
    return "command_succeeded";
  }
  return null;
}

function outcomeSignalForRecord(record = {}) {
  if (record.executionStatus === "failed" || record.executionStatus === "invalid") return "discard";
  if (record.executionStatus === "succeeded") {
    return record.recommendedDecision === "discard" ? "watch" : "keep";
  }
  return "watch";
}

async function loadBoard() {
  const [deterministicStrategyCandidates, destinationResearchQueue, destinationPromotionGate, routeRecords, iterationRecords] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "deterministic-strategy-candidates.json")),
    readJsonIfExists(join(config.dataDir, "destination-research-queue.json")),
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "autonomous-discovery-board-runs"),
  ]);
  const latestRoutesRecord = routeRecords.at(-1) || null;
  const gatewayRoutes = filterOfficialGatewayRoutes(latestRoutesRecord?.routes || []);
  const btcRouteUniverse = buildDexRouteUniverseSummary({
    routes: gatewayRoutes,
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  const ethRouteUniverse = buildEthRouteUniverseSummary({
    routes: gatewayRoutes,
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  return buildAutonomousDiscoveryBoard({
    deterministicStrategyCandidates,
    destinationResearchQueue,
    destinationPromotionGate,
    btcRouteUniverse,
    ethRouteUniverse,
    gatewayRoutes,
    iterationRecords,
  });
}

async function executeOpportunity(
  item,
  {
    execute = false,
    cwd = process.cwd(),
    env = process.env,
    runCommand = defaultRunCommand,
    allowedScripts = DEFAULT_ALLOWED_AUTONOMOUS_DISCOVERY_SCRIPTS,
    now = new Date().toISOString(),
  } = {},
) {
  const base = {
    schemaVersion: 1,
    observedAt: now,
    iterationId: randomUUID(),
    opportunityId: item?.id || null,
    selectionRank: item?.selectionRank ?? null,
    lane: item?.lane || null,
    type: item?.type || null,
    label: item?.label || null,
    status: item?.status || null,
    priorityScore: item?.priorityScore ?? null,
    selectionScore: item?.selectionScore ?? null,
    keepScore: item?.researchLoop?.keepScore ?? null,
    discardScore: item?.researchLoop?.discardScore ?? null,
    recommendedDecision: item?.researchLoop?.recommendedDecision || null,
    nextActionCode: item?.nextAction?.code || null,
    command: item?.nextAction?.command || null,
    paperPnl: item?.pnl?.paper || null,
    estimatedPnl: item?.pnl?.estimated || null,
    realizedPnl: item?.pnl?.realized || null,
  };
  if (!base.command) {
    return {
      ...base,
      executionStatus: "invalid",
      invalidReason: "missing_command",
      stepCount: 0,
      steps: [],
      outcomeCategory: "command_invalid",
      outcomeSignal: "discard",
    };
  }

  let steps;
  try {
    steps = parseWhitelistedRefreshCommand(base.command, { allowedScripts });
  } catch (error) {
    return {
      ...base,
      executionStatus: "invalid",
      invalidReason: error.message,
      stepCount: 0,
      steps: [],
      outcomeCategory: "command_invalid",
      outcomeSignal: "discard",
    };
  }

  if (!execute) {
    const preview = {
      ...base,
      executionStatus: "preview",
      invalidReason: null,
      stepCount: steps.length,
      steps: previewSteps(steps),
    };
    return {
      ...preview,
      outcomeCategory: outcomeCategoryForRecord(preview),
      outcomeSignal: outcomeSignalForRecord(preview),
    };
  }

  const executed = await runParsedRefreshSteps(steps, {
    cwd,
    env,
    runCommand: async (details) => runCommand({ ...details, item }),
  });
  const record = {
    ...base,
    executionStatus: executed.executionStatus,
    invalidReason: null,
    stepCount: steps.length,
    steps: executed.steps,
  };
  return {
    ...record,
    outcomeCategory: outcomeCategoryForRecord(record),
    outcomeSignal: outcomeSignalForRecord(record),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const board = await loadBoard();
  const selected = selectAutonomousDiscoveryOpportunities(board, {
    rank: args.rank,
    ids: args.ids,
    lanes: args.lanes,
    limit: args.limit,
  });
  const records = [];
  for (const item of selected) {
    records.push(await executeOpportunity(item, {
      execute: args.execute,
      ...(Number.isFinite(args.commandTimeoutMs) && args.commandTimeoutMs > 0
        ? {
            runCommand: (details) => defaultRunCommand({
              ...details,
              timeoutMs: args.commandTimeoutMs,
            }),
          }
        : {}),
    }));
  }

  if (args.execute && records.length) {
    const store = new JsonlStore(config.dataDir);
    for (const record of records) {
      await store.append("autonomous-discovery-board-runs", record);
    }
  }

  const allRecords = args.execute || args.write ? await readJsonl(config.dataDir, "autonomous-discovery-board-runs") : [];
  const persistedSummary = buildAutonomousDiscoveryExecutionSummary(allRecords);
  if (args.write || args.execute) {
    await writeTextIfChanged(join(config.dataDir, "autonomous-discovery-loop-summary.json"), `${JSON.stringify(persistedSummary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  const executionSummary = args.execute ? persistedSummary : buildAutonomousDiscoveryExecutionSummary(records);
  const output = {
    mode: args.execute ? "execute" : "preview",
    boardSummary: board.summary,
    selectedCount: selected.length,
    records,
    executionSummary,
    persistedSummary,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`mode=${output.mode}`);
  console.log(`selectedCount=${output.selectedCount}`);
  console.log(`topOpportunity=${board.summary?.topOpportunityId || "n/a"}`);
  console.log(`paperPnlBtc=${board.summary?.pnl?.paper?.btc ?? "n/a"} paperPnlUsd=${board.summary?.pnl?.paper?.usdProjection ?? "n/a"} paperPnlStatus=${board.summary?.pnl?.paper?.status || "n/a"}`);
  console.log(`estimatedPnlBtc=${board.summary?.pnl?.estimated?.btc ?? "n/a"} estimatedPnlUsd=${board.summary?.pnl?.estimated?.usdProjection ?? "n/a"} estimatedPnlStatus=${board.summary?.pnl?.estimated?.status || "n/a"}`);
  console.log(`realizedPnlBtc=${board.summary?.pnl?.realized?.btc ?? "n/a"} realizedPnlUsd=${board.summary?.pnl?.realized?.usdProjection ?? "n/a"} realizedPnlStatus=${board.summary?.pnl?.realized?.status || "n/a"}`);
  for (const record of records) {
    console.log(
      [
        `rank=${record.selectionRank ?? "n/a"}`,
        `id=${record.opportunityId || "n/a"}`,
        `lane=${record.lane || "n/a"}`,
        `status=${record.executionStatus || "unknown"}`,
        `decision=${record.recommendedDecision || "n/a"}`,
        record.nextActionCode ? `action=${record.nextActionCode}` : null,
        record.steps?.length ? `scripts=${record.steps.map((step) => step.script).join(",")}` : null,
        record.invalidReason ? `reason=${record.invalidReason}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  console.log(
    `executionSummary runs=${executionSummary.runCount} success=${executionSummary.successCount} failed=${executionSummary.failureCount} invalid=${executionSummary.invalidCount} preview=${executionSummary.previewCount} keep=${executionSummary.keepCount} discard=${executionSummary.discardCount}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
