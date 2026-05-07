#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  buildAdmissionRemediationExecutionSummary,
  executeAdmissionRemediationPlan,
} from "../prelive/admission-remediation.mjs";
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
    limit: options.limit ? Number(options.limit) : 1,
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
  const plan = context.reviewPackage?.remediationPlan || null;
  const record = await executeAdmissionRemediationPlan({
    plan,
    execute: args.execute,
    stopOnFailure: !args.continueOnFailure,
    limit: args.limit,
  });

  if (args.execute && record.executionStatus !== "failed") {
    const finalContext = await buildCurrentDashboardContext({ dataDir: config.dataDir });
    record.finalPlan = finalContext.reviewPackage?.remediationPlan || null;
    record.finalStatus = record.finalPlan?.overallStatus || record.executionStatus;
  }

  if (args.execute) {
    const store = new JsonlStore(config.dataDir);
    await store.append("prelive-admission-remediation-runs", record);
  }

  const persistedRecords = args.execute || args.write ? await readJsonl(config.dataDir, "prelive-admission-remediation-runs") : [];
  const summary = args.execute ? buildAdmissionRemediationExecutionSummary(persistedRecords) : buildAdmissionRemediationExecutionSummary([record]);

  if (args.write || args.execute) {
    const outputPath = join(config.dataDir, "prelive-admission-remediation-summary.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  const activePlan = record.finalPlan || plan;
  const output = {
    record,
    plan: activePlan,
    summary,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`mode=${record.mode}`);
  console.log(`overallStatus=${activePlan?.overallStatus || "none"}`);
  console.log(`selectedCount=${record.selectedCount ?? 0}`);
  console.log(`executionStatus=${record.executionStatus}`);
  console.log(`stopReason=${record.stopReason || "none"}`);
  console.log(`nextAction=${activePlan?.nextAction?.code || "none"}`);
  console.log(`runnerCommand=${activePlan?.runnerCommand || "none"}`);
  for (const item of activePlan?.items || []) {
    console.log(
      [
        "remediationItem",
        item.rank != null ? `rank=${item.rank}` : null,
        item.status ? `status=${item.status}` : null,
        item.code ? `code=${item.code}` : null,
        item.reason ? `reason=${item.reason}` : null,
        item.command ? `command=${item.command}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  console.log(
    `remediationSummary runs=${summary.runCount} preview=${summary.previewCount} success=${summary.successCount} awaitingPolicyReview=${summary.awaitingPolicyReviewCount} blocked=${summary.blockedCount} failed=${summary.failureCount}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
