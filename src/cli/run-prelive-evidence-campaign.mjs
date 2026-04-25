#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  buildPreliveEvidenceCampaign,
  buildPreliveEvidenceCampaignSummary,
  executePreliveEvidenceCampaign,
} from "../prelive/evidence-campaign.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

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
    refreshLimit: options["refresh-limit"] ? Number(options["refresh-limit"]) : 1,
    simulationLimit: options["simulation-limit"] ? Number(options["simulation-limit"]) : 4,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

function buildCampaignFromContext(context, args) {
  return buildPreliveEvidenceCampaign({
    reviewPackage: context.reviewPackage,
    shadowRefreshBatchSummary: context.dashboardStatus?.shadowCycle?.refreshBatch || null,
    simulationRuns: context.artifacts.preliveSimulationRuns || [],
    forkExecutionPlans: context.artifacts.preliveForkPlan?.plans || [],
    forkExecutionSubmissions: context.artifacts.preliveForkSubmissions || [],
    forkExecutionReceipts: context.artifacts.preliveForkReceipts || [],
    refreshBatchLimit: args.refreshLimit,
    simulationLimit: args.simulationLimit,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const campaign = buildCampaignFromContext(context, args);
  const record = await executePreliveEvidenceCampaign({
    campaign,
    execute: args.execute,
    stopOnFailure: !args.continueOnFailure,
  });

  if (args.execute && record.executionStatus !== "failed") {
    const finalContext = await buildCurrentDashboardContext({ dataDir: config.dataDir });
    record.finalCampaign = buildCampaignFromContext(finalContext, args);
    record.finalStatus = record.finalCampaign.overallStatus;
  }

  if (args.execute) {
    const store = new JsonlStore(config.dataDir);
    await store.append("prelive-evidence-campaigns", record);
  }

  const persistedRecords = args.execute || args.write ? await readJsonl(config.dataDir, "prelive-evidence-campaigns") : [];
  const persistedSummary = buildPreliveEvidenceCampaignSummary(persistedRecords);
  const summary = args.execute ? persistedSummary : buildPreliveEvidenceCampaignSummary([record]);
  if (args.write || args.execute) {
    const outputPath = join(config.dataDir, "prelive-evidence-campaign-summary.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  const activeCampaign = record.finalCampaign || campaign;
  const output = {
    record,
    campaign: activeCampaign,
    summary,
    persistedSummary,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`mode=${record.mode}`);
  console.log(`overallStatus=${activeCampaign.overallStatus}`);
  console.log(`currentStage=${activeCampaign.currentStage || "none"}`);
  console.log(`reviewPackageStatus=${activeCampaign.reviewPackageStatus || "none"}`);
  console.log(`simulationProgress=${activeCampaign.simulation.successCount}/${activeCampaign.simulation.targetSuccessCount}`);
  console.log(`forkProgress=${activeCampaign.forkExecution.confirmedCount}/${activeCampaign.forkExecution.targetConfirmedCount}`);
  console.log(`nextAction=${activeCampaign.nextAction?.code || "none"}`);
  console.log(`stopReason=${record.stopReason || "none"}`);
  for (const item of activeCampaign.actions || []) {
    console.log(
      [
        "campaignAction",
        `code=${item.code}`,
        `status=${item.status}`,
        item.reason ? `reason=${item.reason}` : null,
        item.command ? `command=${item.command}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  console.log(
    `campaignSummary runs=${summary.runCount} preview=${summary.previewCount} ready=${summary.readyCount} reviewReady=${summary.reviewReadyCount} awaitingManual=${summary.awaitingManualCount} blocked=${summary.blockedCount} failed=${summary.failureCount}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
