#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { exitIfDevLocked } from "../runtime/dev-lock.mjs";
import {
  buildGatewayUpdateAlertRecord,
  buildGatewayUpdateAutopilotRecord,
  buildGatewayUpdateAutopilotRefreshPlan,
  defaultGatewayUpdateAutopilotPnl,
  summarizeGatewayUpdateAutopilotRuns,
} from "../strategy/gateway-update-autopilot.mjs";
import { parseWhitelistedRefreshCommand, runParsedRefreshSteps } from "../session/shadow-refresh-runner.mjs";
import { runGatewayUpdateWatch } from "../watch/gateway-update-watch.mjs";

const DEFAULT_ALLOWED_AUTOPILOT_SCRIPTS = new Set([
  "report:autonomous-discovery-board",
  "report:strategy-snapshot",
  "scan:quote-surface",
  "verify:gateway:asset-coverage",
]);

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    execute: flags.has("--execute"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, observedAt, ...stable } = value;
  return stable;
}

async function readPlanningArtifacts(dataDir) {
  const [autonomousDiscoveryBoard, strategySnapshot, gatewayRouteRecords] = await Promise.all([
    readJsonIfExists(join(dataDir, "autonomous-discovery-board.json")),
    readJsonIfExists(join(dataDir, "strategy-snapshot.json")),
    readJsonl(dataDir, "gateway-routes"),
  ]);
  return {
    autonomousDiscoveryBoard,
    strategySnapshot,
    observedRoutes: gatewayRouteRecords.at(-1)?.routes || [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ((args.execute || args.write) && exitIfDevLocked({ cliName: "run-gateway-update-autopilot" })) {
    return;
  }
  const store = new JsonlStore(config.dataDir);
  const previousSnapshots = await readJsonl(config.dataDir, "gateway-update-snapshots");
  const previousSnapshot = previousSnapshots.at(-1) || null;
  const watchResult = await runGatewayUpdateWatch({
    gatewayApiBase: config.gatewayApiBase,
    previousSnapshot: previousSnapshot?.snapshot || null,
    previousSchemaHash: previousSnapshot?.schemaHash || null,
    previousSchemaShapes: previousSnapshot?.schemaShapes || null,
    previousProbeHealthHash: previousSnapshot?.probeHealthHash || null,
    evmRecipient: config.verifyRecipient,
    btcRecipient: config.verifyBtcRecipient,
  });
  const refreshPlan = buildGatewayUpdateAutopilotRefreshPlan({ watchResult });

  let refreshExecution = null;
  if (args.execute && refreshPlan.triggered) {
    const steps = refreshPlan.steps.flatMap((step) =>
      parseWhitelistedRefreshCommand(step.command, { allowedScripts: DEFAULT_ALLOWED_AUTOPILOT_SCRIPTS }).map((parsed) => ({
        ...parsed,
        id: step.id,
      })),
    );
    const executed = await runParsedRefreshSteps(steps);
    refreshExecution = {
      executionStatus: executed.executionStatus,
      steps: executed.steps.map((step, index) => ({
        id: steps[index]?.id || null,
        ...step,
      })),
    };
  }

  if (args.execute || args.write) {
    await store.append("gateway-update-snapshots", watchResult);
    if (watchResult.updateDetected) {
      await store.append("gateway-update-alerts", buildGatewayUpdateAlertRecord(watchResult));
    }
  }

  const planningArtifacts = await readPlanningArtifacts(config.dataDir);
  const record = buildGatewayUpdateAutopilotRecord({
    watchResult,
    refreshPlan,
    refreshExecution,
    autonomousDiscoveryBoard: planningArtifacts.autonomousDiscoveryBoard,
    strategySnapshot: planningArtifacts.strategySnapshot,
    observedRoutes: planningArtifacts.observedRoutes,
    mode: args.execute ? "execute" : "preview",
  });

  let summary = summarizeGatewayUpdateAutopilotRuns([record]);
  if (args.execute || args.write) {
    await store.append("gateway-update-autopilot-runs", record);
    const allRuns = await readJsonl(config.dataDir, "gateway-update-autopilot-runs");
    summary = summarizeGatewayUpdateAutopilotRuns(allRuns);
    const outputPath = join(config.dataDir, "gateway-update-autopilot-latest.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  const output = {
    record,
    summary,
    pnl: record.pnl || defaultGatewayUpdateAutopilotPnl(),
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`mode=${record.mode}`);
  console.log(`executionMode=${record.executionMode}`);
  console.log(`updateDetected=${record.watch.updateDetected}`);
  console.log(`changeReasons=${record.watch.changeReasons.join(",") || "none"}`);
  console.log(`routeCount=${record.watch.routeCount}`);
  console.log(`supportedRoutes=${record.supportedSurface.supportedRouteCount} ignoredRoutes=${record.supportedSurface.ignoredRouteCount}`);
  console.log(`unsupportedChains=${record.supportedSurface.unsupportedChains.join(",") || "none"}`);
  console.log(`refreshTriggered=${record.refresh.triggered}`);
  console.log(`refreshStatus=${record.refresh.executionStatus}`);
  console.log(`refreshStepCount=${record.refresh.stepCount}`);
  console.log(`autonomousDiscovery opportunities=${record.planningArtifacts.autonomousDiscoveryBoard?.opportunityCount ?? 0} readyNow=${record.planningArtifacts.autonomousDiscoveryBoard?.readyNowCount ?? 0} top=${record.planningArtifacts.autonomousDiscoveryBoard?.topOpportunity?.id || "n/a"} next=${record.planningArtifacts.autonomousDiscoveryBoard?.nextAction?.code || "n/a"}`);
  console.log(`paperPnlBtc=${record.pnl.paper?.btc ?? "n/a"} paperPnlUsd=${record.pnl.paper?.usdProjection ?? "n/a"} paperPnlStatus=${record.pnl.paper?.status || "n/a"}`);
  console.log(`estimatedPnlBtc=${record.pnl.estimated?.btc ?? "n/a"} estimatedPnlUsd=${record.pnl.estimated?.usdProjection ?? "n/a"} estimatedPnlStatus=${record.pnl.estimated?.status || "n/a"}`);
  console.log(`realizedPnlBtc=${record.pnl.realized?.btc ?? "n/a"} realizedPnlUsd=${record.pnl.realized?.usdProjection ?? "n/a"} realizedPnlStatus=${record.pnl.realized?.status || "n/a"}`);
  for (const step of record.refresh.steps || []) {
    console.log(
      [
        `step=${step.id || "n/a"}`,
        `script=${step.script || "n/a"}`,
        step.ok === null ? "status=preview" : `status=${step.ok ? "succeeded" : "failed"}`,
      ].join(" "),
    );
  }
  console.log(
    `summary runs=${summary.runCount} success=${summary.successCount} failed=${summary.failureCount} noop=${summary.noopCount} preview=${summary.previewCount}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
