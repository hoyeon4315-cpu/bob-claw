#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

function formatUsd(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const report = context.dashboardStatus.prelive;
  const reviewPackage = context.reviewPackage || null;

  if (args.write) {
    const outputPath = join(config.dataDir, "prelive-readiness.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`currentStage=${report.currentStage}`);
  console.log(`liveTradingPolicy=${report.liveTradingPolicy}`);
  console.log(
    `primaryLane=${report.reviewPackage?.candidateLabel || report.reviewPackage?.candidateId || "n/a"} priority=primary status=${report.reviewPackage?.tradeReadiness || "n/a"} next=${report.reviewPackage?.tinyCanaryAdmissionNextActionCode || report.validation?.nextActionCode || "n/a"}`,
  );
  console.log(
    `exactRouteLane=${(report.currentRoutePrelivePass?.provenCount ?? 0) > 0 ? "passed" : "blocked"} priority=secondary stop=${report.currentRoutePrelivePass?.latestStopReason || "n/a"} economic=${report.exactRouteForkPackage?.economicStatus || report.validation?.exactRouteForkEconomicStatus || "n/a"} next=${report.currentRoutePrelivePass?.nextAction?.code || "n/a"}`,
  );
  console.log(`shadowReplay=${report.shadowReplay.status}`);
  console.log(`shadowReplayBlockers=${report.shadowReplay.blockers.join(",") || "none"}`);
  console.log(`mechanicalSimulation=${report.mechanicalSimulation.status}`);
  console.log(
    `simulationCounts success=${report.mechanicalSimulation.successCount}/${report.mechanicalSimulation.targetSuccessCount} failure=${report.mechanicalSimulation.failureCount} unresolved=${report.mechanicalSimulation.unresolvedFailureCount ?? 0} remediated=${report.mechanicalSimulation.remediatedFailureCount ?? 0} historical=${report.mechanicalSimulation.historicalFailureCount ?? 0}`,
  );
  console.log(`mechanicalBlockers=${report.mechanicalSimulation.blockers.join(",") || "none"}`);
  console.log(`forkExecution=${report.forkExecution.status}`);
  console.log(
    `forkCounts planned=${report.forkExecution.planCount} submitted=${report.forkExecution.submittedCount} confirmed=${report.forkExecution.confirmedCount}/${report.forkExecution.targetConfirmedCount} pendingOutput=${report.forkExecution.pendingOutputCount ?? 0} failed=${report.forkExecution.failedCount}`,
  );
  console.log(
    `forkRealized realizedSamples=${report.forkExecution.realizedSampleCount ?? 0} realizedNet=${formatUsd(report.forkExecution.realizedNetPnlUsd)} medianRealized=${formatUsd(report.forkExecution.medianRealizedNetPnlUsd)} medianNetDrift=${formatUsd(report.forkExecution.medianNetDriftUsd)} medianGasDrift=${formatUsd(report.forkExecution.medianExecutionGasDriftUsd)}`,
  );
  console.log(`forkBlockers=${report.forkExecution.blockers.join(",") || "none"}`);
  if (report.forkExecution.latestPendingOutput) {
    console.log(
      `forkPendingOutput planId=${report.forkExecution.latestPendingOutput.planId} txHash=${report.forkExecution.latestPendingOutput.txHash || "n/a"} route=${report.forkExecution.latestPendingOutput.routeLabel || report.forkExecution.latestPendingOutput.routeKey || "unknown"}`,
    );
    console.log(`forkPendingOutputCommand=${report.forkExecution.latestPendingOutput.resolutionCommand || "n/a"}`);
  }
  console.log(`executionAudit=${report.executionAudit.status}`);
  console.log(`executionAuditMissing=${report.executionAudit.missingRecordCount}`);
  console.log(`executionAuditBlockers=${report.executionAudit.blockers.join(",") || "none"}`);
  console.log(`tinyLiveCanary=${report.tinyLiveCanary.status}`);
  console.log(`tinyLiveBlockers=${report.tinyLiveCanary.blockers.join(",") || "none"}`);
  if (report.reviewPackage) {
    console.log(`tinyCanaryAdmission=${report.reviewPackage.tinyCanaryAdmissionDecision || "n/a"}`);
    console.log(`tinyCanaryAdmissionStatus=${report.reviewPackage.tinyCanaryAdmissionStatus || "n/a"}`);
    console.log(`tinyCanaryAdmissionBlockers=${report.reviewPackage.tinyCanaryAdmissionBlockers?.join(",") || "none"}`);
    if (report.reviewPackage.remediationPlan) {
      console.log(
        `tinyCanaryRemediation=${report.reviewPackage.remediationPlan.overallStatus || "unknown"} ready=${report.reviewPackage.remediationPlan.readyCount ?? 0} manual=${report.reviewPackage.remediationPlan.manualCount ?? 0} blocked=${report.reviewPackage.remediationPlan.blockedCount ?? 0}`,
      );
      console.log(`tinyCanaryRemediationRunner=${report.reviewPackage.remediationPlan.runnerCommand || "n/a"}`);
      if (report.reviewPackage.remediationPlan.nextAction) {
        console.log(
          `tinyCanaryRemediationNext=${report.reviewPackage.remediationPlan.nextAction.code || "unknown"} status=${report.reviewPackage.remediationPlan.nextAction.status || "unknown"} command=${report.reviewPackage.remediationPlan.nextAction.command || "n/a"}`,
        );
      }
    }
  }
  if (reviewPackage?.remediationPlan?.items?.length) {
    for (const item of reviewPackage.remediationPlan.items.slice(0, 3)) {
      console.log(
        `tinyCanaryRemediationItem rank=${item.rank ?? "n/a"} status=${item.status || "unknown"} code=${item.code || "unknown"} reason=${item.reason || "none"} command=${item.command || "n/a"}`,
      );
    }
    if (reviewPackage.remediationPlan.followUpCommand) {
      console.log(`tinyCanaryRemediationFollowUp=${reviewPackage.remediationPlan.followUpCommand}`);
    }
  }
  for (const action of report.nextActions || []) {
    console.log(
      [
        "nextAction",
        action.rank != null ? `rank=${action.rank}` : null,
        action.scope ? `scope=${action.scope}` : null,
        action.label ? `label=${action.label}` : null,
        action.reason ? `reason=${action.reason}` : null,
        action.command ? `command=${action.command}` : null,
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
